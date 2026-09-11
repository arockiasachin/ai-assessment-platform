import type { CodeLanguage, TestCategory } from "@/lib/contracts/code-eval"

/**
 * The in-container test harness.
 *
 * The harness is a small, fixed program passed to the interpreter with `-c` /
 * `-e`. It reads a JSON payload from **stdin** (so nothing is bind-mounted into
 * the container), writes the student's source to the writable `/tmp` tmpfs, and
 * executes every test case, emitting one line:
 *
 *     __CODE_EVAL_RESULT__{"tests":[{"id","passed","stdout","stderr","message","durationMs"}]}
 *
 * A sentinel line keeps the payload parseable even if student code writes to fd
 * 1 directly. The harness itself never decides a grade; it reports evidence.
 *
 * Supported categories:
 *  - `input-output` — run the program with `input` on stdin, compare stdout to
 *    `expectedOutput` with trailing-whitespace normalization.
 *  - `unit` — import the source as a module and call `input.function` with
 *    `input.args`; compare the JSON return value to `expectedOutput`.
 *  - `structure` / `code-quality` — static checks described by an `input` JSON
 *    object (`mustContain`, `mustNotContain`, `minLines`, `maxLines`,
 *    `maxLineLength`, `minComments`).
 */

export const HARNESS_RESULT_SENTINEL = "__CODE_EVAL_RESULT__"

/** Per-stream cap inside the container, mirrored on the host side. */
export const HARNESS_MAX_OUTPUT_CHARS = 16_384

export type HarnessTestSpec = {
  id: string
  name: string
  category: TestCategory
  input: string | null
  expectedOutput: string | null
  points: number
}

export type HarnessPayload = {
  language: CodeLanguage
  source: string
  tests: HarnessTestSpec[]
  timeLimitMs: number
}

const PYTHON_HARNESS = String.raw`
import contextlib, importlib.util, io, json, subprocess, sys, time

SENTINEL = "__CODE_EVAL_RESULT__"
MAX_OUT = 16384
SOURCE_PATH = "/tmp/solution.py"


def cap(text):
    if not text:
        return ""
    return text[:MAX_OUT]


def parse_rules(raw):
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def static_check(source, rules, comment_prefix):
    problems = []
    lines = source.splitlines()
    for needle in rules.get("mustContain", []) or []:
        if isinstance(needle, str) and needle not in source:
            problems.append("missing required text: " + needle)
    for needle in rules.get("mustNotContain", []) or []:
        if isinstance(needle, str) and needle in source:
            problems.append("forbidden text present: " + needle)
    minimum = rules.get("minLines")
    if isinstance(minimum, int) and len(lines) < minimum:
        problems.append("too few lines: " + str(len(lines)) + " < " + str(minimum))
    maximum = rules.get("maxLines")
    if isinstance(maximum, int) and len(lines) > maximum:
        problems.append("too many lines: " + str(len(lines)) + " > " + str(maximum))
    longest = rules.get("maxLineLength")
    if isinstance(longest, int):
        for index, line in enumerate(lines):
            if len(line) > longest:
                problems.append("line " + str(index + 1) + " exceeds " + str(longest) + " characters")
                break
    min_comments = rules.get("minComments")
    if isinstance(min_comments, int):
        comments = 0
        for line in lines:
            if line.strip().startswith(comment_prefix):
                comments += 1
        if comments < min_comments:
            problems.append("too few comments: " + str(comments) + " < " + str(min_comments))
    return problems


def normalize(text):
    joined = (text or "").replace("\r\n", "\n")
    return "\n".join(line.rstrip() for line in joined.split("\n")).strip()


def run_once(path, stdin_text, timeout_s):
    try:
        proc = subprocess.run(
            [sys.executable, path],
            input=stdin_text or "",
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return {"timedOut": True, "code": None, "stdout": "", "stderr": "Execution timed out."}
    return {"timedOut": False, "code": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}


def load_module(path):
    module_spec = importlib.util.spec_from_file_location("solution", path)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


def run_unit(path, rules):
    module = load_module(path)
    fn_name = rules.get("function")
    args = rules.get("args", [])
    if not isinstance(args, list):
        args = []
    fn = getattr(module, fn_name)
    out_buffer = io.StringIO()
    err_buffer = io.StringIO()
    with contextlib.redirect_stdout(out_buffer), contextlib.redirect_stderr(err_buffer):
        value = fn(*args)
    return value, out_buffer.getvalue(), err_buffer.getvalue()


def main():
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except Exception:
        data = {}
    source = data.get("source", "") or ""
    tests = data.get("tests", []) or []
    time_limit_ms = int(data.get("timeLimitMs", 5000) or 5000)
    timeout_s = max(0.1, time_limit_ms / 1000.0)

    with open(SOURCE_PATH, "w") as handle:
        handle.write(source)

    results = []
    for spec in tests:
        started = time.time()
        category = spec.get("category", "unit")
        passed = False
        out = ""
        err = ""
        message = ""
        signal = None
        try:
            if category in ("structure", "code-quality"):
                problems = static_check(source, parse_rules(spec.get("input")), "#")
                passed = len(problems) == 0
                message = "structure checks passed" if passed else "; ".join(problems)
            elif category == "unit":
                rules = parse_rules(spec.get("input"))
                value, out, err = run_unit(SOURCE_PATH, rules)
                expected = spec.get("expectedOutput")
                if expected is None or expected == "":
                    passed = True
                    message = "ran without error"
                else:
                    passed = normalize(json.dumps(value)) == normalize(expected)
                    message = "returned the expected value" if passed else "returned an unexpected value"
            else:
                run = run_once(SOURCE_PATH, spec.get("input"), timeout_s)
                out = run["stdout"]
                err = run["stderr"]
                if run["timedOut"]:
                    message = "timed out"
                elif normalize(out) == normalize(spec.get("expectedOutput")):
                    passed = True
                    message = "output matched"
                elif run["code"] is not None and run["code"] < 0:
                    signal_number = -run["code"]
                    signal = {9: "SIGKILL", 15: "SIGTERM"}.get(
                        signal_number, "SIG" + str(signal_number)
                    )
                    message = "process killed by signal " + signal
                elif run["code"] != 0:
                    message = "program exited with code " + str(run["code"])
                else:
                    message = "output did not match the expected result"
        except Exception as error:
            err = err + (str(error) if not isinstance(error, SyntaxError) else str(error))
            message = "execution error: " + str(error)
        results.append(
            {
                "id": spec.get("id"),
                "passed": bool(passed),
                "stdout": cap(out),
                "stderr": cap(err),
                "message": cap(message),
                "signal": signal,
                "durationMs": int((time.time() - started) * 1000),
            }
        )

    sys.stdout.write(SENTINEL + json.dumps({"tests": results}) + "\n")


main()
`

const NODE_HARNESS = String.raw`
const fs = require("fs")
const { spawnSync } = require("child_process")

const SENTINEL = "__CODE_EVAL_RESULT__"
const MAX_OUT = 16384
const SOURCE_PATH = "/tmp/solution.js"

const cap = (text) => (typeof text === "string" ? text.slice(0, MAX_OUT) : "")

function parseRules(raw) {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  } catch (error) {
    return {}
  }
}

function staticCheck(source, rules, commentPrefix) {
  const problems = []
  const lines = source.split("\n")
  for (const needle of rules.mustContain || []) {
    if (typeof needle === "string" && !source.includes(needle)) {
      problems.push("missing required text: " + needle)
    }
  }
  for (const needle of rules.mustNotContain || []) {
    if (typeof needle === "string" && source.includes(needle)) {
      problems.push("forbidden text present: " + needle)
    }
  }
  if (Number.isInteger(rules.minLines) && lines.length < rules.minLines) {
    problems.push("too few lines: " + lines.length + " < " + rules.minLines)
  }
  if (Number.isInteger(rules.maxLines) && lines.length > rules.maxLines) {
    problems.push("too many lines: " + lines.length + " > " + rules.maxLines)
  }
  if (Number.isInteger(rules.maxLineLength)) {
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].length > rules.maxLineLength) {
        problems.push("line " + (index + 1) + " exceeds " + rules.maxLineLength + " characters")
        break
      }
    }
  }
  if (Number.isInteger(rules.minComments)) {
    let comments = 0
    for (const line of lines) {
      if (line.trim().startsWith(commentPrefix)) comments += 1
    }
    if (comments < rules.minComments) {
      problems.push("too few comments: " + comments + " < " + rules.minComments)
    }
  }
  return problems
}

const normalize = (text) =>
  (text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim()

function runOnce(path, stdinText, timeoutMs) {
  const result = spawnSync(process.execPath, [path], {
    input: stdinText || "",
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  })
  if (result.error && result.error.code === "ETIMEDOUT") {
    return { timedOut: true, code: null, signal: null, stdout: "", stderr: "Execution timed out." }
  }
  return {
    timedOut: false,
    code: result.status,
    signal: result.signal || null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  }
}

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout)
  let captured = ""
  process.stdout.write = (chunk, encoding, callback) => {
    captured += chunk.toString()
    if (typeof encoding === "function") encoding()
    if (typeof callback === "function") callback()
    return true
  }
  try {
    const value = fn()
    return { value, captured }
  } finally {
    process.stdout.write = original
  }
}

function runUnit(path, rules) {
  const loaded = require(path)
  const fnName = rules.function
  const args = Array.isArray(rules.args) ? rules.args : []
  const target =
    loaded && typeof loaded[fnName] === "function"
      ? loaded[fnName]
      : loaded && loaded.exports && typeof loaded.exports[fnName] === "function"
        ? loaded.exports[fnName]
        : null
  if (!target) throw new Error("function not found: " + String(fnName))
  return captureStdout(() => target(...args))
}

function main() {
  let data = {}
  try {
    data = JSON.parse(fs.readFileSync(0, "utf8") || "{}")
  } catch (error) {
    data = {}
  }
  const source = data.source || ""
  const tests = Array.isArray(data.tests) ? data.tests : []
  const timeLimitMs = Number(data.timeLimitMs) || 5000

  fs.writeFileSync(SOURCE_PATH, source)

  const results = []
  for (const spec of tests) {
    const started = Date.now()
    const category = spec.category || "unit"
    let passed = false
    let out = ""
    let err = ""
    let message = ""
    let signal = null
    try {
      if (category === "structure" || category === "code-quality") {
        const problems = staticCheck(source, parseRules(spec.input), "//")
        passed = problems.length === 0
        message = passed ? "structure checks passed" : problems.join("; ")
      } else if (category === "unit") {
        const captured = runUnit(SOURCE_PATH, parseRules(spec.input))
        out = captured.captured
        const expected = spec.expectedOutput
        if (expected === null || expected === undefined || expected === "") {
          passed = true
          message = "ran without error"
        } else {
          passed = normalize(JSON.stringify(captured.value)) === normalize(expected)
          message = passed ? "returned the expected value" : "returned an unexpected value"
        }
      } else {
        const run = runOnce(SOURCE_PATH, spec.input, timeLimitMs)
        out = run.stdout
        err = run.stderr
        if (run.timedOut) {
          message = "timed out"
        } else if (normalize(run.stdout) === normalize(spec.expectedOutput)) {
          passed = true
          message = "output matched"
        } else if (run.signal) {
          signal = run.signal
          message = "process killed by signal " + run.signal
        } else if (run.code !== 0) {
          message = "program exited with code " + String(run.code)
        } else {
          message = "output did not match the expected result"
        }
      }
    } catch (error) {
      err = err + (error && error.stack ? error.stack : String(error))
      message = "execution error: " + (error && error.message ? error.message : String(error))
    }
    results.push({
      id: spec.id,
      passed,
      stdout: cap(out),
      stderr: cap(err),
      message: cap(message),
      signal: typeof signal === "string" ? signal : null,
      durationMs: Date.now() - started,
    })
  }

  process.stdout.write(SENTINEL + JSON.stringify({ tests: results }) + "\n")
}

main()
`

/** The fixed harness program for a language. Deterministic; safe to memoize. */
export function buildHarnessProgram(language: CodeLanguage): string {
  return language === "python" ? PYTHON_HARNESS : NODE_HARNESS
}

/** Serialize the stdin payload the harness reads. */
export function buildHarnessPayload(payload: HarnessPayload): string {
  return JSON.stringify(payload)
}

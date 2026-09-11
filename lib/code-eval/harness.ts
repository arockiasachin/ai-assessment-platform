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
 * OUT-OF-PROCESS `unit` EXECUTION
 * -------------------------------
 * `unit` tests do not import the student's code into this process. The harness
 * writes the source to disk, then spawns a **fresh child interpreter** that
 * imports it, calls the requested function, and reports the observed value back
 * on a dedicated pipe (fd 3) framed with a per-run nonce. The harness — the only
 * writer of the container's stdout — owns fd 1 and the `results` array, so
 * student code cannot suppress or forge the sentinel line, poison the harness's
 * serializer, or change another test's evidence. This structurally closes the
 * forgery class the Phase 3 review demonstrated (trailing sentinel, stdout
 * suppression + raw fd write, prototype/`JSON.stringify` pollution): those
 * attacks now only touch the child's private stdout pipe, which the harness
 * treats as untrusted test output.
 *
 * Residual (documented, not claimed fixed): the child's reported value is still
 * produced by a process that runs student code. A determined submission could
 * try to lie about its own function's return value from inside the child (for
 * example a `toJSON` on the returned object, or Python frame introspection to
 * read the nonce). The parent independently owns the pass/fail evidence and
 * fails closed on any framing violation, but "the function actually returned
 * this" is not provable against an arbitrary in-child adversary. See
 * `docs/security/hardening.md`.
 *
 * Supported categories:
 *  - `input-output` — run the program with `input` on stdin, compare stdout to
 *    `expectedOutput` with trailing-whitespace normalization.
 *  - `unit` — spawn a child interpreter, import the source as a module, call
 *    `input.function` with `input.args`, and compare the JSON return value.
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

/**
 * Child program for JavaScript `unit` tests. Self-contained: it reads a job from
 * stdin, imports the student module, calls the function, and writes one
 * nonce-framed JSON object to `resultFd`. It captures the intrinsics it needs
 * before loading the student module and restores `toJSON` after the call, so a
 * poisoned prototype cannot rewrite the reported value.
 */
const NODE_UNIT_RUNNER = String.raw`
const fs = require("fs")
const STRINGIFY = JSON.stringify
const WRITE = fs.writeSync
const OBJECT_CREATE = Object.create
const APPLY = Reflect.apply
const IS_ARRAY = Array.isArray
const TO_STRING = String
const OBJECT_TO_JSON = Object.prototype.toJSON
const ARRAY_TO_JSON = Array.prototype.toJSON

function restore() {
  if (OBJECT_TO_JSON === undefined) delete Object.prototype.toJSON
  else Object.prototype.toJSON = OBJECT_TO_JSON
  if (ARRAY_TO_JSON === undefined) delete Array.prototype.toJSON
  else Array.prototype.toJSON = ARRAY_TO_JSON
}

function send(fd, frame) {
  let text
  try {
    text = STRINGIFY(frame)
  } catch (error) {
    text =
      "{\"nonce\":" +
      STRINGIFY(frame.nonce) +
      ",\"ok\":false,\"hasValue\":false,\"value\":null,\"error\":\"unserializable result\"}"
  }
  try {
    WRITE(fd, text)
  } catch (error) {
    // The student closed the result descriptor; the parent fails the test closed.
  }
}

let job = {}
try {
  job = JSON.parse(fs.readFileSync(0, "utf8") || "{}")
} catch (error) {
  job = {}
}

const fd = typeof job.resultFd === "number" ? job.resultFd : 3
const frame = OBJECT_CREATE(null)
frame.nonce = job.nonce

try {
  const loaded = require(job.sourcePath)
  const name = job.functionName
  const target =
    loaded && typeof loaded[name] === "function"
      ? loaded[name]
      : loaded && loaded.exports && typeof loaded.exports[name] === "function"
        ? loaded.exports[name]
        : null
  if (!target) throw new Error("function not found: " + TO_STRING(name))
  const args = IS_ARRAY(job.args) ? job.args : []
  const value = APPLY(target, undefined, args)
  restore()
  frame.ok = true
  frame.hasValue = value !== undefined
  frame.value = value === undefined ? null : value
  frame.error = null
} catch (error) {
  restore()
  frame.ok = false
  frame.hasValue = false
  frame.value = null
  frame.error = error && error.message ? TO_STRING(error.message) : TO_STRING(error)
}

send(fd, frame)
`

/**
 * Child program for Python `unit` tests. Same protocol as the Node runner; the
 * framed secret is what stops a stray write to the result descriptor from being
 * mistaken for the harness's own report.
 */
const PYTHON_UNIT_RUNNER = String.raw`
import importlib.util, json as _json, os as _os, sys

_DUMPS = _json.dumps
_LOADS = _json.loads


def _load(path):
    spec = importlib.util.spec_from_file_location("solution", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _main():
    try:
        job = _LOADS(sys.stdin.read() or "{}")
    except Exception:
        job = {}
    fd = int(job.get("resultFd", 3) or 3)
    nonce = job.get("nonce")

    def send(frame):
        try:
            text = _DUMPS(frame)
        except Exception:
            text = _DUMPS(
                {
                    "nonce": nonce,
                    "ok": False,
                    "hasValue": False,
                    "value": None,
                    "error": "unserializable result",
                }
            )
        try:
            _os.write(fd, text.encode("utf-8"))
        except Exception:
            pass

    try:
        module = _load(job.get("sourcePath"))
        fn = getattr(module, job.get("functionName"))
        args = job.get("args", [])
        if not isinstance(args, list):
            args = []
        value = fn(*args)
        _json.dumps = _DUMPS
        send({"nonce": nonce, "ok": True, "hasValue": True, "value": value, "error": None})
    except Exception as error:
        _json.dumps = _DUMPS
        send(
            {
                "nonce": nonce,
                "ok": False,
                "hasValue": False,
                "value": None,
                "error": str(error),
            }
        )


_main()
`

const PYTHON_HARNESS = String.raw`
import contextlib, importlib.util, io, json, os as _os, subprocess, sys, time

SENTINEL = "__CODE_EVAL_RESULT__"
MAX_OUT = 16384
SOURCE_PATH = "/tmp/solution.py"

# The child program that runs student code for unit tests in its own process.
_UNIT_RUNNER = ${JSON.stringify(PYTHON_UNIT_RUNNER)}

# Captured before any stdout is written. The harness is the only writer of the
# container's fd 1; student code only ever runs in a child process now, so these
# references live in a process the student cannot reach.
_EMIT = _os.write
# Captured before any child runs: a student module may monkeypatch json.dumps
# while it is imported, so the harness serializes its own evidence with the
# reference it captured up front.
_DUMPS = json.dumps
_LOADS = json.loads


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


def _safe_close(fd):
    try:
        _os.close(fd)
    except Exception:
        pass


def _read_all(fd):
    chunks = []
    try:
        while True:
            chunk = _os.read(fd, 65536)
            if not chunk:
                break
            chunks.append(chunk)
    except Exception:
        pass
    return b"".join(chunks)


def decode_unit_frame(raw, nonce):
    try:
        text = (raw or b"").decode("utf-8").strip()
    except Exception:
        text = ""
    if not text:
        return {"ok": False, "message": "the unit runner produced no result"}
    try:
        frame = _LOADS(text)
    except Exception:
        return {"ok": False, "message": "the unit runner produced unreadable output"}
    if not isinstance(frame, dict) or frame.get("nonce") != nonce:
        return {"ok": False, "message": "the unit runner result failed its integrity check"}
    if frame.get("ok") is not True:
        detail = frame.get("error")
        return {
            "ok": False,
            "message": "execution error: "
            + (detail if isinstance(detail, str) else "the unit runner failed"),
        }
    return {"ok": True, "hasValue": bool(frame.get("hasValue")), "value": frame.get("value")}


def run_unit(path, rules):
    # Student code runs in a separate interpreter. Its stdout/stderr come back as
    # the test's captured output; its only structured report is one nonce-framed
    # JSON object on the result pipe.
    nonce = _os.urandom(16).hex()
    read_fd, write_fd = _os.pipe()
    payload = _DUMPS(
        {
            "nonce": nonce,
            "sourcePath": path,
            "functionName": rules.get("function"),
            "args": rules.get("args", []),
            "resultFd": write_fd,
        }
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", _UNIT_RUNNER],
            input=payload,
            capture_output=True,
            text=True,
            pass_fds=(write_fd,),
        )
        out = proc.stdout or ""
        err = proc.stderr or ""
    except Exception as error:
        _safe_close(write_fd)
        _safe_close(read_fd)
        return {
            "ok": False,
            "out": "",
            "err": str(error),
            "message": "execution error: " + str(error),
            "signal": None,
        }

    _safe_close(write_fd)
    frame_raw = _read_all(read_fd)
    _safe_close(read_fd)

    if proc.returncode is not None and proc.returncode < 0:
        signum = -proc.returncode
        sig = {9: "SIGKILL", 15: "SIGTERM"}.get(signum, "SIG" + str(signum))
        return {"ok": False, "out": out, "err": err, "message": "process killed by signal " + sig, "signal": sig}

    frame = decode_unit_frame(frame_raw, nonce)
    if not frame["ok"]:
        return {"ok": False, "out": out, "err": err, "message": frame["message"], "signal": None}
    return {
        "ok": True,
        "out": out,
        "err": err,
        "hasValue": frame["hasValue"],
        "value": frame["value"],
    }


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
                run = run_unit(SOURCE_PATH, parse_rules(spec.get("input")))
                out = run.get("out", "")
                err = run.get("err", "")
                if not run.get("ok"):
                    message = run.get("message", "execution error")
                    signal = run.get("signal")
                else:
                    expected = spec.get("expectedOutput")
                    if expected is None or expected == "":
                        passed = True
                        message = "ran without error"
                    else:
                        actual = _DUMPS(run.get("value")) if run.get("hasValue") else ""
                        passed = normalize(actual) == normalize(expected)
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

    _EMIT(1, (SENTINEL + _DUMPS({"tests": results}) + "\n").encode("utf-8"))


main()
`

const NODE_HARNESS = String.raw`
const fs = require("fs")
const { spawnSync } = require("child_process")
const crypto = require("crypto")

const SENTINEL = "__CODE_EVAL_RESULT__"
const MAX_OUT = 16384
const SOURCE_PATH = "/tmp/solution.js"

// The child program that runs student code for unit tests in its own process.
const UNIT_RUNNER = ${JSON.stringify(NODE_UNIT_RUNNER)}

const STRINGIFY = JSON.stringify
const OBJECT_CREATE = Object.create
const SET_PROTOTYPE_OF = Object.setPrototypeOf

function serializeResults(results) {
  const safe = SET_PROTOTYPE_OF([], null)
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const entry = OBJECT_CREATE(null)
    entry.id = result.id
    entry.passed = result.passed === true
    entry.stdout = result.stdout
    entry.stderr = result.stderr
    entry.message = result.message
    entry.signal = result.signal
    entry.durationMs = result.durationMs
    safe[safe.length] = entry
  }
  const payload = OBJECT_CREATE(null)
  payload.tests = safe
  return STRINGIFY(payload)
}

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

function readStream(value) {
  if (value === undefined || value === null) return ""
  return typeof value === "string" ? value : value.toString("utf8")
}

function decodeUnitFrame(raw, nonce) {
  const text = (raw || "").trim()
  if (!text) return { ok: false, message: "the unit runner produced no result" }
  let frame
  try {
    frame = JSON.parse(text)
  } catch (error) {
    return { ok: false, message: "the unit runner produced unreadable output" }
  }
  if (!frame || typeof frame !== "object" || frame.nonce !== nonce) {
    return { ok: false, message: "the unit runner result failed its integrity check" }
  }
  if (frame.ok !== true) {
    return {
      ok: false,
      message: "execution error: " + (typeof frame.error === "string" ? frame.error : "the unit runner failed"),
    }
  }
  return { ok: true, hasValue: frame.hasValue === true, value: frame.value }
}

function runUnit(path, rules) {
  // Student code runs in a separate interpreter. Its stdout/stderr come back as
  // the test's captured output; its only structured report is one nonce-framed
  // JSON object on the result pipe (fd 3).
  const nonce = crypto.randomBytes(16).toString("hex")
  const job = STRINGIFY({
    nonce: nonce,
    sourcePath: path,
    functionName: rules.function,
    args: Array.isArray(rules.args) ? rules.args : [],
    resultFd: 3,
  })

  let run
  try {
    run = spawnSync(process.execPath, ["-e", UNIT_RUNNER], {
      input: job,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    })
  } catch (error) {
    const detail = error && error.message ? String(error.message) : String(error)
    return { ok: false, out: "", err: detail, message: "execution error: " + detail, signal: null }
  }

  const out = typeof run.stdout === "string" ? run.stdout : ""
  const err = typeof run.stderr === "string" ? run.stderr : ""

  if (run.error) {
    const detail = run.error.message ? String(run.error.message) : String(run.error)
    return {
      ok: false,
      out: out,
      err: err + detail,
      message: "execution error: " + detail,
      signal: null,
    }
  }
  if (run.signal) {
    return { ok: false, out: out, err: err, message: "process killed by signal " + run.signal, signal: run.signal }
  }

  const frameRaw = run.output && run.output[3] !== undefined ? readStream(run.output[3]) : ""
  const frame = decodeUnitFrame(frameRaw, nonce)
  if (!frame.ok) return { ok: false, out: out, err: err, message: frame.message, signal: null }
  return { ok: true, out: out, err: err, hasValue: frame.hasValue, value: frame.value }
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
        const run = runUnit(SOURCE_PATH, parseRules(spec.input))
        out = run.out
        err = run.err
        if (!run.ok) {
          message = run.message
          signal = run.signal
        } else {
          const expected = spec.expectedOutput
          if (expected === null || expected === undefined || expected === "") {
            passed = true
            message = "ran without error"
          } else {
            const actual = run.hasValue ? STRINGIFY(run.value) : ""
            passed = normalize(actual) === normalize(expected)
            message = passed ? "returned the expected value" : "returned an unexpected value"
          }
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
    results[results.length] = {
      id: spec.id,
      passed,
      stdout: cap(out),
      stderr: cap(err),
      message: cap(message),
      signal: typeof signal === "string" ? signal : null,
      durationMs: Date.now() - started,
    }
  }

  fs.writeSync(1, SENTINEL + serializeResults(results) + "\n")
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

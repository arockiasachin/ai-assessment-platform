# LLM providers

The platform talks to models through a dependency-free adapter in `lib/llm`. Every
provider implements the same `LlmProvider` interface (`generate`/`embed`), calls
are made with in-repo `fetch`, and one structured `llm.generate` / `llm.embed`
line is emitted per call (see [`observability.md`](./observability.md)).

## Selecting a provider

Selection is one env var:

```bash
LLM_PROVIDER="mock"      # default: deterministic, offline, no API key
LLM_PROVIDER="deepseek"  # DeepSeek-V4.1-Flash (deepseek-flash)
LLM_PROVIDER="openai"    # OpenAI or any OpenAI-shaped endpoint
LLM_PROVIDER="anthropic"
LLM_PROVIDER="ollama"    # local daemon, no API key
```

`openai-compatible` / `openai_compatible` are accepted aliases for `openai`. An
unrecognized value throws an `LlmConfigError` at first use rather than silently
falling back.

**`mock` is the default on purpose.** A missing or blank `LLM_PROVIDER` resolves
to `mock`, so CI and the test suite never construct a live provider or make a
network call. Do not change `DEFAULT_PROVIDER` (`lib/llm/env.ts`) away from
`mock`.

| Provider    | API key env         | Base URL env         | Model env         | Embeddings  |
| ----------- | ------------------- | -------------------- | ----------------- | ----------- |
| `mock`      | —                   | —                    | `MOCK_MODEL`      | yes (local) |
| `openai`    | `OPENAI_API_KEY`    | `OPENAI_BASE_URL`    | `OPENAI_MODEL`    | yes         |
| `deepseek`  | `DEEPSEEK_API_KEY`  | `DEEPSEEK_BASE_URL`  | `DEEPSEEK_MODEL`  | **no**      |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | `ANTHROPIC_MODEL` | **no**      |
| `ollama`    | —                   | `OLLAMA_BASE_URL`    | `OLLAMA_MODEL`    | yes         |

`EMBEDDING_MODEL` is a cross-provider override for the embedding model where the
selected provider supports embeddings. `LLM_TIMEOUT_MS` bounds every request
(default `60000`).

## DeepSeek (DeepSeek-V4.1-Flash)

DeepSeek is a first-class provider, not a "bring your own OpenAI base URL"
exercise. Set:

```bash
LLM_PROVIDER="deepseek"
DEEPSEEK_API_KEY="<your key>"
DEEPSEEK_BASE_URL="https://api.deepseek.com"   # default
DEEPSEEK_MODEL="deepseek-flash"                # default
```

The provider reuses the shared OpenAI-compatible Chat Completions transport but
reports `provider: "deepseek"` on results, errors, logs and `/api/health`, so the
audit trail never claims OpenAI. The canonical model id is **`deepseek-flash`**
(the **DeepSeek-V4.1-Flash** release, GA 2026-09-10); `DEEPSEEK_BASE_URL` +
`/chat/completions` is the OpenAI-compatible chat route.

Do **not** use the retired or deprecated ids: `deepseek-v4-flash` and
`deepseek-v4-flash-vision-exp` are retired (temporarily aliasing to V4.1-Flash),
and `deepseek-chat` / `deepseek-reasoner` were deprecated on 2026-07-24.

### Provenance: `deepseek-flash` is a moving target

DeepSeek publishes **no immutable snapshot id** for `deepseek-flash`. The literal
string "deepseek-flash" can point at a different build tomorrow, which matters
because AI-suggested grades are contestable. To make a grade traceable, the
provider retains the full parsed response in `LlmGenerateResult.raw`, including:

- the response `id`, and
- the provider-supplied `system_fingerprint`.

`evaluateSubmissionForTeacher` already passes `result.raw` into
`recordAiSuggestion` as `rawResponse`, so it lands in the existing
`AIGradeSuggestion.rawResponse` JSON column — together with the `model` column and
the suggestion `createdAt`. No schema change was needed. Use
`model` + `system_fingerprint` + response `id` + `createdAt` to identify the
serving build for a given grade. Treat the fingerprint as DeepSeek's claim about
the build, not a guarantee: it is absent if the provider omits it, and it is not
an immutable snapshot.

### No embeddings route

DeepSeek's verified API surface is chat completions plus an Anthropic-compatible
route; it exposes no embeddings endpoint. `deepseek` therefore reports
`supportsEmbeddings: false` and `embed()` throws `LlmUnsupportedError` instead of
POSTing to a route that does not exist. **Material indexing (retrieval) needs a
separate embedding provider** — the same caveat as Anthropic. Selecting
`LLM_PROVIDER="deepseek"` powers generation and grading but not `indexMaterial`.

## Generation and grading share one model

There is one process-wide provider (`getLlmProvider()`, a lazy singleton). Today
quiz generation and rubric grading use the _same_ configured model; there is no
per-task model policy. The owner left that open. The task tags
(`quiz-generation`, `rubric-grading`, `code-eval`, …) are carried for telemetry
and explainability only and are never sent to the provider, so adding per-task
routing later is a change to the selector rather than to any prompt.

The deterministic quiz auto-scorer is not an LLM call: it records a suggestion
with `model = QUIZ_AUTO_SCORER_MODEL` and a `rawResponse` payload that describes
the scoring, so it carries no `system_fingerprint`.

## Cost, latency, and the mock default

- **`mock`** is zero-cost, zero-latency, and deterministic. It is the only
  provider tests and CI may use.
- **`deepseek-flash`** is a small, fast tier: lower cost and latency than
  frontier models, at the price of a moving-target model id and no embeddings.
  Pricing is not hardcoded in this repository; check DeepSeek's current published
  rates before committing to a budget.
- Per-call cost and latency scale with the number of calls, not only tokens.
  Rubric grading issues **one model call per rubric criterion**, so a ten-criterion
  rubric is ten calls per submission. Every call's `promptTokens`,
  `completionTokens` and `latencyMs` are logged, so per-task cost can be measured
  from the logs.

Switching providers never changes a prompt or a grade by itself: the grading
contracts, the review queue, and the "a human publishes a grade" invariant are
provider-independent.

## Adding a provider

1. Implement `LlmProvider` in `lib/llm/providers/`, or reuse
   `createOpenAiCompatibleProvider` when the vendor is OpenAI-shaped.
2. Add the name to `LlmProviderName` / `LLM_PROVIDER_NAMES` in `lib/llm/types.ts`.
3. Add its env keys and defaults in `lib/llm/env.ts` and a `case` in
   `createLlmProvider` (`lib/llm/index.ts`).
4. Document it here and in `.env.example`, and add an offline test with an
   injected `fetch`.

# Observability

How the platform's runtime behaviour is made visible without adding a dependency
or a vendor SDK. This document is the policy future work should follow.

## Scope

In scope:

- One structured JSON log line per API request and per API response.
- Error capture for unhandled route errors.
- Per-call LLM telemetry (provider, model, task, usage, latency) reusing the
  explainability envelope the provider adapter already returns.
- A reader for the existing `AuditLog` grade-pipeline trail, scoped per teacher.
- A dependency-free `GET /api/health` probe.

**Explicitly not covered** (do not assume these exist):

- **No external APM, metrics backend, or tracing.** There is no Sentry, Datadog,
  OpenTelemetry, Prometheus, or time-series store. Nothing is aggregated or
  shipped off-host. Logs are stdout only.
- **No distributed tracing.** The correlation id groups the lines of one
  request; it is not a span/trace system.
- **No alerting.** Nothing watches the logs. A human (or an external log
  shipper added later) must do that.
- **No per-route dashboard.** The teacher grade-activity view is scoped audit
  data, not an operations dashboard.

## Log line shape

Every line is a single JSON object. Required fields:

| Field       | Type                       | Notes                                                |
| ----------- | -------------------------- | ---------------------------------------------------- |
| `timestamp` | ISO-8601 string            | UTC, `new Date().toISOString()`                      |
| `level`     | `debug\|info\|warn\|error` | threshold set by `LOG_LEVEL`                         |
| `event`     | string                     | e.g. `http.request`, `http.response`, `llm.generate` |
| `service`   | string                     | `assessment-platform`                                |

Common optional fields:

| Field                                                                               | Present when                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `requestId`                                                                         | a correlation id exists                                             |
| `route`                                                                             | route/API request                                                   |
| `method`                                                                            | route/API request                                                   |
| `status`                                                                            | a response was produced                                             |
| `durationMs`                                                                        | a response was produced                                             |
| `userId` / `userRole`                                                               | the session was resolved (`requireRole`/`requireUser` or the proxy) |
| `promptTokens` / `completionTokens` / `totalTokens` / `latencyMs` / `promptVersion` | LLM call                                                            |
| `error`                                                                             | a failure (`{ name, message, stack? }`)                             |

Example:

```json
{
  "timestamp": "2026-09-12T00:00:00.000Z",
  "level": "info",
  "event": "http.response",
  "service": "assessment-platform",
  "requestId": "8f2c…",
  "route": "/api/teacher/analytics",
  "method": "GET",
  "status": 200,
  "durationMs": 41,
  "userId": "clx…",
  "userRole": "teacher"
}
```

## What emits what

1. **`proxy.ts` — `http.request` for every `/api/**` request.** This is the
   universal line: it exists even for routes that have not adopted the wrapper.
   It carries `requestId`, route, method, and the actor decoded from the
   signature-verified session cookie. It does **not** carry status/duration
   (the response has not been produced yet).
2. **`withApiRoute` (in `lib/observability/http.ts`) — `http.response` with
   status and duration**, plus `http.unhandled_error` for anything the handler
   did not catch. It also echoes `x-request-id` on the response. Adoption is
   per route; `GET /api/health` and `GET /api/teacher/observability/grade-activity`
   use it, and new routes should too.
3. **`lib/api.ts` `jsonError`/`jsonSuccess` — `http.error_response` /
   `http.success_response`.** 4xx logs at `debug`, 5xx at `error`; the message
   is redacted by the logger.
4. **`instrumentation.ts` `onRequestError` — `http.unhandled_error`** for errors
   that escape a route handler entirely (routes without their own try/catch).
5. **`lib/llm/observability.ts` — `llm.generate` / `llm.embed`** for every call
   through `createLlmProvider`/`getLlmProvider`, including failures.

### Honest coverage note

Adopting `withApiRoute` adds the response line (status + duration) to any route.
Until a route adopts it, its request is still represented by the proxy
`http.request` line, but the response line is absent. Wrapping all ~55 existing
handlers was deliberately avoided in this pass to keep the change merge-safe
across parallel workstreams; the wrapper is the documented adoption path.

## Redaction policy

Secrets are removed **before** serialization, in two layers
(`lib/observability/redact.ts`):

1. **Key-based.** A value whose key normalises to a sensitive phrase is replaced
   wholesale with `"[redacted]"`: `password`, `passwordHash`, `sessionSecret`,
   `accessToken`, `refreshToken`, `apiKey`, `authorization`, `cookie`,
   `set-cookie`, `privateKey`, `databaseUrl`, `connectionString`, `sessionId`,
   and similar. Usage counters (`promptTokens`, `completionTokens`,
   `totalTokens`) are deliberately **not** sensitive.
2. **String scrubbing.** Free text is scanned for connection strings
   (`postgres://…`, `redis://…`), `Bearer`/`Basic` credentials, the `auth-user`
   cookie, JWT/session-shaped values, private-key blocks, and secret query
   params; each is replaced in place.

**Never logged:** passwords or hashes, session cookie values, `Authorization`
headers, API keys/tokens, connection strings, full request bodies, and student
PII (names, submissions, rationales, evidence quotes) are not logged by default.

**LLM content is opt-in.** `LLM_LOG_CONTENT=true` adds prompt and completion
text to `llm.generate`/`llm.embed`. Use it for local debugging only — prompts
can contain student answers and therefore PII. Redaction still scrubs known
secret shapes, but it cannot identify arbitrary personal data.

The proof is `tests/observability-redaction.test.ts`: it logs a payload full of
distinctive secrets (passwords, a real signed session value, a JWT, a
connection string, `Bearer` tokens, cookie headers) and asserts that none of
them appear in the serialized line.

## Health endpoint

`GET /api/health` — **no auth required.**

- Returns `200` when the database check is `ok` or `skipped`, and `503` with
  `status: "degraded"` when the check is `error` or `timeout`.
- The database probe is a `SELECT 1` bounded by `HEALTH_DB_TIMEOUT_MS`
  (default `1000`, clamped to `50`–`10000`). It is skipped when `DATABASE_URL`
  is unset, so the endpoint never hangs on a slow or absent database.
- The LLM mode is reported from config without constructing a provider:
  `{ provider: "mock" | "openai" | "deepseek" | "anthropic" | "ollama" | "unknown",
mode: "offline" | "live" | "unknown" }`.
- Response shape (`HealthResponse` in `lib/contracts/observability.ts`):

```json
{
  "success": true,
  "status": "ok",
  "timestamp": "2026-09-12T00:00:00.000Z",
  "uptimeSeconds": 123,
  "version": null,
  "commit": null,
  "environment": "production",
  "checks": {
    "app": "ok",
    "database": { "status": "ok", "latencyMs": 3 },
    "llm": { "provider": "mock", "mode": "offline" }
  }
}
```

**What it deliberately does not return:** the connection string, the raw
`LLM_PROVIDER` value, any database error message, stack traces, or filesystem
paths. `success` reports that the probe ran; `status` is the health signal.

`version`/`commit` come from optional env (`APP_VERSION`, `GIT_COMMIT_SHA`,
`GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`) and are `null` when unset.

## Teacher grade-activity view

`GET /api/teacher/observability/grade-activity?offeringId=&limit=` (and the page
`/teacher/observability`).

- **Auth:** `requireRole("teacher")` is the role gate; the service
  (`getRecentGradeActivityForTeacher`) then verifies the offering belongs to the
  caller's staff profile. Unknown offering → `404`, other teacher's offering →
  `403`.
- **Scoping:** audit rows carry no offering id, so the helper resolves the
  offering's assessments, collects the entity ids (`AIGradeSuggestion`, `Grade`,
  `GradeReview`) that belong to them, and reads only those audit rows. A
  teacher can never see another teacher's pipeline, even within the same course.
- **Content:** action, entity label, acting role, timestamp, assessment id, and
  the audit `metadata`/`after` snapshot. No student work, rationale text, or
  evidence quotes are surfaced.
- `limit` defaults to 25 and is capped at 100; `truncated` reports when more
  rows exist.

## Configuration

| Env                    | Default | Meaning                                                  |
| ---------------------- | ------- | -------------------------------------------------------- |
| `LOG_LEVEL`            | `info`  | `debug\|info\|warn\|error\|silent`; tests default silent |
| `LLM_LOG_CONTENT`      | unset   | `true` opts into LLM prompt/response content in logs     |
| `HEALTH_DB_TIMEOUT_MS` | `1000`  | `/api/health` database probe timeout (clamped 50–10000)  |

## How to extend

- **New route:** wrap the handler — `export const GET = withApiRoute(get, { route: "/api/…" })`.
  It then logs a completion line and gets generic-500 error capture for free.
- **New event:** call `logEvent(level, "domain.event", { … })` from
  `@/lib/observability/event`; the ambient request context is merged
  automatically. Keep field names stable and remember the redactor runs last.
- **New sensitive key:** add the phrase to `SENSITIVE_KEY_PATTERN` in
  `lib/observability/redact.ts` and cover it in the redaction test.
- **Purity:** `createLogger` takes an injected sink and clock; keep new code
  testable by threading a `logger` option rather than reaching for globals.

/**
 * Custom ESLint rule: reject a Prisma write payload that collapses an
 * **omitted** field (`undefined`) to an explicit `null`, or that writes the raw
 * request object.
 *
 * This is the structural guard for the data-loss bug class fixed twice:
 *
 * - `PUT /api/teacher/offerings/[offeringId]` nulled four date columns when a
 *   partial body omitted them (`docs/verification/bugfix-run-2.md`);
 * - `PUT /api/teacher/assessments/submissions` read an omitted `score` as
 *   `score: null` and reverted a `GRADED` submission (`docs/verification/bugfix-run-3.md`).
 *
 * The correct pattern is `partialUpdate()` from `lib/partial-update.ts`. The
 * rule is deliberately narrow and high-signal: it fires only inside the `data`
 * payload of a Prisma write call, so serialization helpers that legitimately use
 * `x ?? null` outside a write are not affected. See
 * `docs/engineering/partial-update-guide.md`.
 */

/**
 * Only `update`/`updateMany` are partial updates of an existing row, which is
 * where collapsing "omitted" into `null` destroys data. `upsert` is
 * create-or-replace: its `update` branch is written as a full replacement, so
 * normalising an optional input via `?? null` is intended there and is NOT
 * checked (see the guide's "what the guard does not catch").
 */
const PARTIAL_WRITE_METHODS = new Set(["update", "updateMany"])

/** The payload key a partial write carries. */
const PAYLOAD_KEY = "data"

/** Bare request-object identifiers that must never be written directly. */
const RAW_PAYLOAD_IDENTIFIERS = new Set([
  "body",
  "request",
  "req",
  "rawBody",
  "parsedBody",
  "payload",
])

function isNullLiteral(node) {
  return node?.type === "Literal" && node.value === null
}

function isUndefinedIdentifier(node) {
  return node?.type === "Identifier" && node.name === "undefined"
}

/**
 * True when a conditional test conflates an omitted value with `null`:
 * `x === undefined`, `x !== undefined`, `undefined === x`, loose `x == null`
 * and loose `x != null` (which also match `undefined`). Strict `x === null` is
 * NOT conflating — `null` is an explicit value — so it is not flagged.
 */
function conflatesOmittedWithNull(test) {
  if (!test || test.type !== "BinaryExpression") return false
  const { operator, left, right } = test
  if (!["==", "===", "!=", "!=="].includes(operator)) return false
  if (isUndefinedIdentifier(left) || isUndefinedIdentifier(right)) return true
  const strict = operator === "===" || operator === "!=="
  if (!strict && (isNullLiteral(left) || isNullLiteral(right))) return true
  return false
}

/** The rule module. Exported for `eslint.config.mjs`; no plugin dependency. */
const noUnguardedPartialWrite = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Reject a Prisma write payload that collapses an omitted field to null or writes a raw request object.",
      recommended: false,
    },
    schema: [],
    messages: {
      omittedCollapse:
        "A Prisma write payload turns an omitted field (undefined) into null. Omitted and explicit null must stay distinct: build the payload with partialUpdate() from lib/partial-update.ts.",
      rawPayload:
        'A Prisma write payload is the raw request object "{{name}}". Write only the keys the client actually sent using partialUpdate() from lib/partial-update.ts.',
    },
  },

  create(context) {
    function reportCollapse(node) {
      context.report({ node, messageId: "omittedCollapse" })
    }

    function inspectValue(node) {
      if (!node) return
      if (
        node.type === "LogicalExpression" &&
        node.operator === "??" &&
        isNullLiteral(node.right)
      ) {
        reportCollapse(node)
        return
      }
      if (
        node.type === "ConditionalExpression" &&
        conflatesOmittedWithNull(node.test) &&
        (isNullLiteral(node.consequent) || isNullLiteral(node.alternate))
      ) {
        reportCollapse(node)
        return
      }

      switch (node.type) {
        case "ObjectExpression":
          for (const property of node.properties) {
            if (property.type === "Property") inspectValue(property.value)
            else if (property.type === "SpreadElement") inspectValue(property.argument)
          }
          break
        case "ArrayExpression":
          for (const element of node.elements) inspectValue(element)
          break
        case "CallExpression":
          for (const argument of node.arguments) inspectValue(argument)
          break
        case "LogicalExpression":
          inspectValue(node.left)
          inspectValue(node.right)
          break
        case "ConditionalExpression":
          inspectValue(node.consequent)
          inspectValue(node.alternate)
          break
        default:
          break
      }
    }

    function isWriteCall(node) {
      const callee = node.callee
      return (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier" &&
        PARTIAL_WRITE_METHODS.has(callee.property.name)
      )
    }

    return {
      CallExpression(node) {
        if (!isWriteCall(node)) return
        const first = node.arguments[0]
        if (!first || first.type !== "ObjectExpression") return
        const dataProperty = first.properties.find(
          (property) =>
            property.type === "Property" &&
            !property.computed &&
            property.key.type === "Identifier" &&
            property.key.name === PAYLOAD_KEY,
        )
        if (!dataProperty || dataProperty.type !== "Property") return

        const value = dataProperty.value
        if (value.type === "Identifier" && RAW_PAYLOAD_IDENTIFIERS.has(value.name)) {
          context.report({
            node: value,
            messageId: "rawPayload",
            data: { name: value.name },
          })
          return
        }
        inspectValue(value)
      },
    }
  },
}

export default noUnguardedPartialWrite

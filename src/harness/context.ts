import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { type HarnessContext, HarnessContextSchema } from "../contracts/harness-schemas"
import type { JsonValue } from "../shared/json"
import type { ToolName } from "../tools/catalog"
import { toolPolicies } from "../tools/catalog"

export function decodeHarnessContext(
  encoded: string | undefined,
  signature: string | undefined,
  verificationSecret: string | undefined,
): HarnessContext | undefined {
  if (encoded === undefined && signature === undefined) {
    if (verificationSecret !== undefined) throw new Error("HARNESS_CONTEXT_REQUIRED")
    return undefined
  }
  if (encoded === undefined || signature === undefined) throw new Error("HARNESS_CONTEXT_UNSIGNED")
  if (verificationSecret === undefined) throw new Error("HARNESS_CONTEXT_VERIFIER_NOT_CONFIGURED")
  const expected = createHmac("sha256", verificationSecret).update(encoded).digest()
  const supplied = Buffer.from(signature, "base64url")
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new Error("HARNESS_CONTEXT_SIGNATURE_INVALID")
  return HarnessContextSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")))
}

export function encodeHarnessContext(context: HarnessContext, secret: string) {
  const encoded = Buffer.from(JSON.stringify(HarnessContextSchema.parse(context))).toString(
    "base64url",
  )
  return {
    encoded,
    signature: createHmac("sha256", secret).update(encoded).digest("base64url"),
  }
}

export function isToolAllowed(context: HarnessContext | undefined, toolName: ToolName): boolean {
  if (context === undefined) return true
  if (context.allowedTools.length > 0 && !context.allowedTools.includes(toolName)) return false
  const policy = toolPolicies[toolName]
  if (context.profile === "operations") return true
  if (context.profile === "read") return !policy.mutatesNetSuite && policy.risk === "low"
  return toolName !== "ns_commitAction" && toolName !== "ns_revokeOAuthAuthorization"
}

export function defaultHarnessContext(
  environment: "sandbox" | "production",
  requester: string,
  client: string,
): HarnessContext | undefined {
  if (environment !== "production") return undefined
  const scope = createHash("sha256").update(`${requester}\0${client}`).digest("hex").slice(0, 24)
  return HarnessContextSchema.parse({
    version: 1,
    scopeId: `production-default:${scope}`,
    provider: client,
    subject: requester,
    profile: "preview",
    budgets: { calls: 100, rows: 10000, records: 1000, runtimeMs: 120000 },
    sensitivity: { piiFields: [], piiMode: "redact" },
    approvals: { requiredForRisks: ["medium", "high", "critical"], decisions: [] },
  })
}

export function assertRequestScope(context: HarnessContext | undefined, value: JsonValue): void {
  if (context === undefined || context.allowedRecordTypes.length === 0) return
  const allowed = new Set(context.allowedRecordTypes.map((entry) => entry.toLowerCase()))
  const root = value as { readonly [key: string]: JsonValue }
  if (
    !Array.isArray(value) &&
    value !== null &&
    typeof value === "object" &&
    typeof root["type"] === "string" &&
    !allowed.has(root["type"].toLowerCase())
  )
    throw new Error(`HARNESS_RECORD_TYPE_NOT_ALLOWED: ${root["type"]}`)
  visit(value, (key, current) => {
    if (
      ["recordtype", "fromtype", "totype", "sourcerecordtype", "targetrecordtype"].includes(
        key.toLowerCase(),
      ) &&
      typeof current === "string" &&
      !allowed.has(current.toLowerCase())
    )
      throw new Error(`HARNESS_RECORD_TYPE_NOT_ALLOWED: ${current}`)
  })
}

export function redactForHarness(context: HarnessContext | undefined, value: JsonValue): JsonValue {
  const pii = new Set(context?.sensitivity.piiFields.map((entry) => entry.toLowerCase()) ?? [])
  const redactPii = context?.sensitivity.piiMode !== "show"
  return redactValue(value, pii, redactPii)
}

function isBuiltInPiiField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (/email|phone|address/.test(normalized)) return true
  return new Set([
    "addressee",
    "attention",
    "entityname",
    "firstname",
    "lastname",
    "mobile",
    "refname",
    "systemnoteuser",
    "user",
    "postalcode",
    "postcode",
    "zip",
    "zipcode",
  ]).has(normalized)
}

function redactValue(value: JsonValue, pii: ReadonlySet<string>, redactPii: boolean): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, pii, redactPii))
  if (value === null || typeof value !== "object") return value

  const descriptor = Object.entries(value)
    .filter(([key]) => /^(field|fieldid|fieldname)$/i.test(key))
    .map(([, current]) => (typeof current === "string" ? current : ""))
    .join(" ")
  const sensitiveChange = redactPii && isSensitiveDescriptor(descriptor, pii)

  return Object.fromEntries(
    Object.entries(value).map(([key, current]) => {
      if (/secret|token|password|private.?key|authorization|credential/i.test(key))
        return [key, "[REDACTED]"]
      if (
        redactPii &&
        (pii.has(key.toLowerCase()) ||
          isBuiltInPiiField(key) ||
          (sensitiveChange && /^(oldvalue|newvalue|value|text)$/i.test(key)) ||
          (typeof current === "string" && looksLikeMultilineAddress(current)))
      )
        return [key, "[REDACTED]"]
      return [key, redactValue(current, pii, redactPii)]
    }),
  )
}

function isSensitiveDescriptor(value: string, pii: ReadonlySet<string>): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "")
  return (
    [...pii].some((entry) => normalized.includes(entry.replace(/[^a-z0-9]/g, ""))) ||
    isBuiltInPiiField(normalized) ||
    /customer|employee|entity|person|vendor|contact|name/.test(normalized)
  )
}

function looksLikeMultilineAddress(value: string): boolean {
  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) return false
  return (
    lines.length >= 3 ||
    /\b(street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|mahallesi|mah\.?|sokak|sok\.?|cadde|cad\.?|posta|postal|zip)\b/i.test(
      value,
    )
  )
}

function visit(value: JsonValue, callback: (key: string, value: JsonValue) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, callback)
    return
  }
  if (value === null || typeof value !== "object") return
  for (const [key, current] of Object.entries(value)) {
    callback(key, current)
    visit(current, callback)
  }
}

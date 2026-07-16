import { createHash } from "node:crypto"
import { type JsonObject, type JsonValue, redactJson } from "../shared/json"

export function evidenceFingerprint(value: JsonValue): string {
  return sha256(JSON.stringify(canonical(stripDateTime(value))))
}

export function repairProposal<
  T extends {
    repairClass: string
    financial: boolean
    destructive: boolean
    operationId?: string | undefined
  },
>(input: T, allowedRepairClasses: readonly string[] = []) {
  const configuredLowRisk = allowedRepairClasses.includes(input.repairClass)
  const proposalOnly = input.financial || input.destructive || !configuredLowRisk
  return {
    ...input,
    configuredLowRisk,
    proposalOnly,
    requiresOperationProtocol:
      input.operationId !== undefined || input.financial || input.destructive,
    requiresHarnessApproval: true,
    executesRepair: false,
  }
}

export function correlateIncidents(input: {
  events: Array<Record<string, unknown>>
  similarityThreshold: number
}) {
  const groups: Array<{
    key: string
    method: "deterministic" | "similarity"
    confidence: number
    events: Array<Record<string, unknown>>
  }> = []
  for (const event of input.events) {
    const deterministic = deterministicKey(event)
    if (deterministic !== undefined) {
      const group = groups.find(
        (candidate) => candidate.method === "deterministic" && candidate.key === deterministic,
      )
      if (group) group.events.push(event)
      else
        groups.push({ key: deterministic, method: "deterministic", confidence: 1, events: [event] })
      continue
    }
    const tokens = messageTokens(String(event["message"] ?? ""))
    const match = groups.find(
      (candidate) =>
        candidate.method === "similarity" &&
        jaccard(tokens, messageTokens(String(candidate.events[0]?.["message"] ?? ""))) >=
          input.similarityThreshold,
    )
    if (match) match.events.push(event)
    else
      groups.push({
        key: `similarity:${sha256([...tokens].sort().join(" ")).slice(0, 16)}`,
        method: "similarity",
        confidence: input.similarityThreshold,
        events: [event],
      })
  }
  return {
    groups: groups.map((group) => ({ ...group, count: group.events.length })),
    count: groups.length,
  }
}

export function measureSla(
  measurements: Array<{
    id: string
    targetDurationMs: number
    actualDurationMs: number
    evidence: unknown[]
  }>,
) {
  const results = measurements.map((measurement) => ({
    ...measurement,
    met: measurement.actualDurationMs <= measurement.targetDurationMs,
    varianceMs: measurement.actualDurationMs - measurement.targetDurationMs,
  }))
  return {
    results,
    met: results.filter((result) => result.met).length,
    breached: results.filter((result) => !result.met).length,
    alerts: results
      .filter((result) => !result.met)
      .map((result) => ({
        id: result.id,
        severity: "breach",
        varianceMs: result.varianceMs,
        evidence: result.evidence,
      })),
  }
}

export function supportEvidenceBundle(input: {
  name: string
  claims: unknown[]
  reproducibleQueries: unknown[]
}) {
  const original = input as unknown as JsonValue
  const redacted = redactJson(original) as JsonObject
  const redactionChanged = JSON.stringify(original) !== JSON.stringify(redacted)
  const files = [
    file(`evidence/${input.name}/claims.json`, redacted["claims"] ?? []),
    file(`evidence/${input.name}/queries.json`, redacted["reproducibleQueries"] ?? []),
  ]
  const manifest = {
    format: "netsuite-supermcp-support-evidence-v1",
    files: files.map(({ path, sha256: hash, bytes }) => ({ path, sha256: hash, bytes })),
  }
  return {
    manifest: { ...manifest, sha256: sha256(JSON.stringify(canonical(manifest))) },
    files,
    redactionReport: {
      changed: redactionChanged,
      secretFieldsRedacted: redactionChanged,
      rawSecretsIncluded: false,
    },
  }
}

export function liveDocumentation(input: {
  title: string
  sources: Array<{ kind: string; id: string; definition: JsonValue; evidence: unknown[] }>
}) {
  const sources = [...input.sources].sort((a, b) =>
    compare(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`),
  )
  const sourceFingerprint = evidenceFingerprint(sources as unknown as JsonValue)
  return {
    title: input.title,
    version: sourceFingerprint.slice(0, 16),
    sourceFingerprint,
    sections: sources.map((source) => ({
      kind: source.kind,
      id: source.id,
      definition: source.definition,
      evidence: source.evidence,
    })),
    sourceMode: "caller-supplied-live-metadata",
  }
}

function deterministicKey(event: Record<string, unknown>): string | undefined {
  for (const key of [
    "executionId",
    "scriptId",
    "integrationId",
    "recordRef",
    "jobId",
    "fileId",
    "alertCode",
  ]) {
    const value = event[key]
    if (typeof value === "string" && value.length > 0) return `${key}:${value}`
  }
  return undefined
}
function messageTokens(message: string) {
  return new Set(
    message
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  )
}
function jaccard(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((entry) => right.has(entry)).length
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : intersection / union
}
function file(path: string, payload: JsonValue) {
  const contents = JSON.stringify(canonical(payload))
  return { path, payload, sha256: sha256(contents), bytes: Buffer.byteLength(contents) }
}
function stripDateTime(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stripDateTime)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => !/^(date|time|timestamp|trandate|createddate|lastmodifieddate)$/i.test(key),
      )
      .map(([key, entry]) => [key, stripDateTime(entry)]),
  )
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  return value
}
function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

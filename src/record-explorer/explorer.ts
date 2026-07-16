import { createHash } from "node:crypto"
import type { NetSuiteClient } from "../netsuite/client"
import { snapshotFingerprint } from "../operations/snapshot"
import { type JsonObject, type JsonValue, redactJson } from "../shared/json"

export type RecordRef = { readonly type: string; readonly id: string }

export async function readRecordTypeMetadata(client: NetSuiteClient, type: string) {
  try {
    const metadata = await client.getRecordMetadata({
      type,
      select: [],
      mediaType: "application/json",
    })
    return { source: "restMetadata", metadata }
  } catch (error) {
    const metadata = await client.runRestletAction({
      action: "ns_describeRecordTypeFallback",
      phase: "preview",
      payload: { recordType: type },
    })
    return {
      source: "suiteScriptFallback",
      metadata,
      restMetadataGap: errorMessage(error),
    }
  }
}

export function extractRecordTypes(
  metadata: JsonObject,
  search: string | undefined,
  limit: number,
) {
  const candidates = collectObjects(metadata)
    .map((entry) => ({
      id: text(entry["name"] ?? entry["id"] ?? entry["recordType"]),
      label: text(entry["title"] ?? entry["label"] ?? entry["name"]),
      source: entry,
    }))
    .filter((entry) => entry.id.length > 0)
  const needle = search?.toLowerCase()
  const filtered = needle
    ? candidates.filter(
        (entry) =>
          entry.id.toLowerCase().includes(needle) || entry.label.toLowerCase().includes(needle),
      )
    : candidates
  return {
    results: filtered.slice(0, limit),
    count: filtered.length,
    truncated: filtered.length > limit,
  }
}

export function extractFields(metadata: JsonValue) {
  const objects = collectObjects(metadata)
  const fields = objects
    .map((entry) => ({
      id: text(entry["name"] ?? entry["id"] ?? entry["fieldId"]),
      label: text(entry["title"] ?? entry["label"] ?? entry["name"]),
      type: text(entry["type"] ?? entry["dataType"]),
      required: entry["required"] === true || entry["nullable"] === false,
      readOnly: entry["readOnly"] === true,
      source: entry,
    }))
    .filter((entry) => entry.id.length > 0)
  return uniqueBy(fields, (field) => field.id)
}

export async function batchGetRecords(client: NetSuiteClient, records: readonly RecordRef[]) {
  const results: (
    | { ok: true; ref: RecordRef; record: JsonObject }
    | { ok: false; ref: RecordRef; error: string }
  )[] = []
  for (let start = 0; start < records.length; start += 10) {
    const chunk = records.slice(start, start + 10)
    results.push(
      ...(await Promise.all(
        chunk.map(async (ref) => {
          try {
            return { ok: true as const, ref, record: await client.getRecord(ref) }
          } catch (error) {
            return { ok: false as const, ref, error: errorMessage(error) }
          }
        }),
      )),
    )
  }
  return {
    results,
    count: results.length,
    partial: results.some((result) => !result.ok),
    gaps: results.filter((result) => !result.ok),
  }
}

export async function createRecordSnapshot(
  client: NetSuiteClient,
  ref: RecordRef,
  sublists: readonly string[],
  lineLimit: number,
) {
  const record = await client.getRecord(ref)
  const sublistValues: Record<string, JsonValue> = {}
  if (sublists.length > 0) {
    const expanded = await client.runRestletAction({
      action: "ns_getRecordWithSublists",
      phase: "preview",
      payload: { recordType: ref.type, recordId: ref.id, sublists, lineLimit },
    })
    const value = expanded["sublists"]
    if (
      value !== undefined &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      Object.assign(sublistValues, value)
    }
  }
  const snapshot = { ref, record, sublists: sublistValues }
  return { ...snapshot, fingerprint: snapshotFingerprint(snapshot) }
}

export function diffSnapshots(before: JsonValue, after: JsonValue) {
  const changes: { path: string; before?: JsonValue; after?: JsonValue }[] = []
  walkDiff(before, after, "$", changes)
  return { changes, count: changes.length, identical: changes.length === 0 }
}

export function createEvidenceBundle(name: string, items: readonly JsonObject[]) {
  const files = items.map((item, index) => {
    const path = `evidence/${name}/${String(index + 1).padStart(4, "0")}-${safeName(text(item["kind"]))}.json`
    const payload = redactJson(item)
    const contents = canonicalJson(payload)
    return { path, sha256: sha256(contents), bytes: Buffer.byteLength(contents), payload }
  })
  const manifest = {
    format: "netsuite-supermcp-evidence-v1",
    name,
    files: files.map(({ path, sha256: hash, bytes }) => ({ path, sha256: hash, bytes })),
  }
  return {
    manifest: { ...manifest, sha256: sha256(canonicalJson(manifest)) },
    files,
    count: files.length,
  }
}

export function transactionHypotheses(chain: JsonObject, notes: JsonObject | undefined) {
  const gaps = Array.isArray(chain["gaps"]) ? chain["gaps"] : []
  const nodes = Array.isArray(chain["nodes"]) ? chain["nodes"] : []
  const events = notes && Array.isArray(notes["events"]) ? notes["events"] : []
  const hypotheses: JsonValue[] = []
  if (gaps.length > 0) {
    hypotheses.push({
      rank: hypotheses.length + 1,
      code: "PARTIAL_VISIBILITY",
      confidence: "high",
      evidence: gaps,
      explanation:
        "One or more related-record probes were not visible to the active NetSuite role.",
    })
  }
  if (nodes.length <= 1) {
    hypotheses.push({
      rank: hypotheses.length + 1,
      code: "NO_RELATED_TRANSACTION_VISIBLE",
      confidence: "medium",
      evidence: [{ kind: "record", nodeCount: nodes.length }],
      explanation: "No downstream or upstream transaction is visible from the selected record.",
    })
  }
  if (events.length === 0) {
    hypotheses.push({
      rank: hypotheses.length + 1,
      code: "NO_SYSTEM_NOTES_VISIBLE",
      confidence: "low",
      evidence: [{ kind: "systemNotes", eventCount: 0 }],
      explanation:
        "No System Notes were returned; this can indicate no changes or insufficient visibility.",
    })
  }
  return hypotheses
}

function collectObjects(value: JsonValue): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(collectObjects)
  if (value === null || typeof value !== "object") return []
  const object = value as JsonObject
  return [object, ...Object.values(object).flatMap(collectObjects)]
}

function walkDiff(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  path: string,
  changes: { path: string; before?: JsonValue; after?: JsonValue }[],
) {
  if (canonicalJson(before ?? null) === canonicalJson(after ?? null)) return
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of [...keys].sort()) {
      if (!isDateTimeKey(key)) walkDiff(before[key], after[key], `${path}.${key}`, changes)
    }
    return
  }
  changes.push({
    path,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  })
}

function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key] as JsonValue)]),
  )
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function isDateTimeKey(key: string): boolean {
  return /^(date|time|timestamp|trandate|createddate|lastmodifieddate)$/i.test(key)
}

function safeName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  )
}

function text(value: JsonValue | undefined): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

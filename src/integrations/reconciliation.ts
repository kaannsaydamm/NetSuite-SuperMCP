import { createHash } from "node:crypto"
import type { z } from "zod"
import type {
  IntegrationContractSchema,
  ReconcileRecordsInputSchema,
} from "../contracts/integration-schemas"
import type { JsonObject, JsonValue } from "../shared/json"

export type IntegrationContract = z.infer<typeof IntegrationContractSchema>
export type ReconcileInput = z.infer<typeof ReconcileRecordsInputSchema>

export interface IntegrationAdapter {
  readonly name: string
  readCanonicalRecords(): Promise<readonly ReconcileInput["sourceRecords"][number][]>
}

export function validateContractRecords(
  contract: IntegrationContract,
  records: ReconcileInput["sourceRecords"],
) {
  const violations: JsonObject[] = []
  const seen = new Map<string, number>()
  for (const [index, record] of records.entries()) {
    seen.set(record.matchKey, (seen.get(record.matchKey) ?? 0) + 1)
    for (const [field, definition] of Object.entries(contract.fields)) {
      const value = record.fields[field]
      if (definition.required && value === undefined) {
        violations.push({ index, matchKey: record.matchKey, field, rule: "required" })
      } else if (value !== undefined && valueType(value) !== definition.type) {
        violations.push({
          index,
          matchKey: record.matchKey,
          field,
          rule: "type",
          expected: definition.type,
          actual: valueType(value),
        })
      }
    }
    for (const invariant of contract.invariants) {
      const value = record.fields[invariant.field]
      if (invariant.rule === "nonnegative" && typeof value === "number" && value < 0) {
        violations.push({
          index,
          matchKey: record.matchKey,
          field: invariant.field,
          rule: invariant.rule,
        })
      }
      if (invariant.rule === "required" && value === undefined) {
        violations.push({
          index,
          matchKey: record.matchKey,
          field: invariant.field,
          rule: invariant.rule,
        })
      }
    }
  }
  for (const [matchKey, count] of seen) {
    if (count > 1) violations.push({ matchKey, count, rule: "unique" })
  }
  return { valid: violations.length === 0, recordCount: records.length, violations }
}

export function reconcileRecords(input: ReconcileInput) {
  const source = indexRecords(input.sourceRecords)
  const target = indexRecords(input.targetRecords)
  const differences: JsonObject[] = []
  for (const duplicate of [...source.duplicates, ...target.duplicates]) {
    differences.push({ classification: "duplicate", ...duplicate })
  }
  for (const [key, record] of source.unique) {
    const targetRecord = target.unique.get(key)
    if (targetRecord === undefined) {
      differences.push({
        classification: "missing",
        matchKey: key,
        sourceEvidence: record.evidence,
      })
      continue
    }
    for (const [field, definition] of Object.entries(input.contract.fields)) {
      const sourceValue = record.fields[field]
      const targetValue = targetRecord.fields[field]
      if (!jsonEqual(sourceValue, targetValue)) {
        differences.push({
          classification: mismatchClass(definition.semantic),
          matchKey: key,
          field,
          sourceValue: sourceValue ?? null,
          targetValue: targetValue ?? null,
          sourceEvidence: record.evidence,
          targetEvidence: targetRecord.evidence,
        })
      }
    }
  }
  for (const [key, record] of target.unique) {
    if (!source.unique.has(key)) {
      differences.push({ classification: "extra", matchKey: key, targetEvidence: record.evidence })
    }
  }
  const classifications = countBy(differences, "classification")
  return {
    domain: input.domain,
    sourceName: input.sourceName,
    targetName: input.targetName,
    totals: {
      source: input.sourceRecords.length,
      target: input.targetRecords.length,
      differences: differences.length,
      classifications,
    },
    differences,
  }
}

export function groupIncidents(errors: ReadonlyArray<JsonObject>) {
  const groups = new Map<string, JsonObject[]>()
  for (const error of errors) {
    const key = [error["executionId"], error["scriptId"], error["recordId"], error["code"]]
      .filter((entry) => typeof entry === "string" && entry.length > 0)
      .join(":")
    const deterministicKey =
      key.length > 0 ? key : `message:${fingerprint(String(error["message"] ?? "unknown"))}`
    groups.set(deterministicKey, [...(groups.get(deterministicKey) ?? []), error])
  }
  return [...groups.entries()].map(([incidentKey, entries]) => ({
    incidentKey,
    count: entries.length,
    entries,
  }))
}

export function anonymizeRecords(
  records: readonly JsonObject[],
  fields: readonly string[],
  salt: string,
) {
  return records.map((record) => {
    const next = structuredClone(record) as Record<string, JsonValue>
    for (const field of fields) {
      if (next[field] !== undefined)
        next[field] = `anon_${fingerprint(`${salt}:${JSON.stringify(next[field])}`)}`
    }
    return next
  })
}

export function syntheticTransactions(
  count: number,
  seed: string,
  template: JsonObject,
  sequenceFields: readonly string[],
) {
  return Array.from({ length: count }, (_, index) => {
    const record = structuredClone(template) as Record<string, JsonValue>
    for (const field of sequenceFields) record[field] = `${seed}_${index + 1}`
    return record
  })
}

function indexRecords(records: ReconcileInput["sourceRecords"]) {
  const buckets = new Map<string, ReconcileInput["sourceRecords"]>()
  for (const record of records)
    buckets.set(record.matchKey, [...(buckets.get(record.matchKey) ?? []), record])
  const unique = new Map<string, ReconcileInput["sourceRecords"][number]>()
  const duplicates: JsonObject[] = []
  for (const [matchKey, entries] of buckets) {
    if (entries.length === 1 && entries[0] !== undefined) unique.set(matchKey, entries[0])
    else
      duplicates.push({
        matchKey,
        count: entries.length,
        evidence: entries.flatMap((entry) => entry.evidence),
      })
  }
  return { unique, duplicates }
}

function mismatchClass(semantic: string): string {
  if (semantic === "amount") return "amountMismatch"
  if (semantic === "status") return "statusMismatch"
  if (semantic === "quantity") return "quantityMismatch"
  if (semantic === "processing") return "delayedProcessing"
  return "valueMismatch"
}

function countBy(entries: readonly JsonObject[], field: string): JsonObject {
  const counts: Record<string, JsonValue> = {}
  for (const entry of entries) {
    const key = String(entry[field] ?? "unknown")
    counts[key] = Number(counts[key] ?? 0) + 1
  }
  return counts
}

function jsonEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function valueType(value: JsonValue): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

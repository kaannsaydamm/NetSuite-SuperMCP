import { createHash } from "node:crypto"
import type { JsonValue } from "../shared/json"

const EXCLUDED_DATE_TIME_KEYS = new Set([
  "date",
  "time",
  "timestamp",
  "trandate",
  "createddate",
  "lastmodifieddate",
])

export function snapshotFingerprint(snapshot: JsonValue): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex")
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: JsonValue): JsonValue {
  if (isJsonArray(value)) {
    const items = value.map(canonicalValue)
    if (items.every(isLineObject)) {
      return [...items].sort((left, right) => Number(left.line) - Number(right.line))
    }
    return items
  }
  if (value === null || typeof value !== "object") {
    return value
  }

  const objectValue = value as { readonly [key: string]: JsonValue }
  const result: Record<string, JsonValue> = {}
  for (const key of Object.keys(objectValue).sort()) {
    const entry = objectValue[key]
    if (entry !== undefined && !EXCLUDED_DATE_TIME_KEYS.has(key.toLowerCase())) {
      result[key] = canonicalValue(entry)
    }
  }
  return result
}

function isLineObject(
  value: JsonValue,
): value is { readonly line: number } & Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !isJsonArray(value) &&
    typeof (value as { readonly line?: JsonValue }).line === "number"
  )
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value)
}

import { z } from "zod"

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type JsonObject = { readonly [key: string]: JsonValue }

export function redactJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item))
  }

  if (typeof value !== "object" || value === null) {
    return value
  }

  const redacted: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = shouldRedact(key) ? "[REDACTED]" : redactJson(entry)
  }
  return redacted
}

function shouldRedact(key: string): boolean {
  return /token|secret|password|private[_-]?key|certificate|authorization/i.test(key)
}

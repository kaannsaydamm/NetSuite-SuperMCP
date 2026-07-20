import { createHash, randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import type { NetSuiteEnvironment } from "./config"
import type { ToolRisk } from "./policy"
import type { JsonObject, JsonValue } from "./shared/json"

const AuditStatusSchema = z.enum(["allowed", "blocked", "succeeded", "failed"])
const AuditRiskSchema = z.enum(["low", "medium", "high", "critical"])
export type AuditStatus = z.infer<typeof AuditStatusSchema>

export type AuditWriteEvent = {
  readonly timestamp: string
  readonly status: AuditStatus
  readonly toolName: string
  readonly risk: ToolRisk
  readonly environment: NetSuiteEnvironment
  readonly requester: string
  readonly requestId: string
  readonly client: string
  readonly durationMs?: number
  readonly input: JsonObject
  readonly result: JsonObject
}

const StoredAuditEventSchema = z.object({
  timestamp: z.string().datetime(),
  status: AuditStatusSchema,
  toolName: z.string().min(1),
  risk: AuditRiskSchema,
  environment: z.enum(["sandbox", "production"]),
  requester: z.string().min(1),
  requestId: z.string().uuid(),
  client: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  recordType: z.string().min(1).optional(),
  recordId: z.string().min(1).optional(),
  resultCount: z.number().int().nonnegative().optional(),
  fingerprint: z.string().length(64),
  errorCode: z.string().min(1).optional(),
})
export type AuditEvent = z.infer<typeof StoredAuditEventSchema>

export class AuditLog {
  private sanitizePromise: Promise<void> | undefined
  constructor(readonly path: string) {}

  async write(event: AuditWriteEvent): Promise<void> {
    await this.ensureSanitized()
    const parsed = summarizeAuditEvent(event)
    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(this.path, `${JSON.stringify(parsed)}\n`, "utf8")
  }

  async readRecent(limit: number): Promise<readonly AuditEvent[]> {
    try {
      await this.ensureSanitized()
      const content = await readFile(this.path, "utf8")
      const lines = content.split("\n").filter((line) => line.length > 0)
      return lines
        .slice(Math.max(0, lines.length - limit))
        .map((line) => summarizeStoredOrLegacyEvent(JSON.parse(line)))
        .reverse()
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
  }

  private async ensureSanitized(): Promise<void> {
    this.sanitizePromise ??= this.sanitizeExisting()
    await this.sanitizePromise
  }

  private async sanitizeExisting(): Promise<void> {
    try {
      const content = await readFile(this.path, "utf8")
      const lines = content.split("\n").filter((line) => line.length > 0)
      if (lines.length === 0) return
      const compacted = `${lines
        .map((line) => JSON.stringify(summarizeStoredOrLegacyEvent(JSON.parse(line))))
        .join("\n")}\n`
      if (compacted === content) return
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, compacted, "utf8")
      await rename(temporary, this.path)
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
  }
}

function summarizeAuditEvent(event: AuditWriteEvent): AuditEvent {
  const recordType = firstString(event.input, [
    "type",
    "recordType",
    "fromType",
    "sourceRecordType",
  ])
  const recordId = firstString(event.input, ["id", "recordId", "sourceRecordId"])
  const resultCount = extractResultCount(event.result)
  const errorCode = extractErrorCode(event.result)
  return StoredAuditEventSchema.parse({
    timestamp: event.timestamp,
    status: event.status,
    toolName: event.toolName,
    risk: event.risk,
    environment: event.environment,
    requester: event.requester,
    requestId: event.requestId,
    client: event.client,
    durationMs: Math.max(0, Math.round(event.durationMs ?? 0)),
    ...(recordType === undefined ? {} : { recordType }),
    ...(recordId === undefined ? {} : { recordId }),
    ...(resultCount === undefined ? {} : { resultCount }),
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          toolName: event.toolName,
          requestId: event.requestId,
          status: event.status,
          recordType,
          recordId,
          resultCount,
        }),
      )
      .digest("hex"),
    ...(errorCode === undefined ? {} : { errorCode }),
  })
}

function summarizeStoredOrLegacyEvent(value: unknown): AuditEvent {
  const stored = StoredAuditEventSchema.safeParse(value)
  if (stored.success) return stored.data
  const legacy = z
    .object({
      timestamp: z.string(),
      status: AuditStatusSchema,
      toolName: z.string(),
      risk: AuditRiskSchema,
      environment: z.enum(["sandbox", "production"]),
      requester: z.string(),
      requestId: z.string(),
      client: z.string(),
      input: z.record(z.string(), z.unknown()),
      result: z.record(z.string(), z.unknown()),
    })
    .parse(value)
  return summarizeAuditEvent({
    ...legacy,
    input: legacy.input as JsonObject,
    result: legacy.result as JsonObject,
  })
}

function firstString(value: JsonObject, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate.length > 0) return candidate
  }
  return undefined
}

function extractResultCount(result: JsonObject): number | undefined {
  for (const key of ["count", "totalCount", "rowCount", "resultCount"]) {
    const value = result[key]
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value
  }
  for (const key of ["items", "results", "events", "records", "rows"]) {
    const value = result[key]
    if (Array.isArray(value)) return value.length
  }
  return undefined
}

function extractErrorCode(result: JsonObject): string | undefined {
  const error = result["error"]
  if (typeof error === "string") return error
  if (isObject(error) && typeof error["code"] === "string") return error["code"]
  return typeof result["code"] === "string" ? result["code"] : undefined
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

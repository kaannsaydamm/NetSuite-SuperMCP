import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import type { NetSuiteEnvironment } from "./config"
import type { ToolRisk } from "./policy"
import { type JsonObject, JsonValueSchema, redactJson } from "./shared/json"

const AuditStatusSchema = z.enum(["allowed", "blocked", "succeeded", "failed"])
const AuditRiskSchema = z.enum(["low", "medium", "high", "critical"])
export type AuditStatus = z.infer<typeof AuditStatusSchema>

export type AuditEvent = {
  readonly timestamp: string
  readonly status: AuditStatus
  readonly toolName: string
  readonly risk: ToolRisk
  readonly environment: NetSuiteEnvironment
  readonly requester: string
  readonly client: string
  readonly input: JsonObject
  readonly result: JsonObject
}

const AuditEventSchema = z.object({
  timestamp: z.string().datetime(),
  status: AuditStatusSchema,
  toolName: z.string().min(1),
  risk: AuditRiskSchema,
  environment: z.enum(["sandbox", "production"]),
  requester: z.string().min(1),
  client: z.string().min(1),
  input: z.record(z.string(), JsonValueSchema),
  result: z.record(z.string(), JsonValueSchema),
})

export class AuditLog {
  constructor(readonly path: string) {}

  async write(event: AuditEvent): Promise<void> {
    const parsed = AuditEventSchema.parse({
      ...event,
      input: redactJson(event.input),
      result: redactJson(event.result),
    })

    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(this.path, `${JSON.stringify(parsed)}\n`, "utf8")
  }

  async readRecent(limit: number): Promise<readonly AuditEvent[]> {
    try {
      const content = await readFile(this.path, "utf8")
      const lines = content.split("\n").filter((line) => line.length > 0)
      return lines
        .slice(Math.max(0, lines.length - limit))
        .map((line) => AuditEventSchema.parse(JSON.parse(line)))
        .reverse()
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }
      throw error
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { RunbookDefinitionSchema } from "../contracts/runbook-schemas"
import { type JsonValue, JsonValueSchema } from "../shared/json"
import { evidenceFingerprint } from "./runbook"

const DefinitionSchema = z.object({
  owner: z.string().min(1),
  fingerprint: z.string().length(64),
  definition: RunbookDefinitionSchema,
})
const ExecutionSchema = z.object({
  id: z.string().uuid(),
  owner: z.string().min(1),
  runbookId: z.string(),
  runbookVersion: z.string(),
  definitionFingerprint: z.string().length(64),
  baselineEvidenceFingerprint: z.string().length(64),
  state: z.enum(["running", "completed", "failed", "stopped"]),
  nextStepIndex: z.number().int().nonnegative(),
  steps: z.array(
    z.object({
      id: z.string(),
      state: z.enum(["pending", "completed", "failed", "stopped"]),
      evidenceFingerprint: z.string().length(64).optional(),
      result: JsonValueSchema.optional(),
      operationId: z.string().uuid().optional(),
    }),
  ),
})
const ClaimSchema = z.object({
  owner: z.string(),
  claimId: z.string(),
  version: z.number().int().positive(),
  statement: z.string(),
  confidence: z.number(),
  evidence: z.array(JsonValueSchema),
  fingerprint: z.string().length(64),
  supersededBy: z.number().int().positive().optional(),
})
const StoreSchema = z.object({
  definitions: z.array(DefinitionSchema),
  executions: z.array(ExecutionSchema),
  claims: z.array(ClaimSchema),
})
type Store = z.infer<typeof StoreSchema>

export class RunbookStore {
  private queue: Promise<void> = Promise.resolve()
  constructor(readonly path: string) {}

  async define(owner: string, definition: z.infer<typeof RunbookDefinitionSchema>) {
    return await this.write(async (store) => {
      const fingerprint = evidenceFingerprint(definition)
      const existing = store.definitions.find(
        (entry) =>
          entry.owner === owner &&
          entry.definition.id === definition.id &&
          entry.definition.version === definition.version,
      )
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("RUNBOOK_VERSION_IMMUTABLE")
        return existing
      }
      const entry = { owner, fingerprint, definition }
      store.definitions.push(entry)
      return entry
    })
  }
  async getDefinition(owner: string, id: string, version: string) {
    const store = await this.read()
    const entry = store.definitions.find(
      (candidate) =>
        candidate.owner === owner &&
        candidate.definition.id === id &&
        candidate.definition.version === version,
    )
    if (!entry) throw new Error("RUNBOOK_NOT_FOUND")
    return entry
  }
  async start(owner: string, id: string, version: string, evidence: JsonValue) {
    const definition = await this.getDefinition(owner, id, version)
    return await this.write(async (store) => {
      const execution = ExecutionSchema.parse({
        id: randomUUID(),
        owner,
        runbookId: id,
        runbookVersion: version,
        definitionFingerprint: definition.fingerprint,
        baselineEvidenceFingerprint: evidenceFingerprint(evidence),
        state: "running",
        nextStepIndex: 0,
        steps: definition.definition.steps.map((step) => ({ id: step.id, state: "pending" })),
      })
      store.executions.push(execution)
      return execution
    })
  }
  async getExecution(owner: string, id: string) {
    const store = await this.read()
    const entry = store.executions.find(
      (candidate) => candidate.owner === owner && candidate.id === id,
    )
    if (!entry) throw new Error("RUNBOOK_EXECUTION_NOT_FOUND")
    return entry
  }
  async updateExecution(
    owner: string,
    id: string,
    update: (execution: z.infer<typeof ExecutionSchema>) => z.infer<typeof ExecutionSchema>,
  ) {
    return await this.write(async (store) => {
      const index = store.executions.findIndex(
        (candidate) => candidate.owner === owner && candidate.id === id,
      )
      const current = store.executions[index]
      if (!current) throw new Error("RUNBOOK_EXECUTION_NOT_FOUND")
      const next = ExecutionSchema.parse(update(current))
      store.executions[index] = next
      return next
    })
  }
  async recordClaim(
    owner: string,
    input: {
      claimId: string
      statement: string
      confidence: number
      evidence: JsonValue[]
      supersedesVersion?: number
    },
  ) {
    return await this.write(async (store) => {
      const claims = store.claims.filter(
        (claim) => claim.owner === owner && claim.claimId === input.claimId,
      )
      const current = claims.find((claim) => claim.supersededBy === undefined)
      if (current && input.supersedesVersion !== current.version)
        throw new Error("CLAIM_SUPERSESSION_REQUIRED")
      if (!current && input.supersedesVersion !== undefined)
        throw new Error("CLAIM_VERSION_NOT_FOUND")
      const version = (current?.version ?? 0) + 1
      const claim = ClaimSchema.parse({
        owner,
        claimId: input.claimId,
        version,
        statement: input.statement,
        confidence: input.confidence,
        evidence: input.evidence,
        fingerprint: evidenceFingerprint({ statement: input.statement, evidence: input.evidence }),
      })
      if (current) current.supersededBy = version
      store.claims.push(claim)
      return claim
    })
  }
  async claims(owner: string, claimId?: string) {
    const store = await this.read()
    return store.claims.filter(
      (claim) => claim.owner === owner && (claimId === undefined || claim.claimId === claimId),
    )
  }

  private async read(): Promise<Store> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { definitions: [], executions: [], claims: [] }
      throw error
    }
  }
  private async write<T>(operation: (store: Store) => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      const store = await this.read()
      const result = await operation(store)
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(StoreSchema.parse(store), null, 2)}\n`, "utf8")
      await rename(temporary, this.path)
      return result
    } finally {
      release()
    }
  }
}

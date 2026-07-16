import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

const JobStateSchema = z.enum(["queued", "running", "partial", "completed", "failed", "cancelled"])
export type JobState = z.infer<typeof JobStateSchema>

export const ReadJobSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("suiteql"),
    query: z.string().min(1),
    params: z.array(JsonValueSchema),
    keyField: z.string().min(1),
    keyIsUnique: z.literal(true),
    pageSize: z.number().int().min(1).max(1000),
    rowBudget: z.number().int().min(1).max(100000),
    format: z.enum(["jsonl", "csv"]),
    compression: z.enum(["none", "gzip"]),
  }),
  z.object({
    kind: z.literal("savedSearch"),
    savedSearchId: z.string().min(1),
    pageSize: z.number().int().min(1).max(1000),
    rowBudget: z.number().int().min(1).max(100000),
    format: z.enum(["jsonl", "csv"]),
    compression: z.enum(["none", "gzip"]),
  }),
])
export type ReadJobSpec = z.infer<typeof ReadJobSpecSchema>

const ReadJobSchema = z.object({
  id: z.string().uuid(),
  owner: z.string().min(1),
  state: JobStateSchema,
  spec: ReadJobSpecSchema,
  checkpoint: z.object({
    cursor: z.string().nullable(),
    pageIndex: z.number().int().nonnegative(),
    rowsWritten: z.number().int().nonnegative(),
    chunksCompleted: z.number().int().nonnegative(),
  }),
  resourceId: z.string().uuid(),
  error: z.string().optional(),
  partialFailures: z.array(z.object({ chunk: z.number().int().nonnegative(), error: z.string() })),
})
export type ReadJob = z.infer<typeof ReadJobSchema>

const StoreSchema = z.object({ jobs: z.array(ReadJobSchema) })

export class JobStore {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(readonly path: string) {}

  async create(owner: string, spec: ReadJobSpec): Promise<ReadJob> {
    return await this.serializeWrite(async () => {
      const parsedSpec = ReadJobSpecSchema.parse(spec)
      const job: ReadJob = {
        id: randomUUID(),
        owner,
        state: "queued",
        spec: parsedSpec,
        checkpoint: { cursor: null, pageIndex: 0, rowsWritten: 0, chunksCompleted: 0 },
        resourceId: randomUUID(),
        partialFailures: [],
      }
      const store = await this.readStore()
      store.jobs.push(job)
      await this.writeStore(store)
      return job
    })
  }

  async get(id: string, owner: string): Promise<ReadJob> {
    const store = await this.readStore()
    const job = store.jobs.find((entry) => entry.id === id)
    if (!job || job.owner !== owner)
      throw new Error("JOB_NOT_FOUND: job is missing or belongs to another requester")
    return job
  }

  async getByResource(resourceId: string, owner: string): Promise<ReadJob> {
    const store = await this.readStore()
    const job = store.jobs.find((entry) => entry.resourceId === resourceId && entry.owner === owner)
    if (!job)
      throw new Error("EXPORT_NOT_FOUND: resource is missing or belongs to another requester")
    return job
  }

  async update(id: string, owner: string, update: (job: ReadJob) => ReadJob): Promise<ReadJob> {
    return await this.serializeWrite(async () => {
      const store = await this.readStore()
      const index = store.jobs.findIndex((entry) => entry.id === id && entry.owner === owner)
      if (index < 0)
        throw new Error("JOB_NOT_FOUND: job is missing or belongs to another requester")
      const current = store.jobs[index]
      if (!current) throw new Error("JOB_NOT_FOUND")
      const next = ReadJobSchema.parse(update(current))
      store.jobs[index] = next
      await this.writeStore(store)
      return next
    })
  }

  async cancel(id: string, owner: string): Promise<ReadJob> {
    return await this.update(id, owner, (job) => {
      if (["completed", "failed"].includes(job.state)) {
        throw new Error(`JOB_TERMINAL: ${job.state} jobs cannot be cancelled`)
      }
      return { ...job, state: "cancelled" }
    })
  }

  async resume(id: string, owner: string, recoverRunning = false): Promise<ReadJob> {
    return await this.update(id, owner, (job) => {
      const resumable = (["partial", "failed"] as JobState[]).includes(job.state)
      if (!resumable && !(job.state === "running" && recoverRunning)) {
        throw new Error(`JOB_NOT_RESUMABLE: ${job.state} jobs cannot be resumed`)
      }
      return { ...job, state: "queued", error: undefined }
    })
  }

  private async readStore(): Promise<{ jobs: ReadJob[] }> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")))
    } catch (error) {
      if (isMissing(error)) return { jobs: [] }
      throw error
    }
  }

  private async writeStore(store: { jobs: ReadJob[] }): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(StoreSchema.parse(store), null, 2)}\n`, "utf8")
    await rename(temporary, this.path)
  }

  private async serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue
    let release!: () => void
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

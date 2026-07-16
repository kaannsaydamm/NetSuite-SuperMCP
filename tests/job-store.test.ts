import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ExportStore } from "../src/jobs/export-store"
import { JobStore } from "../src/jobs/job-store"

describe("read job persistence", () => {
  it("persists checkpoints and enforces requester ownership", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supermcp-job-"))
    const store = new JobStore(join(directory, "jobs.json"))
    const job = await store.create("owner-a", {
      kind: "suiteql",
      query: "SELECT id FROM customer",
      params: [],
      keyField: "id",
      keyIsUnique: true,
      pageSize: 100,
      rowBudget: 1000,
      format: "jsonl",
      compression: "none",
    })
    await store.update(job.id, "owner-a", (current) => ({
      ...current,
      state: "partial",
      checkpoint: { cursor: "opaque", pageIndex: 0, rowsWritten: 100, chunksCompleted: 1 },
    }))
    const reloaded = await new JobStore(join(directory, "jobs.json")).get(job.id, "owner-a")
    expect(reloaded.checkpoint.rowsWritten).toBe(100)
    expect(reloaded.state).toBe("partial")
    await expect(store.get(job.id, "owner-b")).rejects.toThrow("JOB_NOT_FOUND")
  })

  it("resumes a failed job from its existing checkpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supermcp-resume-"))
    const store = new JobStore(join(directory, "jobs.json"))
    const job = await store.create("owner", {
      kind: "savedSearch",
      savedSearchId: "customsearch_example",
      pageSize: 100,
      rowBudget: 1000,
      format: "csv",
      compression: "gzip",
    })
    await store.update(job.id, "owner", (current) => ({
      ...current,
      state: "failed",
      error: "temporary failure",
      checkpoint: { cursor: null, pageIndex: 2, rowsWritten: 200, chunksCompleted: 2 },
    }))
    const resumed = await store.resume(job.id, "owner")
    expect(resumed.state).toBe("queued")
    expect(resumed.checkpoint).toEqual({
      cursor: null,
      pageIndex: 2,
      rowsWritten: 200,
      chunksCompleted: 2,
    })
  })

  it("writes deterministic chunks so retrying a chunk does not duplicate export rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supermcp-export-"))
    const exports = new ExportStore(directory)
    const resourceId = "123e4567-e89b-42d3-a456-426614174000"
    await exports.writeChunk(resourceId, 0, [{ id: 1 }], "jsonl")
    await exports.writeChunk(resourceId, 0, [{ id: 1 }], "jsonl")
    const metadata = await exports.finalize(resourceId, "jsonl", "none", 1)
    expect(metadata.bytes).toBeGreaterThan(0)
    expect(await readFile(join(directory, `${resourceId}.jsonl`), "utf8")).toBe('{"id":1}\n')
  })
})

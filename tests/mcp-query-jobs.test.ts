import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../src/app"
import { ExportStore } from "../src/jobs/export-store"
import { JobStore } from "../src/jobs/job-store"
import type { RestletAction, SuiteQlRequest } from "../src/netsuite/types"
import { CursorCodec } from "../src/query/suiteql"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

class QueryJobClient extends FakeNetSuiteClient {
  calls = 0
  override async runSuiteQl(_request: SuiteQlRequest): Promise<JsonObject> {
    this.calls += 1
    return this.calls === 1
      ? { items: [{ id: 1 }, { id: 2 }], hasMore: true }
      : { items: [{ id: 3 }], hasMore: false }
  }

  override async runRestletAction(action: RestletAction): Promise<JsonObject> {
    this.actions.push(action)
    if (action.action === "ns_getSavedSearchDefinition") {
      return {
        definition: {
          id: "customsearch_source",
          searchType: "customer",
          title: "Source",
          isPublic: false,
          filters: [],
          columns: [{ name: "internalid" }],
        },
      }
    }
    return { action: action.action, phase: action.phase }
  }
}

describe("MCP query jobs", () => {
  it("applies the read-only validator to the legacy SuiteQL tool", async () => {
    const client = new QueryJobClient()
    const app = createApp(testConfig(), { netsuite: client })
    const response = await call(app, ToolName.RunSuiteQl, {
      query: "DELETE FROM customer",
      params: [],
      limit: 10,
    })
    expect(response.error.code).toBe("ONLY_SELECT")
    expect(response.error.message).toContain("must be a SELECT statement")
    expect(client.calls).toBe(0)
  })

  it("resumes keyset chunks and exposes a completed MCP resource", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supermcp-mcp-job-"))
    const client = new QueryJobClient()
    const app = createApp(testConfig(), {
      netsuite: client,
      jobStore: new JobStore(join(directory, "jobs.json")),
      exportStore: new ExportStore(join(directory, "exports")),
      cursorCodec: new CursorCodec(Buffer.from("stable-mcp-job-test-secret")),
    })
    const created = await call(app, ToolName.ExportSuiteQl, {
      kind: "suiteql",
      query: "SELECT id FROM customer",
      params: [],
      keyField: "id",
      keyIsUnique: true,
      pageSize: 2,
      rowBudget: 10,
      format: "jsonl",
      compression: "none",
    })
    const jobId = created.job.id as string
    const first = await call(app, ToolName.RunJobStep, { jobId, maxChunks: 1 })
    expect(first.job.state).toBe("partial")
    expect(first.job.checkpoint.rowsWritten).toBe(2)
    const second = await call(app, ToolName.RunJobStep, { jobId, maxChunks: 1 })
    expect(second.job.state).toBe("completed")
    expect(second.job.checkpoint.rowsWritten).toBe(3)
    expect(second.resource.uri).toBe(second.job.resourceUri)

    const resourceResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 702,
      method: "resources/read",
      params: { uri: second.resource.uri },
    })
    const resourceBody = (await resourceResponse.json()) as JsonObject
    expect(JSON.stringify(resourceBody)).toContain('{\\"id\\":3}')
  })

  it("previews a saved-search clone without creating it", async () => {
    const client = new QueryJobClient()
    const app = createApp(testConfig(), { netsuite: client })
    const response = await call(app, ToolName.PreviewCloneSavedSearch, {
      sourceSearchId: "customsearch_source",
      targetTitle: "Clone",
      targetSearchId: "customsearch_clone",
    })
    expect(response.clonePreview).toMatchObject({
      action: ToolName.CreateSavedSearch,
      mutatesNetSuite: false,
      payload: { recordType: "customer", title: "Clone" },
    })
    expect(client.actions.every((action) => action.phase === "preview")).toBe(true)
  })

  it("cancels future chunks while preserving the job record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supermcp-cancel-job-"))
    const client = new QueryJobClient()
    const app = createApp(testConfig(), {
      netsuite: client,
      jobStore: new JobStore(join(directory, "jobs.json")),
      exportStore: new ExportStore(join(directory, "exports")),
      cursorCodec: new CursorCodec(Buffer.from("stable-cancel-test-secret")),
    })
    const created = await call(app, ToolName.ExportSuiteQl, {
      kind: "suiteql",
      query: "SELECT id FROM customer",
      params: [],
      keyField: "id",
      keyIsUnique: true,
      pageSize: 2,
      rowBudget: 10,
      format: "jsonl",
      compression: "none",
    })
    const jobId = created.job.id as string
    const cancelled = await call(app, ToolName.CancelJob, { jobId })
    const stepped = await call(app, ToolName.RunJobStep, { jobId, maxChunks: 1 })
    expect(cancelled.job.state).toBe("cancelled")
    expect(stepped.job.state).toBe("cancelled")
    expect(client.calls).toBe(0)
  })
})

async function call(app: ReturnType<typeof createApp>, name: string, args: JsonObject) {
  const response = await mcpCall(app, {
    jsonrpc: "2.0",
    id: 700,
    method: "tools/call",
    params: { name, arguments: args },
  })
  const body = ToolTextResponseSchema.parse(await response.json())
  return JSON.parse(body.result.content[0].text)
}

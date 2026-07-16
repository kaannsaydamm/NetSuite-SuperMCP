import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../src/app"
import { RunbookStore } from "../src/runbooks/runbook-store"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP runbooks", () => {
  it("stops a mutating step on changed preview evidence without committing", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-runbook-mcp-"))
    const config = testConfig({ runbookStorePath: join(root, "runbooks.json") })
    const netsuite = new FakeNetSuiteClient()
    const app = createApp(config, {
      netsuite,
      runbookStore: new RunbookStore(config.runbookStorePath),
    })
    await call(app, ToolName.DefineRunbook, {
      id: "repair.customer",
      version: "1.0",
      title: "Repair customer",
      description: "Prepared customer repair.",
      steps: [
        {
          id: "prepare.customer",
          title: "Prepare customer",
          toolName: ToolName.CreateRecord,
          input: { type: "customer", values: { companyName: "Example" } },
          mutatesNetSuite: true,
          repairClass: "other",
        },
      ],
    })
    const execution = await call(app, ToolName.StartRunbook, {
      runbookId: "repair.customer",
      runbookVersion: "1.0",
      evidence: [{ source: "request", reference: "case:1" }],
    })
    const operation = await call(app, ToolName.CreateRecord, {
      type: "customer",
      values: { companyName: "Example" },
    })
    const stopped = await call(app, ToolName.RecordRunbookStep, {
      executionId: String(execution["id"]),
      stepId: "prepare.customer",
      observedEvidence: [{ source: "record", reference: "customer:new" }],
      result: { prepared: true },
      operationId: String(operation["operationId"]),
      previewOutput: { changed: true },
      expectedPreviewFingerprint: "0".repeat(64),
      succeeded: true,
    })
    expect(stopped["state"]).toBe("stopped")
    expect(netsuite.createdRecords).toEqual([])
  })
})

async function call(app: ReturnType<typeof createApp>, name: ToolName, args: JsonObject) {
  const response = await mcpCall(app, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    result: { structuredContent: JsonObject; isError?: boolean }
  }
  expect(body.result.isError).not.toBe(true)
  return body.result.structuredContent
}

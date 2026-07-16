import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../src/app"
import { IntegrationStore } from "../src/integrations/integration-store"
import { OperationStore } from "../src/operations/operation-store"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP integration orchestration", () => {
  it("runs shadow and simulation replay only through RESTlet preview", async () => {
    const netsuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite })
    for (const [id, name, argumentsValue] of [
      [1, ToolName.ShadowPayload, { action: "ns_createSavedSearch", payload: { title: "test" } }],
      [
        2,
        ToolName.ReplayPayload,
        { mode: "simulation", action: "ns_createSavedSearch", payload: { title: "test" } },
      ],
    ] as const) {
      const response = await mcpCall(app, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: argumentsValue },
      })
      expect(response.status).toBe(200)
    }
    expect(netsuite.actions.map((entry) => entry.phase)).toEqual(["preview", "preview"])
  })

  it("canary promotion exposes prepared operation IDs without committing them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supermcp-canary-"))
    const operationStore = new OperationStore()
    const plan = operationStore.create({
      accountId: "1234567_SB1",
      requester: "test-user",
      client: "bun-test",
      action: ToolName.CreateSavedSearch,
      environment: "sandbox",
      impact: {},
      kind: "savedSearch",
      payload: { title: "test" },
      preview: {},
      snapshotFingerprint: "snapshot",
      selection: {},
      source: {},
      warnings: [],
    })
    const app = createApp(testConfig(), {
      netsuite: new FakeNetSuiteClient(),
      operationStore,
      integrationStore: new IntegrationStore(join(directory, "store.json")),
    })
    const prepared = await tool(app, ToolName.PrepareCanary, {
      name: "one record",
      predicate: { field: "externalid", operator: "equals", value: "TEST-1" },
      maxRecords: 1,
      operationIds: [plan.operationId],
    })
    const canaryId = String(prepared["id"])
    await tool(app, ToolName.MonitorCanary, {
      canaryId,
      observations: [{ operationId: plan.operationId, outcome: "pass", evidence: [] }],
    })
    const promotion = await tool(app, ToolName.PromoteCanary, { canaryId })
    expect(promotion).toEqual(
      expect.objectContaining({ committed: false, requiresHarnessApproval: true }),
    )
    expect(
      operationStore.preview(plan.operationId, {
        accountId: "1234567_SB1",
        requester: "test-user",
        client: "bun-test",
      }).used,
    ).toBe(false)
  })
})

async function tool(app: ReturnType<typeof createApp>, name: ToolName, args: JsonObject) {
  const response = await mcpCall(app, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { result: { structuredContent: JsonObject } }
  return body.result.structuredContent
}

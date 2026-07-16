import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP assurance and simulation", () => {
  it("keeps simulation isolated and policy enforcement provider-owned", async () => {
    const netsuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite })
    const simulation = await call(app, ToolName.SimulateInventoryState, {
      initial: [{ itemId: "1", locationId: "2", quantity: 5 }],
      adjustments: [{ itemId: "1", locationId: "2", quantityDelta: -1, evidence: [] }],
    })
    const policy = await call(app, ToolName.EvaluatePolicyFacts, {
      facts: { environment: "production" },
      policies: [
        {
          id: "production-review",
          predicate: { field: "environment", operator: "equals", value: "production" },
          effect: "review",
          metadata: {},
        },
      ],
    })
    expect(simulation["mutatesNetSuite"]).toBe(false)
    expect(policy).toEqual(
      expect.objectContaining({ enforced: false, enforcementOwner: "provider-harness" }),
    )
    expect(netsuite.actions).toEqual([])
    expect(netsuite.createdRecords).toEqual([])
    expect(netsuite.updatedRecords).toEqual([])
    expect(netsuite.deletedRecords).toEqual([])
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

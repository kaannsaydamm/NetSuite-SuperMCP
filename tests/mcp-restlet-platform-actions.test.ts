import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP RESTlet-backed platform actions", () => {
  it("routes platform object reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const calls = [
      { name: ToolName.ListPlatformObjects, payload: { category: "scripts", pageSize: 10 } },
      {
        name: ToolName.GetPlatformObject,
        payload: { recordType: "script", recordId: 12, fields: ["name", "scriptid"] },
      },
      { name: ToolName.SearchRecords, payload: { recordType: "integration", query: "Shopify" } },
    ]

    // When
    for (const [index, call] of calls.entries()) {
      const response = await mcpCall(app, {
        jsonrpc: "2.0",
        id: 40 + index,
        method: "tools/call",
        params: {
          name: call.name,
          arguments: {
            action: "ignored-by-mcp",
            payload: call.payload,
          },
        },
      })
      expect(response.status).toBe(200)
    }

    // Then
    expect(fakeNetSuite.actions).toEqual(
      calls.map((call) => ({
        action: call.name,
        phase: "commit",
        payload: call.payload,
      })),
    )
  })
})

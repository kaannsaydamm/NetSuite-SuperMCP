import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP RESTlet-backed report actions", () => {
  it("routes report and saved search actions through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const calls: Array<{ name: ToolName; payload: JsonObject }> = [
      { name: ToolName.ListReportTypes, payload: {} },
      { name: ToolName.ListReports, payload: { query: "Inventory", limit: 20 } },
      {
        name: ToolName.RunSearch,
        payload: {
          recordType: "inventorybalance",
          columns: ["item", "location", "quantityonhand"],
        },
      },
      {
        name: ToolName.CreateSavedSearch,
        payload: { recordType: "customer", title: "SuperMCP Customers", columns: ["internalid"] },
      },
      {
        name: ToolName.UpdateSavedSearch,
        payload: { searchId: "customsearch_supermcp_customers", values: { title: "Customers" } },
      },
      {
        name: ToolName.DeleteSavedSearch,
        payload: {
          searchId: "customsearch_supermcp_customers",
          confirmation: "deleteSavedSearch:customsearch_supermcp_customers",
        },
      },
    ]

    // When
    for (const [index, call] of calls.entries()) {
      const response = await mcpCall(app, {
        jsonrpc: "2.0",
        id: 50 + index,
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
      if (
        call.name === ToolName.CreateSavedSearch ||
        call.name === ToolName.UpdateSavedSearch ||
        call.name === ToolName.DeleteSavedSearch
      ) {
        const body = ToolTextResponseSchema.parse(await response.json())
        const plan = JSON.parse(body.result.content[0].text)
        expect(plan).toMatchObject({ action: call.name, phase: "prepare", used: false })
      }
    }

    // Then
    expect(fakeNetSuite.actions).toEqual(
      calls.flatMap((call) => {
        const mutates =
          call.name === ToolName.CreateSavedSearch ||
          call.name === ToolName.UpdateSavedSearch ||
          call.name === ToolName.DeleteSavedSearch
        return mutates
          ? [
              { action: call.name, phase: "prepare", payload: call.payload },
              { action: call.name, phase: "preview", payload: call.payload },
            ]
          : [{ action: call.name, phase: "preview", payload: call.payload }]
      }),
    )
  })
})

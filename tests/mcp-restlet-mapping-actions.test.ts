import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP RESTlet-backed mapping actions", () => {
  it("routes mapping reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: ToolName.GetMapping,
        arguments: {
          recordType: "customrecord_channel_mapping",
          recordId: "321",
          fields: ["name", "custrecord_source", "custrecord_target"],
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.GetMapping,
        phase: "preview",
        payload: {
          recordType: "customrecord_channel_mapping",
          recordId: "321",
          fields: ["name", "custrecord_source", "custrecord_target"],
        },
      },
    ])
  })

  it("routes mapping updates through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: ToolName.UpdateMapping,
        arguments: {
          recordType: "customrecord_channel_mapping",
          recordId: "321",
          values: { custrecord_target: "789" },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    const body = ToolTextResponseSchema.parse(await response.json())
    const plan = JSON.parse(body.result.content[0].text)
    expect(plan).toMatchObject({ action: ToolName.UpdateMapping, phase: "prepare", used: false })
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.UpdateMapping,
        phase: "prepare",
        payload: {
          recordType: "customrecord_channel_mapping",
          recordId: "321",
          values: { custrecord_target: "789" },
        },
      },
      {
        action: ToolName.UpdateMapping,
        phase: "preview",
        payload: {
          recordType: "customrecord_channel_mapping",
          recordId: "321",
          values: { custrecord_target: "789" },
        },
      },
    ])
  })
})

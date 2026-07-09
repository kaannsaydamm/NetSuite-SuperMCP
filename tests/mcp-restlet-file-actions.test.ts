import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP RESTlet-backed file actions", () => {
  it("routes File Cabinet reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 29,
      method: "tools/call",
      params: {
        name: ToolName.GetFile,
        arguments: {
          action: "ignored-by-mcp",
          payload: { fileId: "SuiteScripts/supermcp_action_restlet.js", maxBytes: 1048576 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.GetFile,
        phase: "commit",
        payload: { fileId: "SuiteScripts/supermcp_action_restlet.js", maxBytes: 1048576 },
      },
    ])
  })

  it("routes File Cabinet writes through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: ToolName.WriteFile,
        arguments: {
          action: "ignored-by-mcp",
          payload: {
            fileId: "SuiteScripts/SuperMCP/example.js",
            contents: "define([], () => ({}))",
            confirmation: "writeFile:SuiteScripts/SuperMCP/example.js",
          },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.WriteFile,
        phase: "commit",
        payload: {
          fileId: "SuiteScripts/SuperMCP/example.js",
          contents: "define([], () => ({}))",
          confirmation: "writeFile:SuiteScripts/SuperMCP/example.js",
        },
      },
    ])
  })
})

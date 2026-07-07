import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP RESTlet-backed script actions", () => {
  it("routes script inventory reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: {
        name: ToolName.ListScripts,
        arguments: {
          action: "ignored-by-mcp",
          payload: { savedSearchId: "customsearch_supermcp_scripts", pageSize: 100 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.ListScripts,
        phase: "commit",
        payload: { savedSearchId: "customsearch_supermcp_scripts", pageSize: 100 },
      },
    ])
  })

  it("routes script deployment inventory reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: {
        name: ToolName.ListScriptDeployments,
        arguments: {
          action: "ignored-by-mcp",
          payload: { savedSearchId: "customsearch_supermcp_script_deployments", pageSize: 100 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.ListScriptDeployments,
        phase: "commit",
        payload: { savedSearchId: "customsearch_supermcp_script_deployments", pageSize: 100 },
      },
    ])
  })

  it("routes script log reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: ToolName.GetScriptLogs,
        arguments: {
          action: "ignored-by-mcp",
          payload: { savedSearchId: "customsearch_supermcp_script_logs", pageSize: 100 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.GetScriptLogs,
        phase: "commit",
        payload: { savedSearchId: "customsearch_supermcp_script_logs", pageSize: 100 },
      },
    ])
  })

  it("routes script error discovery through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 28,
      method: "tools/call",
      params: {
        name: ToolName.FindScriptErrors,
        arguments: {
          action: "ignored-by-mcp",
          payload: { savedSearchId: "customsearch_supermcp_script_errors", pageSize: 100 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.FindScriptErrors,
        phase: "commit",
        payload: { savedSearchId: "customsearch_supermcp_script_errors", pageSize: 100 },
      },
    ])
  })
})

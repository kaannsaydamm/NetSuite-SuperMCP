import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP RESTlet-backed read actions", () => {
  it("routes saved search reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: ToolName.RunSavedSearch,
        arguments: {
          action: "ignored-by-mcp",
          payload: { savedSearchId: "customsearch_failed_orders", pageSize: 50 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.RunSavedSearch,
        phase: "preview",
        payload: { savedSearchId: "customsearch_failed_orders", pageSize: 50 },
      },
    ])
  })

  it("routes report reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: ToolName.RunReport,
        arguments: {
          action: "ignored-by-mcp",
          payload: { reportId: "customsearch_monthly_sales", pageSize: 100 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.RunReport,
        phase: "preview",
        payload: { reportId: "customsearch_monthly_sales", pageSize: 100 },
      },
    ])
  })

  it("routes integration log reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: ToolName.GetIntegrationLogs,
        arguments: {
          action: "ignored-by-mcp",
          payload: { savedSearchId: "customsearch_integration_logs", pageIndex: 1 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.GetIntegrationLogs,
        phase: "preview",
        payload: { savedSearchId: "customsearch_integration_logs", pageIndex: 1 },
      },
    ])
  })

  it("routes failed integration job reads through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: ToolName.GetFailedIntegrationJobs,
        arguments: {
          action: "ignored-by-mcp",
          payload: { savedSearchId: "customsearch_failed_integration_jobs", pageSize: 25 },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.GetFailedIntegrationJobs,
        phase: "preview",
        payload: { savedSearchId: "customsearch_failed_integration_jobs", pageSize: 25 },
      },
    ])
  })

  it("routes integration error explanation through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: ToolName.ExplainIntegrationError,
        arguments: {
          action: "ignored-by-mcp",
          payload: {
            recordType: "customrecord_integration_job",
            recordId: "456",
            fields: ["name", "custrecord_error_message"],
          },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.ExplainIntegrationError,
        phase: "preview",
        payload: {
          recordType: "customrecord_integration_job",
          recordId: "456",
          fields: ["name", "custrecord_error_message"],
        },
      },
    ])
  })
})

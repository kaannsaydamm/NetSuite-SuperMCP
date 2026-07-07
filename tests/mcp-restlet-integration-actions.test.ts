import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP RESTlet-backed integration actions", () => {
  it("routes direct integration retries to preview", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: {
        name: ToolName.RetryIntegrationJob,
        arguments: {
          action: "ignored-by-mcp",
          payload: {
            recordType: "customrecord_integration_job",
            recordId: "456",
            values: { custrecord_retry_requested: true },
          },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.RetryIntegrationJob,
        phase: "preview",
        payload: {
          recordType: "customrecord_integration_job",
          recordId: "456",
          values: { custrecord_retry_requested: true },
        },
      },
    ])
  })

  it("routes explicit integration retry commits through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: {
          action: ToolName.RetryIntegrationJob,
          phase: "commit",
          payload: {
            recordType: "customrecord_integration_job",
            recordId: "456",
            values: { custrecord_retry_requested: true },
            confirmation: "retry:customrecord_integration_job:456",
          },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.RetryIntegrationJob,
        phase: "commit",
        payload: {
          recordType: "customrecord_integration_job",
          recordId: "456",
          values: { custrecord_retry_requested: true },
          confirmation: "retry:customrecord_integration_job:456",
        },
      },
    ])
  })
})

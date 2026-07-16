import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import type { RestletAction } from "../src/netsuite/types"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

class IntegrationNetSuiteClient extends FakeNetSuiteClient {
  async runRestletAction(action: RestletAction): Promise<JsonObject> {
    await super.runRestletAction(action)
    return {
      action: action.action,
      phase: action.phase,
      ...(action.phase === "prepare"
        ? { confirmation: "retry:customrecord_integration_job:456" }
        : { ok: true }),
    }
  }
}

describe("MCP RESTlet-backed integration actions", () => {
  it("routes direct integration retries to prepare", async () => {
    // Given
    const fakeNetSuite = new IntegrationNetSuiteClient()
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
        phase: "prepare",
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
    const fakeNetSuite = new IntegrationNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: ToolName.RetryIntegrationJob,
        arguments: {
          payload: {
            recordType: "customrecord_integration_job",
            recordId: "456",
            values: { custrecord_retry_requested: true },
          },
        },
      },
    })
    const prepareBody = ToolTextResponseSchema.parse(await prepareResponse.json())
    const plan = JSON.parse(prepareBody.result.content[0].text)

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: {
          operationId: plan.operationId,
          confirmation: plan.confirmation,
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.RetryIntegrationJob,
        phase: "prepare",
        payload: {
          recordType: "customrecord_integration_job",
          recordId: "456",
          values: { custrecord_retry_requested: true },
        },
      },
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

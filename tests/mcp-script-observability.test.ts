import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import type { RestletAction } from "../src/netsuite/types"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

class ScriptNetSuiteClient extends FakeNetSuiteClient {
  override async runRestletAction(action: RestletAction): Promise<JsonObject> {
    this.actions.push(action)
    if (action.action !== "ns_getScriptSources")
      return { action: action.action, phase: action.phase }
    return {
      sources: [
        {
          scriptId: "customscript_example",
          deploymentIds: ["customdeploy_example"],
          file: { id: "10", name: "example.js", path: "/SuiteScripts/example.js" },
          source:
            'define(["N/record"], (record) => { return { run: () => record.load({ type: "salesorder", id: 1 }) } })',
        },
      ],
      gaps: [],
    }
  }
}

describe("MCP SuiteScript observability", () => {
  it("analyzes a script by script ID through the permanent source action", async () => {
    const netsuite = new ScriptNetSuiteClient()
    const app = createApp(testConfig(), { netsuite })
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: ToolName.AnalyzeScript, arguments: { scriptId: "customscript_example" } },
    })

    expect(response.status).toBe(200)
    expect(netsuite.actions[0]).toEqual({
      action: "ns_getScriptSources",
      phase: "preview",
      payload: { scriptId: "customscript_example", maxScripts: 25 },
    })
    const body = (await response.json()) as { result: { structuredContent: JsonObject } }
    expect(body.result.structuredContent["sourceCount"]).toBe(1)
  })

  it("reads execution evidence directly without requiring a saved search ID", async () => {
    const netsuite = new ScriptNetSuiteClient()
    const app = createApp(testConfig(), { netsuite })
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: ToolName.GetScriptObservability,
        arguments: { deploymentId: "customdeploy_example", maxExecutions: 20 },
      },
    })

    expect(response.status).toBe(200)
    expect(netsuite.actions[0]).toEqual({
      action: ToolName.GetScriptObservability,
      phase: "preview",
      payload: { deploymentId: "customdeploy_example", maxExecutions: 20 },
    })
  })
})

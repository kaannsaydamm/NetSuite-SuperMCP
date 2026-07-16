import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../src/app"
import { CustomizationStore } from "../src/customizations/customization-store"
import type { RestletAction } from "../src/netsuite/types"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

class CustomizationClient extends FakeNetSuiteClient {
  override async runRestletAction(action: RestletAction): Promise<JsonObject> {
    this.actions.push(action)
    if (action.action === ToolName.GetSuperMcpVersion) return { version: "0.1.35" }
    if (action.action === ToolName.InventoryCustomizations) {
      return {
        items: [
          {
            category: "script",
            searchType: "script",
            internalId: "10",
            values: {
              name: { value: "Example", text: null },
              scriptid: { value: "customscript_example", text: null },
            },
          },
        ],
        gaps: [],
      }
    }
    return { action: action.action, phase: action.phase }
  }
}

describe("MCP customization deployment", () => {
  it("inventories stable script IDs and records provider-approved deployment evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-customization-"))
    const config = testConfig({
      customizationProjectDirectory: join(root, "projects"),
      customizationStorePath: join(root, "deployments.json"),
    })
    const netsuite = new CustomizationClient()
    const app = createApp(config, {
      netsuite,
      customizationStore: new CustomizationStore(config.customizationStorePath),
    })
    const inventory = await tool(app, ToolName.InventoryCustomizations, {
      categories: ["script"],
      maxPerCategory: 10,
    })
    expect((inventory["canonical"] as JsonObject[])[0]?.["scriptId"]).toBe("customscript_example")

    const generated = await tool(app, ToolName.GenerateSuiteCloudProject, {
      name: "example",
      customizations: [exampleCustomization()],
      files: [
        { path: "FileCabinet/SuiteScripts/example.js", content: "new", previousContent: "old" },
      ],
    })
    const prepared = await tool(app, ToolName.PrepareCustomizationDeployment, {
      projectId: String(generated["projectId"]),
      changedScriptIds: ["customscript_example"],
      expectedLiveVersion: "0.1.35",
    })
    expect(prepared["requiresHarnessApproval"]).toBe(true)
    expect(prepared["writesNetSuite"]).toBe(false)

    const recorded = await tool(app, ToolName.RecordCustomizationDeploymentResult, {
      deploymentId: String(prepared["id"]),
      confirmation: String(prepared["confirmation"]),
      succeeded: true,
      uploadedFiles: ["FileCabinet/SuiteScripts/example.js"],
      changedObjects: ["customscript_example"],
      validationWarnings: [],
      providerEvidence: [{ command: "project:deploy", exitCode: 0 }],
    })
    expect(recorded["state"]).toBe("succeeded")

    const verified = await tool(app, ToolName.VerifyCustomizationDeployment, {
      deploymentId: String(prepared["id"]),
    })
    expect(verified["state"]).toBe("verified")
  })
})

function exampleCustomization(): JsonObject {
  return {
    type: "script",
    scriptId: "customscript_example",
    name: "Example",
    definition: { scriptType: "RESTlet" },
    permissions: [],
    dependencies: [],
    metadata: { provenance: [] },
  }
}

async function tool(app: ReturnType<typeof createApp>, name: ToolName, args: JsonObject) {
  const response = await mcpCall(app, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { result: { structuredContent: JsonObject } }
  return body.result.structuredContent
}

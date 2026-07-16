import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import type { RestletAction } from "../src/netsuite/types"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
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
        phase: "preview",
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
    const body = ToolTextResponseSchema.parse(await response.json())
    const plan = JSON.parse(body.result.content[0].text)
    expect(plan).toMatchObject({ action: ToolName.WriteFile, phase: "prepare", used: false })
    expect(plan.operationId).toBeString()
    expect(plan.confirmation).toBe(`commit:${ToolName.WriteFile}:${plan.operationId}`)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.WriteFile,
        phase: "prepare",
        payload: {
          fileId: "SuiteScripts/SuperMCP/example.js",
          contents: "define([], () => ({}))",
          confirmation: "writeFile:SuiteScripts/SuperMCP/example.js",
        },
      },
      {
        action: ToolName.WriteFile,
        phase: "preview",
        payload: {
          fileId: "SuiteScripts/SuperMCP/example.js",
          contents: "define([], () => ({}))",
          confirmation: "writeFile:SuiteScripts/SuperMCP/example.js",
        },
      },
    ])
  })

  it("routes File Cabinet management actions through the RESTlet action layer", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const calls: Array<{ name: ToolName; phase?: RestletAction["phase"]; payload: JsonObject }> = [
      { name: ToolName.ListFileCabinet, phase: "preview", payload: { folderId: 1, limit: 25 } },
      { name: ToolName.CreateFolder, payload: { name: "Exports", parent: 1 } },
      { name: ToolName.UpdateFolder, payload: { folderId: 2, name: "Exports 2026" } },
      { name: ToolName.DeleteFolder, payload: { folderId: 3, confirmation: "deleteFolder:3" } },
      { name: ToolName.CopyFile, payload: { fileId: 4, targetFolderId: 5 } },
      { name: ToolName.MoveFile, payload: { fileId: 6, targetFolderId: 7 } },
      { name: ToolName.DeleteFile, payload: { fileId: 8, confirmation: "deleteFile:8" } },
    ]

    // When
    for (const [index, call] of calls.entries()) {
      const response = await mcpCall(app, {
        jsonrpc: "2.0",
        id: 31 + index,
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
      if (call.name !== ToolName.ListFileCabinet) {
        const body = ToolTextResponseSchema.parse(await response.json())
        const plan = JSON.parse(body.result.content[0].text)
        expect(plan).toMatchObject({ action: call.name, phase: "prepare", used: false })
      }
    }

    // Then
    const expectedActions: RestletAction[] = []
    for (const call of calls) {
      if (call.name === ToolName.ListFileCabinet) {
        expectedActions.push({ action: call.name, phase: "preview", payload: call.payload })
      } else {
        expectedActions.push({ action: call.name, phase: "prepare", payload: call.payload })
        expectedActions.push({ action: call.name, phase: "preview", payload: call.payload })
      }
    }
    expect(fakeNetSuite.actions).toEqual(expectedActions)
  })
})

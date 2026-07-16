import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import type { RecordMetadataRequest, RestletAction } from "../src/netsuite/types"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

class ExplorerClient extends FakeNetSuiteClient {
  override async getRecordMetadata(request: RecordMetadataRequest): Promise<JsonObject> {
    this.metadataRequests.push(request)
    if (request.type === undefined) {
      return { items: [{ name: "salesOrder", title: "Sales Order" }] }
    }
    return {
      name: request.type,
      properties: {
        entity: { name: "entity", title: "Customer", type: "object" },
        memo: { name: "memo", title: "Memo", type: "string" },
      },
    }
  }

  override async runRestletAction(action: RestletAction): Promise<JsonObject> {
    this.actions.push(action)
    if (action.action === ToolName.GetTransactionChain) {
      return {
        nodes: [
          { type: "salesOrder", id: "10" },
          { type: "invoice", id: "20" },
        ],
        edges: [{ from: "salesOrder:10", to: "invoice:20", relation: "createdFrom" }],
        gaps: [],
      }
    }
    if (action.action === ToolName.GetSystemNotes) {
      return {
        events: [
          { id: "2", rawDate: "raw-second", field: "status" },
          { id: "1", rawDate: "raw-first", field: "memo" },
        ],
        gaps: [],
      }
    }
    return { action: action.action, phase: action.phase, ok: true }
  }
}

describe("MCP record explorer", () => {
  it("discovers record fields with bounded typed results", async () => {
    const app = createApp(testConfig(), { netsuite: new ExplorerClient() })
    const response = await call(app, ToolName.ListRecordFields, {
      type: "salesOrder",
      search: "customer",
      limit: 10,
    })

    expect(response.fields).toEqual([expect.objectContaining({ id: "entity", label: "Customer" })])
    expect(response.truncated).toBe(false)
  })

  it("returns transaction evidence and preserves NetSuite event sequence", async () => {
    const client = new ExplorerClient()
    const app = createApp(testConfig(), { netsuite: client })
    const diagnosis = await call(app, ToolName.DiagnoseTransaction, {
      type: "salesOrder",
      id: "10",
      maxNodes: 20,
      includeSystemNotes: true,
    })
    const stream = await call(app, ToolName.GetTransactionEventStream, {
      type: "salesOrder",
      id: "10",
      limit: 20,
    })

    expect(diagnosis.chain.nodes).toHaveLength(2)
    expect(diagnosis.hypotheses).toEqual([])
    expect(stream.events.map((event: JsonObject) => event["id"])).toEqual(["2", "1"])
    expect(stream.chronologySynthesized).toBe(false)
    expect(client.actions.every((action) => action.phase === "preview")).toBe(true)
  })
})

async function call(app: ReturnType<typeof createApp>, name: string, args: JsonObject) {
  const response = await mcpCall(app, {
    jsonrpc: "2.0",
    id: 500,
    method: "tools/call",
    params: { name, arguments: args },
  })
  const body = ToolTextResponseSchema.parse(await response.json())
  return JSON.parse(body.result.content[0].text)
}

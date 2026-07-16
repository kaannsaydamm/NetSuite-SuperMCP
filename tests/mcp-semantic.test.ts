import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../src/app"
import { SemanticStore } from "../src/semantics/semantic-store"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

class MetricClient extends FakeNetSuiteClient {
  override async runSuiteQl(
    request: Parameters<FakeNetSuiteClient["runSuiteQl"]>[0],
  ): Promise<JsonObject> {
    return { items: [{ location: "2", metric_value: 223 }], hasMore: false, query: request.query }
  }
}

describe("MCP semantic layer", () => {
  it("defines and executes an explicit metric with formula and source evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-semantic-mcp-"))
    const config = testConfig({ semanticStorePath: join(root, "semantic.json") })
    const app = createApp(config, {
      netsuite: new MetricClient(),
      semanticStore: new SemanticStore(config.semanticStorePath),
    })
    await call(app, ToolName.DefineBusinessTerm, {
      id: "inventory.location",
      version: "1.0",
      label: "Inventory location",
      description: "Location in the approved inventory balance source.",
      table: "inventorybalance",
      field: "location",
      valueType: "identifier",
      sourceRefs: ["record:location"],
    })
    await call(app, ToolName.DefineMetric, {
      id: "inventory.onhand",
      version: "1.0",
      label: "On-hand inventory",
      description: "Physical on-hand units from the approved inventory balance source.",
      table: "inventorybalance",
      aggregation: "sum",
      measureField: "onhand",
      businessTerms: ["stock", "inventory"],
      dimensions: [
        { field: "location", alias: "location", termId: "inventory.location", termVersion: "1.0" },
      ],
      filters: [],
      exclusions: [],
      sourceRefs: ["savedsearch:customsearch_inventory_source"],
    })
    const plan = await call(app, ToolName.PlanBusinessQuery, {
      metricId: "inventory.onhand",
      metricVersion: "1.0",
      query: "stock by location",
      dimensions: ["location"],
      limit: 100,
    })
    const result = await call(app, ToolName.RunMetric, {
      metricId: "inventory.onhand",
      metricVersion: "1.0",
      query: "stock by location",
      dimensions: ["location"],
      limit: 100,
    })
    expect((result["rows"] as JsonObject[])[0]?.["evidence"]).toEqual(
      expect.objectContaining({ formula: "sum(onhand)", planFingerprint: plan["planFingerprint"] }),
    )
    expect(((result["rows"] as JsonObject[])[0]?.["evidence"] as JsonObject)["lineage"]).toEqual(
      expect.objectContaining({ sourceRefs: ["savedsearch:customsearch_inventory_source"] }),
    )
  })
})

async function call(app: ReturnType<typeof createApp>, name: ToolName, args: JsonObject) {
  const response = await mcpCall(app, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    result: { structuredContent: JsonObject; isError?: boolean }
  }
  expect(body.result.isError).not.toBe(true)
  return body.result.structuredContent
}

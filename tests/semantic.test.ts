import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertBusinessQueryIsExplicit, compileMetricPlan } from "../src/semantics/semantic"
import { SemanticStore } from "../src/semantics/semantic-store"

const metric = {
  id: "inventory.onhand",
  version: "1.0",
  label: "On-hand inventory",
  description: "Physical on-hand units from the configured item inventory balance source.",
  table: "inventorybalance",
  aggregation: "sum" as const,
  measureField: "onhand",
  businessTerms: ["stock", "inventory"],
  dimensions: [{ field: "location", alias: "location" }],
  filters: [{ field: "item", operator: ">" as const, value: 0 }],
  exclusions: [],
  sourceRefs: ["savedsearch:customsearch_inventory_source"],
}

describe("semantic metric compiler", () => {
  it("compiles the same metric version to the same plan and evidence", () => {
    const input = {
      metricId: metric.id,
      metricVersion: metric.version,
      query: "stock by location",
      dimensions: ["location"],
      limit: 100,
    }
    const first = compileMetricPlan(metric, input)
    const second = compileMetricPlan(metric, input)
    expect(first.planFingerprint).toBe(second.planFingerprint)
    expect(first.query).toBe(second.query)
    expect(first.lineage.sourceRefs).toEqual(metric.sourceRefs)
    expect(first.formula).toBe("sum(onhand)")
  })

  it("keeps id and version immutable while allowing idempotent definition", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-semantic-"))
    const store = new SemanticStore(join(root, "semantic.json"))
    await store.defineMetric("owner", metric)
    await store.defineMetric("owner", metric)
    await expect(store.defineMetric("owner", { ...metric, label: "Changed" })).rejects.toThrow(
      "SEMANTIC_VERSION_IMMUTABLE",
    )
  })

  it("deletes only the requester's selected semantic definition", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-semantic-delete-"))
    const store = new SemanticStore(join(root, "semantic.json"))
    await store.defineMetric("owner-a", metric)
    await store.defineMetric("owner-b", metric)

    expect(await store.deleteMetric("owner-a", metric.id, metric.version)).toEqual({
      deleted: true,
      id: metric.id,
      version: metric.version,
    })
    await expect(store.getMetric("owner-a", metric.id, metric.version)).rejects.toThrow(
      "SEMANTIC_DEFINITION_NOT_FOUND",
    )
    expect(await store.getMetric("owner-b", metric.id, metric.version)).toEqual(metric)
  })

  it("rejects an ambiguous term not declared by the selected metric", () => {
    expect(() => assertBusinessQueryIsExplicit("show margin", metric)).toThrow(
      "AMBIGUOUS_BUSINESS_TERM",
    )
  })
})

import { describe, expect, it } from "bun:test"
import {
  analyzeScriptSource,
  dependencyEdges,
  findDuplicateLogic,
  type ScriptSource,
} from "../src/scripts/source-audit"

const source: ScriptSource = {
  scriptId: "customscript_orders",
  deploymentIds: ["customdeploy_orders"],
  file: { id: "10", name: "orders.js", path: "/SuiteScripts/orders.js" },
  source: `define(["N/record", "./mapping"], (record, mapping) => {
  const clientSecret = "do-not-return-this-value"
  function execute() {
    const order = record.load({ type: "salesorder", id: 1 })
    const value = order.getValue({ fieldId: "custbody_channel" })
    order.setValue({ fieldId: "custbody_processed", value: true })
    return value
  }
  return { execute }
})`,
}

describe("SuiteScript source audit", () => {
  it("returns line evidence while redacting secret-like literals", () => {
    const analysis = analyzeScriptSource(source)
    const secret = analysis.findings.find(
      (finding) => finding.rule === "hardcoded-secret-like-value",
    )

    expect(secret?.evidence.file).toBe("/SuiteScripts/orders.js")
    expect(secret?.evidence.line).toBe(2)
    expect(secret?.evidence.excerpt).toContain("[REDACTED]")
    expect(JSON.stringify(analysis)).not.toContain("do-not-return-this-value")
    expect(secret?.fingerprint).toHaveLength(16)
  })

  it("indexes supported dependencies and labels unsupported definitions unknown", () => {
    const edges = dependencyEdges(source)
    expect(edges).toContainEqual(
      expect.objectContaining({ type: "module", to: "N/record", status: "resolved" }),
    )
    expect(edges).toContainEqual(
      expect.objectContaining({ type: "recordRead", to: "salesorder", status: "resolved" }),
    )

    const dynamic = dependencyEdges({ ...source, source: "define(loadDependencies(), () => ({}))" })
    expect(dynamic[0]).toEqual(expect.objectContaining({ status: "unknown" }))
  })

  it("detects identical normalized sources without fuzzy semantic claims", () => {
    const duplicates = findDuplicateLogic([
      source,
      { ...source, scriptId: "customscript_orders_copy", file: { id: "11", name: "copy.js" } },
    ])
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.confidence).toBe("confirmed")
  })
})

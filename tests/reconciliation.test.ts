import { describe, expect, it } from "bun:test"
import {
  anonymizeRecords,
  reconcileRecords,
  validateContractRecords,
} from "../src/integrations/reconciliation"

const contract = {
  id: "inventory-v1",
  version: 1,
  domain: "inventory" as const,
  keyFields: ["sku"],
  fields: {
    sku: { type: "string" as const, required: true, semantic: "identity" as const },
    quantity: { type: "number" as const, required: true, semantic: "quantity" as const },
  },
  mappings: {},
  invariants: [{ rule: "nonnegative" as const, field: "quantity" }],
}

describe("integration reconciliation", () => {
  it("links summary counts to record-level classifications and evidence", () => {
    const result = reconcileRecords({
      domain: "inventory",
      contract,
      sourceName: "warehouse",
      targetName: "NetSuite",
      sourceRecords: [
        { matchKey: "A", fields: { sku: "A", quantity: 3 }, evidence: ["source:A"] },
        { matchKey: "B", fields: { sku: "B", quantity: 1 }, evidence: ["source:B"] },
      ],
      targetRecords: [
        { matchKey: "A", fields: { sku: "A", quantity: 2 }, evidence: ["netsuite:A"] },
        { matchKey: "C", fields: { sku: "C", quantity: 1 }, evidence: ["netsuite:C"] },
      ],
    })

    expect(result.totals.differences).toBe(3)
    expect(result.totals.classifications).toEqual({ quantityMismatch: 1, missing: 1, extra: 1 })
    expect(result.differences[0]).toEqual(
      expect.objectContaining({ classification: "quantityMismatch", sourceEvidence: ["source:A"] }),
    )
  })

  it("validates required fields, types, nonnegative values, and duplicate keys", () => {
    const result = validateContractRecords(contract, [
      { matchKey: "A", fields: { sku: "A", quantity: -1 }, evidence: [] },
      { matchKey: "A", fields: { sku: "A", quantity: "wrong" }, evidence: [] },
    ])
    expect(result.valid).toBe(false)
    expect(result.violations.map((entry) => entry["rule"])).toContain("unique")
    expect(result.violations.map((entry) => entry["rule"])).toContain("nonnegative")
    expect(result.violations.map((entry) => entry["rule"])).toContain("type")
  })

  it("anonymizes only caller-selected fields deterministically", () => {
    const output = anonymizeRecords(
      [{ email: "person@example.com", order: "SO1" }],
      ["email"],
      "test-salt",
    )
    expect(output[0]?.["order"]).toBe("SO1")
    expect(output[0]?.["email"]).toStartWith("anon_")
    expect(JSON.stringify(output)).not.toContain("person@example.com")
  })
})

import { describe, expect, it } from "bun:test"
import {
  discoverProcess,
  profileDataQuality,
  rankRootCauses,
  simulateInventory,
} from "../src/assurance/assurance"

describe("assurance and simulation primitives", () => {
  it("preserves unknown process gaps and discovers variants", () => {
    const result = discoverProcess({
      traces: [
        {
          caseId: "SO1",
          steps: [
            { node: "salesOrder", durationMs: 10, evidence: [] },
            { node: "fulfillment", durationMs: 20, evidence: [] },
          ],
          gaps: [{ afterNode: "fulfillment", reason: "invoice not visible", evidence: [] }],
        },
      ],
    })
    expect(result.variants[0]?.path).toBe("salesOrder -> fulfillment")
    expect(result.gaps[0]).toEqual(expect.objectContaining({ status: "unknown" }))
  })

  it("returns declarative quality violations with remediation", () => {
    const result = profileDataQuality({
      records: [{ key: "1", fields: { sku: "" }, evidence: [] }],
      rules: [
        {
          id: "sku-required",
          field: "sku",
          severity: "high",
          rule: "required",
          remediation: "Set an explicit SKU.",
        },
      ],
    })
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toEqual(
      expect.objectContaining({ remediation: "Set an explicit SKU." }),
    )
    const wildcard = profileDataQuality({
      records: [{ key: "2", fields: { sku: "ABC-123" }, evidence: [] }],
      rules: [
        {
          id: "sku-pattern",
          field: "sku",
          severity: "medium",
          rule: "pattern",
          pattern: "ABC-*",
          remediation: "Use the approved SKU prefix.",
        },
      ],
    })
    expect(wildcard.valid).toBe(true)
  })

  it("keeps simulations isolated and root causes uncertainty-aware", () => {
    const inventory = simulateInventory({
      initial: [{ itemId: "1", locationId: "2", quantity: 5 }],
      adjustments: [{ itemId: "1", locationId: "2", quantityDelta: -2, evidence: [] }],
    })
    expect(inventory.state[0]?.quantity).toBe(3)
    expect(inventory.mutatesNetSuite).toBe(false)
    expect(() =>
      simulateInventory({
        initial: [
          { itemId: "1", locationId: "2", quantity: 5 },
          { itemId: "1", locationId: "2", quantity: 4 },
        ],
        adjustments: [],
      }),
    ).toThrow("DUPLICATE_INVENTORY_STATE")
    const causes = rankRootCauses({
      hypotheses: [
        {
          id: "h1",
          explanation: "Example",
          priorConfidence: 0.5,
          supportingEvidence: [{ source: "record", reference: "1" }],
          contradictingEvidence: [{ source: "search", reference: "2" }],
        },
      ],
    })
    expect(causes.hypotheses[0]).toEqual(expect.objectContaining({ uncertainty: "contradicted" }))
  })
})

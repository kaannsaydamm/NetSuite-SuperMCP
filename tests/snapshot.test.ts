import { describe, expect, it } from "bun:test"
import { snapshotFingerprint } from "../src/operations/snapshot"

const lineOne = { line: 1, item: "202", quantityRemaining: 1 }

const baseline = {
  body: { id: "321", status: "pendingFulfillment", location: "2" },
  lines: [lineOne, { line: 0, item: "101", quantityRemaining: 2 }],
  relatedTransactions: [{ id: "900", type: "itemFulfillment" }],
}

describe("operation snapshot fingerprint", () => {
  it("is stable across object key and transaction line ordering", () => {
    const reordered = {
      relatedTransactions: [{ type: "itemFulfillment", id: "900" }],
      lines: [
        { quantityRemaining: 2, item: "101", line: 0 },
        { quantityRemaining: 1, line: 1, item: "202" },
      ],
      body: { location: "2", status: "pendingFulfillment", id: "321" },
    }

    expect(snapshotFingerprint(reordered)).toBe(snapshotFingerprint(baseline))
  })

  it("does not include date or time fields", () => {
    const withDifferentDateFields = {
      ...baseline,
      tranDate: "2099-12-31",
      timestamp: "2099-12-31T23:59:59Z",
      body: { ...baseline.body, lastModifiedDate: "2099-12-31T23:59:59Z" },
    }

    expect(snapshotFingerprint(withDifferentDateFields)).toBe(snapshotFingerprint(baseline))
  })

  it.each([
    ["status", { ...baseline, body: { ...baseline.body, status: "closed" } }],
    ["quantity", { ...baseline, lines: [{ line: 0, item: "101", quantityRemaining: 1 }, lineOne] }],
    ["line", { ...baseline, lines: [lineOne] }],
    ["location", { ...baseline, body: { ...baseline.body, location: "5" } }],
    ["related transaction", { ...baseline, relatedTransactions: [] }],
  ])("changes the fingerprint when %s changes", (_field, changed) => {
    expect(snapshotFingerprint(changed)).not.toBe(snapshotFingerprint(baseline))
  })
})

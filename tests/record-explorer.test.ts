import { describe, expect, it } from "bun:test"
import {
  batchGetRecords,
  createEvidenceBundle,
  diffSnapshots,
  extractFields,
  normalizeTransactionChain,
  transactionHypotheses,
} from "../src/record-explorer/explorer"
import { FakeNetSuiteClient } from "./test-support"

describe("record explorer primitives", () => {
  it("extracts typed fields from nested REST metadata", () => {
    const fields = extractFields({
      properties: {
        entity: { name: "entity", title: "Customer", type: "object", nullable: false },
        memo: { name: "memo", title: "Memo", type: "string" },
      },
    })

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "entity", label: "Customer", required: true }),
        expect.objectContaining({ id: "memo", label: "Memo" }),
      ]),
    )
  })

  it("uses JSON Schema property keys as field IDs without treating the record schema as a field", () => {
    const fields = extractFields({
      title: "salesorder",
      type: "object",
      properties: {
        entity: { title: "Customer", type: "object", nullable: false },
        memo: { title: "Memo", type: "string" },
      },
    })

    expect(fields.map((field) => field.id)).toEqual(["entity", "memo"])
  })

  it("diffs business values without comparing date or time fields", () => {
    const result = diffSnapshots(
      { id: "1", status: "Pending", tranDate: "2026-07-15", timestamp: "one" },
      { id: "1", status: "Billed", tranDate: "2026-07-16", timestamp: "two" },
    )

    expect(result.changes).toEqual([{ path: "$.status", before: "Pending", after: "Billed" }])
  })

  it("creates deterministic redacted evidence files and hashes", () => {
    const first = createEvidenceBundle("case-1", [
      { kind: "record", source: "customer:1", payload: { id: "1", accessToken: "secret" } },
    ])
    const second = createEvidenceBundle("case-1", [
      { kind: "record", source: "customer:1", payload: { id: "1", accessToken: "secret" } },
    ])

    expect(first.manifest).toEqual(second.manifest)
    expect(JSON.stringify(first)).not.toContain("secret")
    expect(first.files[0]?.path).toBe("evidence/case-1/0001-record.json")
  })

  it("keeps per-record successes when one bounded batch read fails", async () => {
    const client = new (class extends FakeNetSuiteClient {
      override async getRecord(ref: { type: string; id: string }) {
        if (ref.id === "2") throw new Error("role cannot view record")
        return { type: ref.type, id: ref.id }
      }
    })()

    const result = await batchGetRecords(client, [
      { type: "customer", id: "1" },
      { type: "customer", id: "2" },
    ])

    expect(result.partial).toBe(true)
    expect(result.results.map((entry) => entry.ok)).toEqual([true, false])
    expect(result.gaps[0]).toMatchObject({ ref: { id: "2" } })
  })

  it("canonicalizes transaction aliases before deduplicating graph nodes and edges", () => {
    const result = normalizeTransactionChain({
      root: { type: "SalesOrd", id: "10" },
      nodes: [
        { type: "salesOrder", id: "10" },
        { type: "transaction", id: "10", canonicalType: "SalesOrd" },
        { type: "CustInvc", id: "20" },
      ],
      edges: [
        { from: "SalesOrd:10", to: "CustInvc:20", relation: "appliedBy" },
        { from: "transaction:10", to: "invoice:20", relation: "appliedBy" },
      ],
    })
    expect(result["nodes"]).toHaveLength(2)
    expect(result["edges"]).toHaveLength(1)
    expect(result["root"]).toEqual({ type: "salesOrder", id: "10" })
  })

  it("does not infer missing history when the System Notes search failed", () => {
    expect(
      transactionHypotheses(
        { nodes: [{ type: "salesOrder", id: "10" }] },
        { events: [], gaps: [{ source: "systemnote-search", error: "invalid column" }] },
      ).some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          !Array.isArray(entry) &&
          (entry as Record<string, unknown>)["code"] === "NO_SYSTEM_NOTES_VISIBLE",
      ),
    ).toBe(false)
  })
})

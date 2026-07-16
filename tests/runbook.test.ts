import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { correlateIncidents, repairProposal, supportEvidenceBundle } from "../src/runbooks/runbook"
import { RunbookStore } from "../src/runbooks/runbook-store"

describe("runbooks and evidence", () => {
  it("stores immutable resumable runbooks and requires claim supersession", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-runbook-"))
    const store = new RunbookStore(join(root, "runbooks.json"))
    const definition = {
      id: "diagnose.order",
      version: "1.0",
      title: "Diagnose order",
      description: "Read-only diagnosis.",
      steps: [
        {
          id: "read.order",
          title: "Read order",
          toolName: "ns_getRecord",
          input: { type: "salesOrder", id: "1" },
          mutatesNetSuite: false,
          repairClass: "none" as const,
        },
      ],
    }
    await store.define("owner", definition)
    const execution = await store.start("owner", definition.id, definition.version, [
      { source: "record", reference: "salesOrder:1" },
    ])
    expect(execution.state).toBe("running")
    const first = await store.recordClaim("owner", {
      claimId: "order.state",
      statement: "Pending",
      confidence: 1,
      evidence: [{ source: "record", reference: "1" }],
    })
    await expect(
      store.recordClaim("owner", {
        claimId: "order.state",
        statement: "Closed",
        confidence: 1,
        evidence: [{ source: "record", reference: "1" }],
      }),
    ).rejects.toThrow("CLAIM_SUPERSESSION_REQUIRED")
    const second = await store.recordClaim("owner", {
      claimId: "order.state",
      statement: "Closed",
      confidence: 1,
      evidence: [{ source: "record", reference: "1" }],
      supersedesVersion: first.version,
    })
    expect(second.version).toBe(2)
  })
  it("keeps risky repairs proposal-only and correlates deterministic IDs first", () => {
    expect(
      repairProposal({ repairClass: "financial", financial: true, destructive: false }, [
        "localMetadataRefresh",
      ]),
    ).toEqual(expect.objectContaining({ proposalOnly: true, executesRepair: false }))
    const result = correlateIncidents({
      similarityThreshold: 0.8,
      events: [
        { id: "1", scriptId: "s1", message: "failed" },
        { id: "2", scriptId: "s1", message: "different" },
      ],
    })
    expect(result.groups[0]).toEqual(expect.objectContaining({ method: "deterministic", count: 2 }))
  })
  it("builds hashed redacted support evidence", () => {
    const bundle = supportEvidenceBundle({
      name: "case",
      claims: [
        {
          claim: "x",
          confidence: 1,
          evidence: [{ source: "record", reference: "1", payload: { token: "secret" } }],
        },
      ],
      reproducibleQueries: [],
    })
    expect(bundle.redactionReport.rawSecretsIncluded).toBe(false)
    expect(bundle.manifest.sha256).toHaveLength(64)
  })
})

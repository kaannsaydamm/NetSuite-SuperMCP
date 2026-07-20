import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CompositeStore } from "../src/composites/composite-store"
import { HarnessContextSchema } from "../src/contracts/harness-schemas"
import { HarnessBudgetStore } from "../src/harness/budget-store"
import {
  decodeHarnessContext,
  encodeHarnessContext,
  isToolAllowed,
  redactForHarness,
} from "../src/harness/context"
import { ToolName } from "../src/tools/catalog"

const context = HarnessContextSchema.parse({
  version: 1,
  scopeId: "case:42",
  provider: "test-harness",
  subject: "user:7",
  profile: "read",
  budgets: { calls: 2, rows: 10 },
  sensitivity: { piiFields: ["email"], piiMode: "redact" },
})

describe("harness scope and budgets", () => {
  it("verifies signed scope and rejects tampering", () => {
    const signed = encodeHarnessContext(context, "verification-secret-value")
    expect(
      decodeHarnessContext(signed.encoded, signed.signature, "verification-secret-value")?.scopeId,
    ).toBe("case:42")
    expect(() =>
      decodeHarnessContext(`${signed.encoded}x`, signed.signature, "verification-secret-value"),
    ).toThrow("HARNESS_CONTEXT_SIGNATURE_INVALID")
    expect(isToolAllowed(context, ToolName.GetRecord)).toBe(true)
    expect(isToolAllowed(context, ToolName.CreateRecord)).toBe(false)
  })

  it("persists deterministic budget exhaustion and redacts secrets and selected PII", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-harness-"))
    const path = join(root, "budgets.json")
    await new HarnessBudgetStore(path).reserve(context, { limit: 4 })
    await new HarnessBudgetStore(path).reserve(context, { limit: 6 })
    await expect(new HarnessBudgetStore(path).reserve(context, {})).rejects.toThrow(
      "HARNESS_BUDGET_EXHAUSTED: calls",
    )
    expect(
      redactForHarness(context, {
        email: "person@example.com",
        accessToken: "secret-value",
        name: "Visible",
      }),
    ).toEqual({ email: "[REDACTED]", accessToken: "[REDACTED]", name: "Visible" })
  })

  it("redacts built-in PII recursively even without an explicit field list", () => {
    expect(
      redactForHarness(undefined, {
        customer: {
          emailAddress: "person@example.com",
          shipAddress: "Example Street 1",
          mobilephone: "+90 555 000 0000",
          entityName: "Example Person",
          statusName: "Pending Fulfillment",
        },
      }),
    ).toEqual({
      customer: {
        emailAddress: "[REDACTED]",
        shipAddress: "[REDACTED]",
        mobilephone: "[REDACTED]",
        entityName: "[REDACTED]",
        statusName: "Pending Fulfillment",
      },
    })
  })

  it("redacts PII carried by generic System Note value fields", () => {
    expect(
      redactForHarness(context, {
        events: [
          {
            field: "Shipping Address",
            oldValue: "Person Name\nExample Street 1\n34000 Istanbul",
            newValue: "Person Name\nExample Street 2\n34000 Istanbul",
            user: "System Note User",
          },
          {
            field: "Entity",
            oldValue: "Customer Name",
            newValue: { id: "42", refName: "Customer Name" },
          },
        ],
      }),
    ).toEqual({
      events: [
        {
          field: "Shipping Address",
          oldValue: "[REDACTED]",
          newValue: "[REDACTED]",
          user: "[REDACTED]",
        },
        {
          field: "Entity",
          oldValue: "[REDACTED]",
          newValue: "[REDACTED]",
        },
      ],
    })
  })

  it("keeps composite versions immutable and rejects cycles", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-composite-"))
    const store = new CompositeStore(join(root, "composites.json"))
    const definition = {
      id: "read.customer",
      version: "1.0",
      title: "Read customer",
      description: "Typed customer read.",
      inputs: [],
      steps: [
        {
          id: "read.record",
          kind: "tool" as const,
          toolName: ToolName.GetRecord,
          inputTemplate: { type: "customer", id: "1" },
        },
      ],
    }
    await store.define("owner", definition)
    await expect(store.define("owner", { ...definition, title: "Changed" })).rejects.toThrow(
      "COMPOSITE_VERSION_IMMUTABLE",
    )
    await expect(
      store.define("owner", {
        ...definition,
        id: "cycle.self",
        steps: [
          {
            id: "cycle.step",
            kind: "composite",
            compositeId: "cycle.self",
            compositeVersion: "1.0",
          },
        ],
      }),
    ).rejects.toThrow("COMPOSITE_CYCLE_DETECTED")
  })
})

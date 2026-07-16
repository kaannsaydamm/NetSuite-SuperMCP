import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { IntegrationStore } from "../src/integrations/integration-store"

describe("integration state store", () => {
  it("deduplicates outbox events and preserves failed events for retry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supermcp-integrations-"))
    const store = new IntegrationStore(join(directory, "store.json"))
    await store.subscribe("owner", {
      id: "orders",
      eventTypes: ["failed"],
      endpoint: "https://example.com/events",
    })
    const first = await store.emit("owner", {
      subscriptionId: "orders",
      eventType: "failed",
      idempotencyKey: "failure-1",
      payload: { recordId: "10" },
    })
    const duplicate = await store.emit("owner", {
      subscriptionId: "orders",
      eventType: "failed",
      idempotencyKey: "failure-1",
      payload: { recordId: "10" },
    })
    expect(duplicate.id).toBe(first.id)

    await store.acknowledge("owner", first.id, false)
    const retry = await store.poll("owner", 10)
    expect(retry).toHaveLength(1)
    expect(retry[0]).toEqual(expect.objectContaining({ state: "failed", attempts: 1 }))
  })
})

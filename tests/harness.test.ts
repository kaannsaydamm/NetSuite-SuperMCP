import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CompositeStore } from "../src/composites/composite-store"
import { ToolName } from "../src/tools/catalog"

describe("composite tools", () => {
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

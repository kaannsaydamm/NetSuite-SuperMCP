import { describe, expect, it } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  cleanupPlan,
  diffCustomizations,
  generateProject,
  validateProject,
} from "../src/customizations/customization"

const customization = {
  type: "script" as const,
  scriptId: "customscript_example",
  internalId: "10",
  name: "Example",
  definition: { scriptType: "RESTlet", lastModifiedDate: "raw-source-value" },
  permissions: [],
  dependencies: [],
  metadata: { provenance: [] },
}

describe("customization inventory and deployment primitives", () => {
  it("matches environments by stable script ID and never compares date/time fields", () => {
    const result = diffCustomizations({
      sourceEnvironment: "sandbox",
      targetEnvironment: "production",
      source: [customization],
      target: [
        {
          ...customization,
          internalId: "999",
          definition: { scriptType: "RESTlet", lastModifiedDate: "different-raw-value" },
        },
      ],
    })
    expect(result.internalIdsUsedForMatching).toBe(false)
    expect(result.differences).toEqual([])
  })

  it("generates a checksum-pinned project and detects later file drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-project-"))
    const generated = await generateProject(root, {
      name: "example",
      customizations: [customization],
      files: [
        {
          path: "FileCabinet/SuiteScripts/example.js",
          content: "new content",
          previousContent: "old content",
        },
      ],
    })
    expect((await validateProject(root, generated.projectId)).valid).toBe(true)

    await writeFile(join(generated.projectRoot, "FileCabinet/SuiteScripts/example.js"), "tampered")
    expect((await validateProject(root, generated.projectId)).valid).toBe(false)
  })

  it("produces cleanup proposals without preparing deletion", () => {
    const result = cleanupPlan(
      [customization],
      [{ scriptId: customization.scriptId, references: 0, evidence: ["usage-search"] }],
    )
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({ action: "reviewForCleanup", deletionPrepared: false }),
    )
    expect(result.deletionPrepared).toBe(false)
  })
})

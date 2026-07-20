import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

describe("netsuite-supermcp CLI", () => {
  test.each(["--version", "-v", "version"])("prints its package version for %s", (argument) => {
    const result = spawnSync(
      "node",
      [join(import.meta.dir, "..", "bin", "netsuite-supermcp.mjs"), argument],
      {
        encoding: "utf8",
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("0.1.46")
    expect(result.stderr).toBe("")
  })
})

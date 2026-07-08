#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bunCheck = spawnSync("bun", ["--version"], {
  encoding: "utf8",
  shell: process.platform === "win32",
})
if (bunCheck.error !== undefined || (bunCheck.status ?? 1) !== 0) {
  console.error("NetSuite SuperMCP setup needs Bun.")
  console.error("Install Bun: https://bun.sh/docs/installation")
  console.error("Then rerun: netsuite-supermcp setup")
  process.exit(1)
}

const result = spawnSync(
  "bun",
  ["run", join(root, "scripts", "setup-wizard.ts"), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
)
process.exit(result.status ?? 1)

#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const command = process.argv[2] ?? "stdio"
const args = process.argv.slice(3)

const commands = {
  http: ["run", join(root, "src", "index.ts")],
  stdio: ["run", join(root, "src", "stdio.ts")],
  install: ["run", join(root, "scripts", "install-clients.ts")],
  "install-clients": ["run", join(root, "scripts", "install-clients.ts")],
}

const bunArgs = commands[command]
if (bunArgs === undefined) {
  console.error("Usage: netsuite-supermcp [stdio|http|install] [...args]")
  process.exit(1)
}

const result = spawnSync("bun", [...bunArgs, ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
})
process.exit(result.status ?? 1)

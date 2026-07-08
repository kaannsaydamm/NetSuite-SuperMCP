#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const command = process.argv[2] ?? "stdio"
const args = process.argv.slice(3)

const bunCheck = spawnSync("bun", ["--version"], {
  encoding: "utf8",
  shell: process.platform === "win32",
})
if (bunCheck.error !== undefined || (bunCheck.status ?? 1) !== 0) {
  console.error("NetSuite SuperMCP needs Bun to run TypeScript sources.")
  console.error("Install Bun: https://bun.sh/docs/installation")
  console.error("Then rerun: netsuite-supermcp setup")
  process.exit(1)
}

const commands = {
  http: ["run", join(root, "src", "index.ts")],
  doctor: ["run", join(root, "scripts", "doctor.ts")],
  "oauth-login": ["run", join(root, "scripts", "oauth-login.ts")],
  setup: ["run", join(root, "scripts", "setup-wizard.ts")],
  stdio: ["run", join(root, "src", "stdio.ts")],
  install: ["run", join(root, "scripts", "install-clients.ts")],
  "install-clients": ["run", join(root, "scripts", "install-clients.ts")],
}

const bunArgs = commands[command]
if (bunArgs === undefined) {
  console.error("Usage: netsuite-supermcp [setup|doctor|stdio|http|install|oauth-login] [...args]")
  process.exit(1)
}

const result = spawnSync("bun", [...bunArgs, ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
})
process.exit(result.status ?? 1)

#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const env = { ...process.env }
if (args.includes("--tunnel") || args.includes("--no-auth")) {
  env.MCP_AUTH_MODE = "none"
  env.MCP_HOST = env.MCP_HOST ?? "127.0.0.1"
}
const result = spawnSync("bun", ["run", join(root, "src", "index.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
})
process.exit(result.status ?? 1)

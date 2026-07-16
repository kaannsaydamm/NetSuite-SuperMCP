#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const result = spawnSync("bun", ["run", join(root, "scripts", "auth-diagnose.ts")], {
  stdio: "inherit",
  shell: process.platform === "win32",
})
process.exit(result.status ?? 1)

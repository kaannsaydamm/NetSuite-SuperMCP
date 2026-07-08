#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const command = process.argv[2] ?? "stdio"
const args = process.argv.slice(3)
const usage =
  "Usage: netsuite-supermcp [setup|oauth2|switch-account|logout|doctor|suitecloud|stdio|http|tunnel|public-url|install|oauth-login] [...args]"

if (command === "--help" || command === "-h" || args.includes("--help") || args.includes("-h")) {
  console.log(usage)
  console.log("")
  console.log("ChatGPT tunnel:")
  console.log("  netsuite-supermcp tunnel")
  console.log("  tunnel-client run --profile netsuite-supermcp")
  console.log("")
  console.log("ChatGPT Server URL with ngrok:")
  console.log("  netsuite-supermcp public-url")
  console.log("")
  console.log("Standard local HTTP with bearer auth:")
  console.log("  netsuite-supermcp http")
  process.exit(0)
}

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
  tunnel: ["run", join(root, "src", "index.ts")],
  "public-url": ["run", join(root, "scripts", "public-url.ts")],
  doctor: ["run", join(root, "scripts", "doctor.ts")],
  oauth2: ["run", join(root, "scripts", "oauth2.ts")],
  "oauth-login": ["run", join(root, "scripts", "oauth-login.ts")],
  "switch-account": ["run", join(root, "scripts", "switch-account.ts")],
  logout: ["run", join(root, "scripts", "switch-account.ts")],
  setup: ["run", join(root, "scripts", "setup-wizard.ts")],
  suitecloud: ["run", join(root, "scripts", "suitecloud-project.ts")],
  stdio: ["run", join(root, "src", "stdio.ts")],
  install: ["run", join(root, "scripts", "install-clients.ts")],
  "install-clients": ["run", join(root, "scripts", "install-clients.ts")],
}

const bunArgs = commands[command]
if (bunArgs === undefined) {
  console.error(usage)
  process.exit(1)
}

const env = { ...process.env }
if (command === "tunnel") {
  env.MCP_AUTH_MODE = "none"
  env.MCP_HOST = env.MCP_HOST ?? "127.0.0.1"
}

const result = spawnSync("bun", [...bunArgs, ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
})
process.exit(result.status ?? 1)

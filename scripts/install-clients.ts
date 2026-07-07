import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { stdin as input, stdout as output } from "node:process"
import { createInterface } from "node:readline/promises"

type JsonTarget = {
  readonly id: string
  readonly label: string
  readonly path: string
  readonly clientName: string
  readonly detect: readonly string[]
}

const projectRoot = resolve(import.meta.dir, "..")
const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "."
const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming")
const stdioEntry = join(projectRoot, "src", "stdio.ts")
const env =
  readEnvFile(join(projectRoot, ".env")) ?? readEnvFile(join(projectRoot, ".env.example")) ?? {}

const codexConfig = join(home, ".codex", "config.toml")
const jsonTargets: readonly JsonTarget[] = [
  target(
    "claude-code",
    "Claude Code project .mcp.json",
    join(projectRoot, ".mcp.json"),
    "claude-code",
    [join(home, ".claude")],
  ),
  target(
    "claude-desktop",
    "Claude Desktop",
    join(appData, "Claude", "claude_desktop_config.json"),
    "claude-desktop",
    [join(appData, "Claude")],
  ),
  target("cursor", "Cursor", join(home, ".cursor", "mcp.json"), "cursor", [
    join(home, ".cursor"),
    join(appData, "Cursor"),
  ]),
  target(
    "windsurf",
    "Windsurf / Cascade",
    join(home, ".codeium", "windsurf", "mcp_config.json"),
    "windsurf",
    [join(home, ".codeium", "windsurf"), join(appData, "Windsurf")],
  ),
  target("gemini", "Gemini CLI", join(home, ".gemini", "settings.json"), "gemini", [
    join(home, ".gemini"),
  ]),
  target(
    "antigravity",
    "Gemini Antigravity",
    join(home, ".gemini", "antigravity-cli", "settings.json"),
    "antigravity",
    [join(home, ".gemini", "antigravity-cli")],
  ),
  target("vscode", "VS Code workspace", join(projectRoot, ".vscode", "mcp.json"), "vscode", [
    join(appData, "Code"),
  ]),
  target("opencode", "OpenCode", join(home, ".config", "opencode", "mcp.json"), "opencode", [
    join(home, ".config", "opencode"),
    join(appData, "opencode"),
  ]),
  target(
    "hermes",
    "Hermes Agent",
    join(home, ".config", "hermes-agent", "mcp.json"),
    "hermes-agent",
    [join(home, ".config", "hermes-agent"), join(appData, "Hermes Agent")],
  ),
  target("openclaw", "OpenClaw", join(home, ".config", "openclaw", "mcp.json"), "openclaw", [
    join(home, ".config", "openclaw"),
    join(appData, "OpenClaw"),
  ]),
  target("zed", "Zed / Zcode MCP snippet", join(projectRoot, "generated", "zed-mcp.json"), "zed", [
    join(appData, "Zed"),
    join(home, ".config", "zed"),
  ]),
]

const args = new Set(process.argv.slice(2))

if (args.has("--list")) {
  printTargets()
  process.exit(0)
}

const requested = process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1]
const selected = await selectTargets(requested)
await ensureEnvFile()
await installTargets(selected)
printSnippet()

function target(
  id: string,
  label: string,
  path: string,
  clientName: string,
  detect: readonly string[],
): JsonTarget {
  return { id, label, path, clientName, detect }
}

async function selectTargets(requested: string | undefined): Promise<readonly JsonTarget[]> {
  if (requested !== undefined) {
    if (requested === "codex") {
      return []
    }
    return jsonTargets.filter((entry) => entry.id === requested)
  }
  if (args.has("--all-known")) {
    return jsonTargets
  }
  const detected = jsonTargets.filter(isDetected)
  if (args.has("--all-detected")) {
    return detected
  }

  printTargets()
  const rl = createInterface({ input, output })
  const answer = await rl.question("Install targets [detected/all/comma ids/none]: ")
  rl.close()
  if (answer.trim() === "all") {
    return jsonTargets
  }
  if (answer.trim() === "detected") {
    return detected
  }
  if (answer.trim() === "none" || answer.trim().length === 0) {
    return []
  }
  const ids = new Set(
    answer
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
  return jsonTargets.filter((entry) => ids.has(entry.id))
}

function printTargets(): void {
  console.log("NetSuite SuperMCP client install targets:")
  console.log(
    `- codex: ${codexConfig} ${existsSync(codexConfig) || existsSync(dirname(codexConfig)) ? "(detected)" : ""}`,
  )
  for (const entry of jsonTargets) {
    console.log(
      `- ${entry.id}: ${entry.label} -> ${entry.path} ${isDetected(entry) ? "(detected)" : ""}`,
    )
  }
}

function isDetected(entry: JsonTarget): boolean {
  return existsSync(entry.path) || entry.detect.some((path) => existsSync(path))
}

async function installTargets(targets: readonly JsonTarget[]): Promise<void> {
  const requested = process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1]
  if (
    args.has("--all-known") ||
    (args.has("--all-detected") && (existsSync(codexConfig) || existsSync(dirname(codexConfig)))) ||
    requested === "codex" ||
    targets.length > 0
  ) {
    await installCodex()
  }
  for (const entry of targets) {
    await installJsonTarget(entry)
  }
}

async function installCodex(): Promise<void> {
  const block = [
    "",
    "[mcp_servers.netsuite-supermcp]",
    'command = "bun"',
    `args = ["run", "${tomlEscape(stdioEntry)}"]`,
    "enabled = true",
    "[mcp_servers.netsuite-supermcp.env]",
    ...Object.entries(serverEnv("codex")).map(([key, value]) => `${key} = "${tomlEscape(value)}"`),
    "",
  ].join("\n")
  const current = await readText(codexConfig)
  const next = replaceTomlServer(current, block)
  await writeText(codexConfig, next)
  console.log(`installed codex -> ${codexConfig}`)
}

async function installJsonTarget(entry: JsonTarget): Promise<void> {
  const current = await readJson(entry.path)
  const mcpServers = isObject(current["mcpServers"]) ? current["mcpServers"] : {}
  current["mcpServers"] = {
    ...mcpServers,
    "netsuite-supermcp": {
      command: "bun",
      args: ["run", stdioEntry],
      env: serverEnv(entry.clientName),
    },
  }
  await writeJson(entry.path, current)
  console.log(`installed ${entry.id} -> ${entry.path}`)
}

function serverEnv(clientName: string): Record<string, string> {
  return {
    ...env,
    MCP_CLIENT: clientName,
    MCP_REQUESTER: process.env["USERNAME"] ?? process.env["USER"] ?? "local-user",
  }
}

async function ensureEnvFile(): Promise<void> {
  const envPath = join(projectRoot, ".env")
  if (existsSync(envPath)) {
    return
  }
  const example = await readText(join(projectRoot, ".env.example"))
  await writeText(envPath, example)
  console.log(`created ${envPath} from .env.example; fill NetSuite OAuth values before live use`)
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const text = await readText(path)
  if (text.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(text)
  return isObject(parsed) ? parsed : {}
}

async function writeJson(path: string, value: Record<string, unknown>): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ""
    }
    throw error
  }
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, "utf8")
}

function readEnvFile(path: string): Record<string, string> | undefined {
  if (!existsSync(path)) {
    return undefined
  }
  const data: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue
    }
    const index = trimmed.indexOf("=")
    if (index <= 0) {
      continue
    }
    data[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return data
}

function replaceTomlServer(current: string, block: string): string {
  const pattern =
    /\n?\[mcp_servers\.netsuite-supermcp\][\s\S]*?(?=\n\[mcp_servers\.|\n\[[^\]]+\]|\s*$)/g
  const cleaned = current.replace(pattern, "").trimEnd()
  return `${cleaned}${block}`
}

function tomlEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function printSnippet(): void {
  console.log("\nGeneric mcpServers snippet:")
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          "netsuite-supermcp": {
            command: "bun",
            args: ["run", stdioEntry],
            env: serverEnv("generic"),
          },
        },
      },
      null,
      2,
    ),
  )
}

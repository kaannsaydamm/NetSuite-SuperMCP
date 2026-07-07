import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { stdin as input, stdout as output } from "node:process"
import { createInterface } from "node:readline/promises"

import {
  createCodexBlock,
  createJsonServerConfig,
  createServerEnv,
  replaceTomlServer,
} from "./client-installer/config"
import { isObject, readJson, readText, writeJson, writeText } from "./client-installer/io"
import {
  createInstallerPaths,
  createJsonTargets,
  isDetected,
  type JsonTarget,
} from "./client-installer/targets"

const paths = createInstallerPaths(import.meta.dir)
const jsonTargets = createJsonTargets(paths)
const codexDetected = existsSync(paths.codexConfig) || existsSync(dirname(paths.codexConfig))

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

type SelectedTargets = {
  readonly installCodex: boolean
  readonly jsonTargets: readonly JsonTarget[]
}

async function selectTargets(requested: string | undefined): Promise<SelectedTargets> {
  if (requested !== undefined) {
    if (requested === "codex") {
      return { installCodex: true, jsonTargets: [] }
    }
    const target = jsonTargets.find((entry) => entry.id === requested)
    if (target === undefined) {
      throw new Error(`Unknown install target: ${requested}`)
    }
    return { installCodex: false, jsonTargets: [target] }
  }
  if (args.has("--all-known")) {
    return { installCodex: true, jsonTargets }
  }
  const detected = jsonTargets.filter(isDetected)
  if (args.has("--all-detected")) {
    return { installCodex: codexDetected, jsonTargets: detected }
  }

  printTargets()
  const rl = createInterface({ input, output })
  const answer = await rl.question("Install targets [detected/all/comma ids/none]: ")
  rl.close()
  if (answer.trim() === "all") {
    return { installCodex: true, jsonTargets }
  }
  if (answer.trim() === "detected") {
    return { installCodex: codexDetected, jsonTargets: detected }
  }
  if (answer.trim() === "none" || answer.trim().length === 0) {
    return { installCodex: false, jsonTargets: [] }
  }
  const ids = new Set(
    answer
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const unknown = [...ids].filter(
    (id) => id !== "codex" && !jsonTargets.some((entry) => entry.id === id),
  )
  if (unknown.length > 0) {
    throw new Error(`Unknown install target: ${unknown.join(", ")}`)
  }
  return {
    installCodex: ids.has("codex"),
    jsonTargets: jsonTargets.filter((entry) => ids.has(entry.id)),
  }
}

function printTargets(): void {
  console.log("NetSuite SuperMCP client install targets:")
  console.log(`- codex: ${paths.codexConfig} ${codexDetected ? "(detected)" : ""}`)
  for (const entry of jsonTargets) {
    console.log(
      `- ${entry.id}: ${entry.label} -> ${entry.path} ${isDetected(entry) ? "(detected)" : ""}`,
    )
  }
}

async function installTargets(targets: SelectedTargets): Promise<void> {
  if (targets.installCodex) {
    await installCodex()
  }
  for (const entry of targets.jsonTargets) {
    await installJsonTarget(entry)
  }
}

async function installCodex(): Promise<void> {
  const current = await readText(paths.codexConfig)
  const next = replaceTomlServer(current, createCodexBlock(paths))
  await writeText(paths.codexConfig, next)
  console.log(`installed codex -> ${paths.codexConfig}`)
}

async function installJsonTarget(entry: JsonTarget): Promise<void> {
  const current = await readJson(entry.path)
  const mcpServers = isObject(current["mcpServers"]) ? current["mcpServers"] : {}
  current["mcpServers"] = {
    ...mcpServers,
    "netsuite-supermcp": createJsonServerConfig(paths, entry.clientName),
  }
  await writeJson(entry.path, current)
  console.log(`installed ${entry.id} -> ${entry.path}`)
}

async function ensureEnvFile(): Promise<void> {
  const envPath = join(paths.workspaceRoot, ".env")
  if (existsSync(envPath)) {
    return
  }
  const example = await readText(join(paths.packageRoot, ".env.example"))
  await writeText(envPath, example)
  console.log(`created ${envPath} from .env.example; fill NetSuite OAuth values before live use`)
}

function printSnippet(): void {
  console.log("\nGeneric mcpServers snippet:")
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          "netsuite-supermcp": {
            command: "bun",
            args: ["run", paths.stdioEntry],
            env: createServerEnv(paths, "generic"),
          },
        },
      },
      null,
      2,
    ),
  )
}

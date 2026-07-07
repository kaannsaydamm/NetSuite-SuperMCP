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
    `- codex: ${paths.codexConfig} ${existsSync(paths.codexConfig) || existsSync(dirname(paths.codexConfig)) ? "(detected)" : ""}`,
  )
  for (const entry of jsonTargets) {
    console.log(
      `- ${entry.id}: ${entry.label} -> ${entry.path} ${isDetected(entry) ? "(detected)" : ""}`,
    )
  }
}

async function installTargets(targets: readonly JsonTarget[]): Promise<void> {
  const requested = process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1]
  if (
    args.has("--all-known") ||
    (args.has("--all-detected") &&
      (existsSync(paths.codexConfig) || existsSync(dirname(paths.codexConfig)))) ||
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
  const envPath = join(paths.projectRoot, ".env")
  if (existsSync(envPath)) {
    return
  }
  const example = await readText(join(paths.projectRoot, ".env.example"))
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

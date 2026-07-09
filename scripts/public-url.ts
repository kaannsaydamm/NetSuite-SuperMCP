import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { arch, homedir, platform, tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { openBrowser } from "./browser-open"

type DownloadSpec = {
  readonly archiveName: string
  readonly executableName: string
  readonly url: string
}

type NgrokVersion = {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const minimumNgrokVersion: NgrokVersion = { major: 3, minor: 20, patch: 0 }
const args = new Set(process.argv.slice(2))
const requestedPort = readNumberArg("--port") ?? 3025
const authtoken = readStringArg("--ngrok-authtoken") ?? process.env["NGROK_AUTHTOKEN"]

if (args.has("--help") || args.has("-h")) {
  printHelp()
  process.exit(0)
}

const port = await findFreePort(requestedPort)
const ngrokPath = await ensureNgrok()
await ensureNgrokAuthtoken(ngrokPath, authtoken)

const localUrl = `http://127.0.0.1:${port}`
const server = spawn("bun", ["run", join(packageRoot, "src", "index.ts")], {
  cwd: packageRoot,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    MCP_AUTH_MODE: "none",
    MCP_HOST: "127.0.0.1",
    MCP_PORT: String(port),
  },
})

let serverOutput = ""
server.stdout.on("data", (chunk: Buffer) => {
  serverOutput += chunk.toString("utf8")
})
server.stderr.on("data", (chunk: Buffer) => {
  serverOutput += chunk.toString("utf8")
})

const ngrok = spawn(ngrokPath, ["http", localUrl, "--log=stdout", "--log-format=logfmt"], {
  stdio: ["ignore", "pipe", "pipe"],
})
let ngrokOutput = ""
ngrok.stdout.on("data", (chunk: Buffer) => {
  ngrokOutput += chunk.toString("utf8")
})
ngrok.stderr.on("data", (chunk: Buffer) => {
  ngrokOutput += chunk.toString("utf8")
})

let isShuttingDown = false
const shutdown = (): void => {
  isShuttingDown = true
  ngrok.kill()
  server.kill()
}
process.on("SIGINT", () => {
  shutdown()
  process.exit(0)
})
process.on("SIGTERM", () => {
  shutdown()
  process.exit(0)
})

try {
  await waitForHealth(localUrl)
  const publicUrl = await waitForNgrokUrl()
  const mcpUrl = `${publicUrl}/mcp`
  console.log("")
  console.log("NetSuite SuperMCP public URL is ready.")
  console.log("")
  console.log(`Server URL: ${mcpUrl}`)
  console.log("")
  console.log("ChatGPT app setup:")
  console.log("  Connection: Server URL")
  console.log("  Authentication: No auth")
  console.log(`  URL: ${mcpUrl}`)
  console.log("")
  console.log("Keep this terminal open while ChatGPT uses the connector.")
  await waitUntilChildExits()
} catch (error) {
  shutdown()
  throw error
}

async function ensureNgrok(): Promise<string> {
  const existing = findExistingNgrok()
  if (existing !== undefined) {
    return existing
  }

  const spec = downloadSpec()
  const installDir = join(userDataDir(), "ngrok")
  const executablePath = join(installDir, spec.executableName)
  if (existsSync(executablePath)) {
    return executablePath
  }

  await mkdir(installDir, { recursive: true })
  const archivePath = join(tmpdir(), spec.archiveName)
  console.log("Downloading ngrok agent...")
  try {
    await downloadFile(spec.url, archivePath)
    await extractArchive(archivePath, installDir)
    await normalizeExtractedExecutable(installDir, executablePath, spec.executableName)
  } catch (error) {
    if (process.platform === "win32") {
      console.log("Direct ngrok extraction failed; trying winget install...")
      await rm(archivePath, { force: true })
      const wingetPath = tryInstallNgrokWithWinget()
      if (wingetPath !== undefined) {
        return wingetPath
      }
    }
    throw error
  }
  await rm(archivePath, { force: true })

  if (!existsSync(executablePath)) {
    if (process.platform === "win32") {
      console.log("ngrok executable was not extracted; trying winget install...")
      const wingetPath = tryInstallNgrokWithWinget()
      if (wingetPath !== undefined) {
        return wingetPath
      }
    }
    throw new Error(
      `ngrok download did not produce ${executablePath}. Windows security software may have blocked the ngrok executable.`,
    )
  }
  return executablePath
}

function findExistingNgrok(): string | undefined {
  const candidates = [findManagedNgrok(), findOnPathNgrok(), findWingetNgrok()].filter(
    (path): path is string => path !== undefined,
  )

  for (const candidate of candidates) {
    const usable = ensureUsableNgrokVersion(candidate)
    if (usable !== undefined) {
      return usable
    }
  }

  return undefined
}

function findOnPathNgrok(): string | undefined {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["ngrok"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  if ((result.status ?? 1) !== 0) {
    return undefined
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

function findManagedNgrok(): string | undefined {
  const executableName = process.platform === "win32" ? "ngrok.exe" : "ngrok"
  const executablePath = join(userDataDir(), "ngrok", executableName)
  return existsSync(executablePath) ? executablePath : undefined
}

function ensureUsableNgrokVersion(ngrokPath: string): string | undefined {
  const version = readNgrokVersion(ngrokPath)
  if (version === undefined) {
    return undefined
  }
  if (isAtLeastVersion(version, minimumNgrokVersion)) {
    return ngrokPath
  }

  console.log(
    `ngrok ${formatVersion(version)} is too old; updating to ${formatVersion(minimumNgrokVersion)} or newer...`,
  )
  const updated = spawnSync(ngrokPath, ["update"], { encoding: "utf8" })
  if ((updated.status ?? 1) !== 0) {
    return undefined
  }
  const updatedVersion = readNgrokVersion(ngrokPath)
  if (updatedVersion !== undefined && isAtLeastVersion(updatedVersion, minimumNgrokVersion)) {
    return ngrokPath
  }
  return undefined
}

function readNgrokVersion(ngrokPath: string): NgrokVersion | undefined {
  const result = spawnSync(ngrokPath, ["version"], { encoding: "utf8" })
  if ((result.status ?? 1) !== 0) {
    return undefined
  }
  const match = result.stdout.match(/ngrok version\s+(\d+)\.(\d+)\.(\d+)/i)
  if (match === null) {
    return undefined
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function isAtLeastVersion(actual: NgrokVersion, minimum: NgrokVersion): boolean {
  if (actual.major !== minimum.major) {
    return actual.major > minimum.major
  }
  if (actual.minor !== minimum.minor) {
    return actual.minor > minimum.minor
  }
  return actual.patch >= minimum.patch
}

function formatVersion(version: NgrokVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

function findWingetNgrok(): string | undefined {
  if (process.platform !== "win32") {
    return undefined
  }
  const packagesDir = join(
    process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
    "Microsoft",
    "WinGet",
    "Packages",
  )
  if (!existsSync(packagesDir)) {
    return undefined
  }
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$p = Get-ChildItem -LiteralPath ${powerShellQuote(packagesDir)} -Recurse -Filter ngrok.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName; if ($p) { Write-Output $p }`,
    ],
    { encoding: "utf8" },
  )
  if ((result.status ?? 1) !== 0) {
    return undefined
  }
  const found = result.stdout.trim()
  return found.length > 0 ? found : undefined
}

async function ensureNgrokAuthtoken(ngrokPath: string, token: string | undefined): Promise<void> {
  if (token !== undefined && token.trim().length > 0) {
    addNgrokAuthtoken(ngrokPath, token.trim())
    return
  }

  const configured = spawnSync(ngrokPath, ["config", "check"], { encoding: "utf8" })
  if ((configured.status ?? 1) === 0) {
    return
  }

  console.log("")
  console.log("ngrok needs an authtoken once. Opening the token page.")
  console.log("Paste it here or rerun with NGROK_AUTHTOKEN set.")
  await openBrowser("https://dashboard.ngrok.com/get-started/your-authtoken")
  const pasted = prompt("ngrok authtoken: ")?.trim()
  if (pasted === undefined || pasted.length === 0) {
    throw new Error("ngrok authtoken is required to start a public URL")
  }
  addNgrokAuthtoken(ngrokPath, pasted)
}

function addNgrokAuthtoken(ngrokPath: string, token: string): void {
  const result = spawnSync(ngrokPath, ["config", "add-authtoken", token], {
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`ngrok authtoken setup failed: ${result.stderr || result.stdout}`)
  }
}

function downloadSpec(): DownloadSpec {
  const system = platform()
  const cpu = arch()
  if (system === "win32" && cpu === "x64") {
    return {
      archiveName: "ngrok-v3-stable-windows-amd64.zip",
      executableName: "ngrok.exe",
      url: "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip",
    }
  }
  if (system === "darwin" && cpu === "arm64") {
    return {
      archiveName: "ngrok-v3-stable-darwin-arm64.zip",
      executableName: "ngrok",
      url: "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-arm64.zip",
    }
  }
  if (system === "darwin" && cpu === "x64") {
    return {
      archiveName: "ngrok-v3-stable-darwin-amd64.zip",
      executableName: "ngrok",
      url: "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-amd64.zip",
    }
  }
  if (system === "linux" && cpu === "arm64") {
    return {
      archiveName: "ngrok-v3-stable-linux-arm64.tgz",
      executableName: "ngrok",
      url: "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz",
    }
  }
  if (system === "linux" && cpu === "x64") {
    return {
      archiveName: "ngrok-v3-stable-linux-amd64.tgz",
      executableName: "ngrok",
      url: "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz",
    }
  }
  throw new Error(`unsupported ngrok platform: ${system}/${cpu}`)
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`)
  }

  await Bun.write(destination, await response.arrayBuffer())
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  const archiveBaseName = basename(archivePath)
  if (archiveBaseName.endsWith(".zip") && process.platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${powerShellQuote(archivePath)} -DestinationPath ${powerShellQuote(destination)} -Force`,
    ])
    return
  }

  if (archiveBaseName.endsWith(".zip")) {
    run("unzip", ["-o", archivePath, "-d", destination])
    return
  }

  run("tar", ["-xzf", archivePath, "-C", destination])
}

async function normalizeExtractedExecutable(
  installDir: string,
  executablePath: string,
  executableName: string,
): Promise<void> {
  if (existsSync(executablePath)) {
    return
  }
  const extracted = await findFile(installDir, executableName)
  if (extracted === undefined) {
    return
  }
  await copyFile(extracted, executablePath)
}

async function findFile(root: string, fileName: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name === fileName) {
      return path
    }
    if (entry.isDirectory()) {
      const found = await findFile(path, fileName)
      if (found !== undefined) {
        return found
      }
    }
  }
  return undefined
}

function tryInstallNgrokWithWinget(): string | undefined {
  const wingetCheck = spawnSync("winget", ["--version"], { encoding: "utf8" })
  if ((wingetCheck.status ?? 1) !== 0) {
    return undefined
  }

  const result = spawnSync(
    "winget",
    [
      "install",
      "--id",
      "Ngrok.Ngrok",
      "-e",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ],
    { encoding: "utf8" },
  )
  if ((result.status ?? 1) !== 0) {
    const details = result.stderr || result.stdout
    if (details.trim().length > 0) {
      console.warn(`winget ngrok install failed: ${details.trim()}`)
    }
    return undefined
  }
  return findExistingNgrok()
}

function run(command: string, commandArgs: readonly string[]): void {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
  })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  }
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`MCP server exited before health passed: ${serverOutput}`)
    }
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) {
        return
      }
    } catch {
      await delay(100)
    }
  }
  throw new Error(`MCP health check timed out: ${serverOutput}`)
}

async function waitForNgrokUrl(): Promise<string> {
  const apiUrl = "http://127.0.0.1:4040/api/tunnels"
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (ngrok.exitCode !== null) {
      throw new Error(`ngrok exited before public URL was ready: ${ngrokOutput}`)
    }

    const loggedUrl = parseNgrokPublicUrl(ngrokOutput)
    if (loggedUrl !== undefined) {
      return loggedUrl
    }

    try {
      const response = await fetch(apiUrl)
      if (response.ok) {
        const body = (await response.json()) as {
          readonly tunnels?: readonly { readonly public_url?: string; readonly proto?: string }[]
        }
        const url = body.tunnels?.find((tunnel) => tunnel.proto === "https")?.public_url
        if (url !== undefined) {
          return url
        }
      }
    } catch {}
    await delay(200)
  }
  throw new Error(`ngrok public URL timed out: ${ngrokOutput}`)
}

function parseNgrokPublicUrl(output: string): string | undefined {
  const match =
    output.match(/url=(https:\/\/[^\\s"]+)/) ??
    output.match(/started tunnel.*(https:\/\/[^\\s"]+)/) ??
    output.match(/Forwarding\\s+https:\/\/[^\\s]+/i)
  if (match === null) {
    return undefined
  }
  const value = match[1] ?? match[0].replace(/^Forwarding\s+/i, "")
  return value.replace(/[,"\r\n]+$/g, "")
}

async function waitUntilChildExits(): Promise<void> {
  await new Promise<void>((resolve) => {
    server.once("exit", resolve)
    ngrok.once("exit", resolve)
  })
  if (isShuttingDown) {
    return
  }
  if (server.exitCode !== null && server.exitCode !== 0) {
    throw new Error(`MCP server exited: ${serverOutput}`)
  }
  if (ngrok.exitCode !== null && ngrok.exitCode !== 0) {
    throw new Error(`ngrok exited: ${ngrokOutput}`)
  }
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port += 1) {
    if (await isPortFree(port)) {
      return port
    }
  }
  throw new Error(`could not find a free local port starting at ${start}`)
}

async function isPortFree(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const candidate = createServer()
    candidate.once("error", () => resolve(false))
    candidate.once("listening", () => {
      candidate.close(() => resolve(true))
    })
    candidate.listen(port, "127.0.0.1")
  })
}

function userDataDir(): string {
  if (process.platform === "win32") {
    return join(
      process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
      "NetSuiteSuperMCP",
    )
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "NetSuiteSuperMCP")
  }
  return join(
    process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"),
    "netsuite-supermcp",
  )
}

function readNumberArg(name: string): number | undefined {
  const value = readStringArg(name)
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a TCP port`)
  }
  return parsed
}

function readStringArg(name: string): string | undefined {
  const prefix = `${name}=`
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  if (inline !== undefined) {
    return inline.slice(prefix.length)
  }
  const index = process.argv.indexOf(name)
  if (index >= 0) {
    return process.argv[index + 1]
  }
  return undefined
}

function printHelp(): void {
  console.log("Usage: netsuite-supermcp public-url [--port 3025] [--ngrok-authtoken TOKEN]")
  console.log("")
  console.log("Starts NetSuite SuperMCP locally, starts ngrok, and prints a public HTTPS /mcp URL.")
  console.log("Use that URL in ChatGPT with Authentication set to No auth.")
}

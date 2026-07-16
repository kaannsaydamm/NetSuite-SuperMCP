import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { SERVER_ENV_KEYS } from "./config"
import { readEnvFile } from "./io"

export type JsonTarget = {
  readonly id: string
  readonly label: string
  readonly path: string
  readonly clientName: string
  readonly detect: readonly string[]
}

export type InstallerPaths = {
  readonly packageRoot: string
  readonly workspaceRoot: string
  readonly stdioEntry: string
  readonly codexConfig: string
  readonly env: Record<string, string>
}

export function createInstallerPaths(scriptDir: string): InstallerPaths {
  const packageRoot = resolve(scriptDir, "..")
  const workspaceRoot = resolve(process.cwd())
  const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "."
  const fileEnv =
    readEnvFile(join(workspaceRoot, ".env")) ??
    readEnvFile(join(packageRoot, ".env")) ??
    readEnvFile(join(packageRoot, ".env.example")) ??
    {}
  return {
    packageRoot,
    workspaceRoot,
    stdioEntry: join(packageRoot, "src", "stdio.ts"),
    codexConfig: join(home, ".codex", "config.toml"),
    env: mergeInstallerEnv(fileEnv, process.env),
  }
}

export function mergeInstallerEnv(
  fileEnv: Readonly<Record<string, string>>,
  processEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  const explicitEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(processEnv)) {
    if (
      !SERVER_ENV_KEYS.has(key) ||
      value === undefined ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      continue
    }
    explicitEnv[key] = value
  }
  return {
    ...fileEnv,
    ...explicitEnv,
  }
}

export function createJsonTargets(paths: InstallerPaths): readonly JsonTarget[] {
  const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "."
  const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming")
  const workspaceRoot = paths.workspaceRoot

  return [
    target(
      "claude-code",
      "Claude Code project .mcp.json",
      join(workspaceRoot, ".mcp.json"),
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
    target("vscode", "VS Code workspace", join(workspaceRoot, ".vscode", "mcp.json"), "vscode", [
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
    target(
      "zed",
      "Zed / Zcode MCP snippet",
      join(workspaceRoot, "generated", "zed-mcp.json"),
      "zed",
      [join(appData, "Zed"), join(home, ".config", "zed")],
    ),
  ]
}

export function isDetected(entry: JsonTarget): boolean {
  return existsSync(entry.path) || entry.detect.some((path) => existsSync(path))
}

function target(
  id: string,
  label: string,
  path: string,
  clientName: string,
  detect: readonly string[],
): JsonTarget {
  return { id, label, path, clientName, detect }
}

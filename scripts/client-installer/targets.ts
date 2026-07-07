import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { readEnvFile } from "./io"

export type JsonTarget = {
  readonly id: string
  readonly label: string
  readonly path: string
  readonly clientName: string
  readonly detect: readonly string[]
}

export type InstallerPaths = {
  readonly projectRoot: string
  readonly stdioEntry: string
  readonly codexConfig: string
  readonly env: Record<string, string>
}

export function createInstallerPaths(scriptDir: string): InstallerPaths {
  const projectRoot = resolve(scriptDir, "..")
  const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "."
  return {
    projectRoot,
    stdioEntry: join(projectRoot, "src", "stdio.ts"),
    codexConfig: join(home, ".codex", "config.toml"),
    env:
      readEnvFile(join(projectRoot, ".env")) ??
      readEnvFile(join(projectRoot, ".env.example")) ??
      {},
  }
}

export function createJsonTargets(paths: InstallerPaths): readonly JsonTarget[] {
  const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "."
  const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming")
  const projectRoot = paths.projectRoot

  return [
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
    target(
      "zed",
      "Zed / Zcode MCP snippet",
      join(projectRoot, "generated", "zed-mcp.json"),
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

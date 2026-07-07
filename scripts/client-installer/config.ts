import type { InstallerPaths } from "./targets"

export function createServerEnv(paths: InstallerPaths, clientName: string): Record<string, string> {
  return {
    ...paths.env,
    MCP_CLIENT: clientName,
    MCP_REQUESTER: process.env["USERNAME"] ?? process.env["USER"] ?? "local-user",
  }
}

export function createJsonServerConfig(
  paths: InstallerPaths,
  clientName: string,
): Record<string, unknown> {
  return {
    command: "bun",
    args: ["run", paths.stdioEntry],
    env: createServerEnv(paths, clientName),
  }
}

export function createCodexBlock(paths: InstallerPaths): string {
  return [
    "",
    "[mcp_servers.netsuite-supermcp]",
    'command = "bun"',
    `args = ["run", "${tomlEscape(paths.stdioEntry)}"]`,
    "enabled = true",
    "[mcp_servers.netsuite-supermcp.env]",
    ...Object.entries(createServerEnv(paths, "codex")).map(([key, value]) => {
      return `${key} = "${tomlEscape(value)}"`
    }),
    "",
  ].join("\n")
}

export function replaceTomlServer(current: string, block: string): string {
  const pattern =
    /\n?\[mcp_servers\.netsuite-supermcp\][\s\S]*?(?=\n\[mcp_servers\.|\n\[[^\]]+\]|\s*$)/g
  const cleaned = current.replace(pattern, "").trimEnd()
  return `${cleaned}${block}`
}

function tomlEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

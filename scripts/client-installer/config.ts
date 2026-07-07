import type { InstallerPaths } from "./targets"

const SERVER_ENV_KEYS = new Set([
  "MCP_SERVER_NAME",
  "MCP_SERVER_VERSION",
  "MCP_HOST",
  "MCP_PORT",
  "MCP_BEARER_TOKEN",
  "NETSUITE_ACCOUNT_ID",
  "NETSUITE_ENVIRONMENT",
  "NETSUITE_BASE_URL",
  "NETSUITE_RESTLET_URL",
  "NETSUITE_CONSUMER_KEY",
  "NETSUITE_CERTIFICATE_ID",
  "NETSUITE_PRIVATE_KEY_PEM_BASE64",
  "NETSUITE_TOKEN_URL",
  "AUDIT_LOG_PATH",
])

export function createServerEnv(paths: InstallerPaths, clientName: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(paths.env).filter(([key]) => SERVER_ENV_KEYS.has(key)),
  )
  return {
    ...env,
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

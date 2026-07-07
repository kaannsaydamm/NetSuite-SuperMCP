import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerNetSuiteTools } from "./netsuite-tools"
import { registerSystemTools } from "./system-tools"
import type { ToolDependencies } from "./types"

export function registerTools(server: McpServer, dependencies: ToolDependencies): void {
  registerSystemTools(server, dependencies)
  registerNetSuiteTools(server, dependencies)
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerActionTools } from "./action-tools"
import { registerRecordTools } from "./record-tools"
import type { ToolDependencies } from "./types"

export function registerNetSuiteTools(server: McpServer, dependencies: ToolDependencies): void {
  registerRecordTools(server, dependencies)
  registerActionTools(server, dependencies)
}

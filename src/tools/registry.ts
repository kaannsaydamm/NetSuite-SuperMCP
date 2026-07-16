import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerIdentityTools } from "./identity-tools"
import { registerNetSuiteTools } from "./netsuite-tools"
import { registerQueryTools } from "./query-tools"
import { registerRecordExplorerTools } from "./record-explorer-tools"
import { registerScriptTools } from "./script-tools"
import { registerSystemTools } from "./system-tools"
import type { ToolDependencies } from "./types"

export function registerTools(server: McpServer, dependencies: ToolDependencies): void {
  registerSystemTools(server, dependencies)
  registerIdentityTools(server, dependencies)
  registerRecordExplorerTools(server, dependencies)
  registerQueryTools(server, dependencies)
  registerScriptTools(server, dependencies)
  registerNetSuiteTools(server, dependencies)
}

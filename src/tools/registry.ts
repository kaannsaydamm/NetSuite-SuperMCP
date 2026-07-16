import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerAssuranceTools } from "./assurance-tools"
import { registerCustomizationTools } from "./customization-tools"
import { registerIdentityTools } from "./identity-tools"
import { registerIntegrationTools } from "./integration-tools"
import { registerNetSuiteTools } from "./netsuite-tools"
import { registerQueryTools } from "./query-tools"
import { registerRecordExplorerTools } from "./record-explorer-tools"
import { registerRunbookTools } from "./runbook-tools"
import { registerScriptTools } from "./script-tools"
import { registerSemanticTools } from "./semantic-tools"
import { registerSystemTools } from "./system-tools"
import type { ToolDependencies } from "./types"

export function registerTools(server: McpServer, dependencies: ToolDependencies): void {
  registerSystemTools(server, dependencies)
  registerIdentityTools(server, dependencies)
  registerRecordExplorerTools(server, dependencies)
  registerQueryTools(server, dependencies)
  registerScriptTools(server, dependencies)
  registerIntegrationTools(server, dependencies)
  registerCustomizationTools(server, dependencies)
  registerSemanticTools(server, dependencies)
  registerAssuranceTools(server, dependencies)
  registerRunbookTools(server, dependencies)
  registerNetSuiteTools(server, dependencies)
}

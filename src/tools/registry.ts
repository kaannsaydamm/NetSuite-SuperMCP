import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getToolContract } from "../contracts/tool-registry"
import { registerAssuranceTools } from "./assurance-tools"
import { registerCustomizationTools } from "./customization-tools"
import { registerHarnessTools } from "./harness-tools"
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
  const scopedServer = filterToolRegistration(server, dependencies.allowedToolNames)
  registerSystemTools(scopedServer, dependencies)
  registerHarnessTools(scopedServer, dependencies)
  registerIdentityTools(scopedServer, dependencies)
  registerRecordExplorerTools(scopedServer, dependencies)
  registerQueryTools(scopedServer, dependencies)
  registerScriptTools(scopedServer, dependencies)
  registerIntegrationTools(scopedServer, dependencies)
  registerCustomizationTools(scopedServer, dependencies)
  registerSemanticTools(scopedServer, dependencies)
  registerAssuranceTools(scopedServer, dependencies)
  registerRunbookTools(scopedServer, dependencies)
  registerNetSuiteTools(scopedServer, dependencies)
}

function filterToolRegistration(server: McpServer, allowed: ReadonlySet<string>): McpServer {
  return new Proxy(server, {
    get(target, property) {
      if (property === "registerTool")
        return (name: string, ...args: unknown[]) => {
          if (!allowed.has(name)) return undefined
          const register = target.registerTool as (...parameters: unknown[]) => unknown
          const contract = getToolContract(name)
          const options = args[0]
          const normalizedOptions =
            options !== null && typeof options === "object" && !Array.isArray(options)
              ? {
                  ...options,
                  inputSchema: contract.inputSchema,
                  outputSchema: contract.outputSchema,
                }
              : options
          return register.call(target, name, normalizedOptions, ...args.slice(1))
        }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

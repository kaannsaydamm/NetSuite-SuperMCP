import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { JsonObject } from "../shared/json"
import { AuditLogInputSchema, EmptyInputSchema, ToolName, toolPolicies } from "./catalog"
import { respond } from "./response"
import type { ToolDependencies } from "./types"

export function registerSystemTools(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.GetEnvironment,
    {
      title: "Get NetSuite SuperMCP environment",
      description:
        "Returns current sandbox/production environment and production write lock state.",
      inputSchema: EmptyInputSchema,
    },
    async () =>
      respond(ToolName.GetEnvironment, dependencies, {}, environmentPayload(dependencies)),
  )

  server.registerTool(
    ToolName.ListCapabilities,
    {
      title: "List NetSuite SuperMCP capabilities",
      description: "Returns tool risk, mutation, and preview metadata for approval decisions.",
      inputSchema: EmptyInputSchema,
    },
    async () =>
      respond(
        ToolName.ListCapabilities,
        dependencies,
        {},
        {
          tools: Object.values(toolPolicies).map((policy) => ({
            name: policy.toolName,
            risk: policy.risk,
            mutatesNetSuite: policy.mutatesNetSuite,
            requiresPreview: policy.requiresPreview,
          })),
        },
      ),
  )

  server.registerTool(
    ToolName.GetAuditLog,
    {
      title: "Get SuperMCP audit log",
      description: "Reads recent SuperMCP audit events, newest first.",
      inputSchema: AuditLogInputSchema,
    },
    async (input) =>
      respond(ToolName.GetAuditLog, dependencies, input, {
        events: await dependencies.auditLog.readRecent(input.limit),
      }),
  )
}

function environmentPayload(dependencies: ToolDependencies): JsonObject {
  return {
    environment: dependencies.config.netsuite.environment,
    productionWritesEnabled: dependencies.config.productionWritesEnabled,
  }
}

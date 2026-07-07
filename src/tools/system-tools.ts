import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { JsonObject } from "../shared/json"
import {
  AccountPermissionCheckInputSchema,
  AuditLogInputSchema,
  EmptyInputSchema,
  ToolName,
  toolPolicies,
} from "./catalog"
import { respond } from "./response"
import type { ToolDependencies } from "./types"

export function registerSystemTools(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.GetEnvironment,
    {
      title: "Get NetSuite SuperMCP environment",
      description: "Returns the configured NetSuite account and sandbox/production environment.",
      inputSchema: EmptyInputSchema,
    },
    async () =>
      respond(ToolName.GetEnvironment, dependencies, {}, environmentPayload(dependencies)),
  )

  server.registerTool(
    ToolName.CheckAccountPermissions,
    {
      title: "Check NetSuite account permissions",
      description:
        "Runs safe probes with the configured NetSuite OAuth account and reports allowed or denied access.",
      inputSchema: AccountPermissionCheckInputSchema,
    },
    async (input) =>
      respond(
        ToolName.CheckAccountPermissions,
        dependencies,
        input,
        await accountPermissionPayload(dependencies, input),
      ),
  )

  server.registerTool(
    ToolName.ListCapabilities,
    {
      title: "List NetSuite SuperMCP capabilities",
      description: "Returns tool risk and mutation metadata for client-side approval decisions.",
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
    accountId: dependencies.config.netsuite.accountId,
    environment: dependencies.config.netsuite.environment,
  }
}

async function accountPermissionPayload(
  dependencies: ToolDependencies,
  input: { readonly recordTypes: readonly string[]; readonly includeRestlet: boolean },
): Promise<JsonObject> {
  const checks = [
    await probe("rest_metadata_catalog", () =>
      dependencies.netsuite.getRecordMetadata({ select: [], mediaType: "application/schema+json" }),
    ),
    await probe("suiteql", () =>
      dependencies.netsuite.runSuiteQl({ query: "SELECT 1 AS permission_probe", params: [] }),
    ),
  ]

  for (const recordType of input.recordTypes) {
    checks.push(
      await probe(`record_metadata:${recordType}`, () =>
        dependencies.netsuite.getRecordMetadata({
          type: recordType,
          select: [],
          mediaType: "application/schema+json",
        }),
      ),
    )
  }

  if (input.includeRestlet) {
    checks.push(
      await probe("restlet_preview", () =>
        dependencies.netsuite.runRestletAction({
          action: ToolName.CheckAccountPermissions,
          phase: "preview",
          payload: {},
        }),
      ),
    )
  }

  return {
    accountId: dependencies.config.netsuite.accountId,
    environment: dependencies.config.netsuite.environment,
    checks,
  }
}

async function probe(name: string, run: () => Promise<JsonObject>): Promise<JsonObject> {
  try {
    await run()
    return { name, allowed: true }
  } catch (error) {
    return {
      name,
      allowed: false,
      error: error instanceof Error ? error.message : "Unknown NetSuite permission error",
    }
  }
}

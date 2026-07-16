import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import type { AppConfig } from "../config"
import {
  DiagnoseAuthenticationInputSchema,
  IdentityProfileInputSchema,
  IntegrationStateInputSchema,
  LoginAuditTrailInputSchema,
  RevokeOAuthInputSchema,
  RoleAccessInputSchema,
  RoleComparisonInputSchema,
  SegregationOfDutiesInputSchema,
} from "../contracts/identity-schemas"
import {
  analyzeRoleAccess,
  currentIdentity,
  diagnoseAuthentication,
  type IdentityProfile,
  readPermissionLevels,
  tokenMetadata,
} from "../diagnostics/identity-diagnostics"
import type { NetSuiteClient } from "../netsuite/client"
import type { OAuthControl } from "../netsuite/oauth"
import type { JsonObject } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerIdentityTools(server: McpServer, dependencies: ToolDependencies): void {
  registerReadTool(
    server,
    dependencies,
    ToolName.DiagnoseAuthentication,
    DiagnoseAuthenticationInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      return await diagnoseAuthentication(
        input.profile,
        selected.config,
        selected.client,
        input.includeAuthenticatedChecks,
      )
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.TestOAuthCredentials,
    IdentityProfileInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      return await diagnoseAuthentication(input.profile, selected.config, selected.client, true)
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.GetOAuthTokenMetadata,
    IdentityProfileInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      return tokenMetadata(
        input.profile,
        selected.config,
        selected.oauth?.hasCachedAccessToken() ?? false,
      )
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.AnalyzeRoleAccess,
    RoleAccessInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      return await analyzeRoleAccess(
        input.profile,
        selected.client,
        input.recordFamilies,
        input.permissions,
      )
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.CompareRoleVisibility,
    RoleComparisonInputSchema,
    async (input) => {
      const current = await analyzeRoleAccess(
        "current",
        dependencies.netsuite,
        input.recordFamilies,
        input.permissions,
      )
      const managementProfile = selectProfile(dependencies, "management")
      const management = await analyzeRoleAccess(
        "management",
        managementProfile.client,
        input.recordFamilies,
        input.permissions,
      )
      return compareRoleResults(current, management, input.recordFamilies, input.permissions)
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.GetLoginAuditTrail,
    LoginAuditTrailInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      const response = await selected.client.runRestletAction({
        action: ToolName.GetLoginAuditTrail,
        phase: "preview",
        payload: {
          status: input.status,
          limit: input.limit,
          ...(input.userId ? { userId: input.userId } : {}),
        },
      })
      const entries = Array.isArray(response["entries"]) ? response["entries"] : []
      return {
        profile: input.profile,
        entries,
        count: entries.length,
        truncated: response["truncated"] === true,
      }
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.ExplainTokenEligibility,
    IdentityProfileInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      const identity = await currentIdentity(selected.client)
      return {
        profile: input.profile,
        eligible: true,
        oauthFlow: selected.config.oauthFlow,
        accountId: selected.config.accountId,
        identity,
        requirements: tokenEligibilityRequirements(selected.config),
      }
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.GetIdentityRelationship,
    IdentityProfileInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      return {
        profile: input.profile,
        accountId: selected.config.accountId,
        oauthFlow: selected.config.oauthFlow,
        integrationConfigured: true,
        user: await currentIdentity(selected.client),
      }
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.GetIntegrationState,
    IntegrationStateInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      const state = await selected.client.runRestletAction({
        action: ToolName.GetPlatformObject,
        phase: "preview",
        payload: { recordType: "integration", recordId: input.integrationId, fields: input.fields },
      })
      const featureContext =
        input.features.length === 0
          ? { features: [] }
          : await selected.client.runRestletAction({
              action: "ns_getRoleDiagnosticContext",
              phase: "preview",
              payload: { features: input.features },
            })
      return {
        profile: input.profile,
        integrationId: input.integrationId,
        state,
        features: Array.isArray(featureContext["features"]) ? featureContext["features"] : [],
      }
    },
  )
  registerReadTool(
    server,
    dependencies,
    ToolName.AnalyzeSegregationOfDuties,
    SegregationOfDutiesInputSchema,
    async (input) => {
      const selected = selectProfile(dependencies, input.profile)
      const names = [...new Set(input.permissionGroups.flatMap((group) => group.permissions))]
      const levels = await readPermissionLevels(selected.client, names)
      const byName = new Map(
        levels.map((entry) => [String(entry["name"]), Number(entry["level"] ?? 0)]),
      )
      const conflicts = input.permissionGroups.flatMap((group) => {
        const permissions = group.permissions.map((name) => ({
          name,
          level: byName.get(name) ?? 0,
        }))
        return permissions.every((permission) => permission.level > 0)
          ? [{ name: group.name, permissions }]
          : []
      })
      return {
        profile: input.profile,
        identity: await currentIdentity(selected.client),
        evaluatedGroups: input.permissionGroups.length,
        conflicts,
      }
    },
  )

  server.registerTool(
    ToolName.RevokeOAuthAuthorization,
    {
      title: "Revoke NetSuite OAuth authorization",
      description:
        "Revokes the explicitly selected authorization-code refresh token and clears the local access-token cache.",
      inputSchema: RevokeOAuthInputSchema,
      outputSchema: outputSchemaFor(ToolName.RevokeOAuthAuthorization),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.RevokeOAuthAuthorization,
        dependencies,
        input,
        execute: async () => {
          const selected = selectProfile(dependencies, input.profile)
          const expected = `revoke:${input.profile}:${selected.config.accountId}`
          if (input.confirmation !== expected)
            throw new Error(`confirmation must match ${expected}`)
          if (selected.oauth === undefined) throw new Error("OAUTH_CONTROL_UNAVAILABLE")
          await selected.oauth.revokeRefreshToken()
          return {
            profile: input.profile,
            revoked: true,
            localCacheCleared: true,
            requiresProcessRestart: true,
          }
        },
      }),
  )
}

function registerReadTool<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  inputSchema: z.ZodType<T>,
  execute: (input: T) => Promise<JsonObject>,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description: "Runs a bounded, read-only NetSuite identity or access diagnostic.",
      inputSchema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input: T) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input: input as JsonObject,
        execute: () => execute(input),
      }),
  )
}

function selectProfile(
  dependencies: ToolDependencies,
  profile: IdentityProfile,
): { client: NetSuiteClient; config: AppConfig["netsuite"]; oauth?: OAuthControl } {
  if (profile === "current") {
    return {
      client: dependencies.netsuite,
      config: dependencies.config.netsuite,
      ...(dependencies.oauthControl === undefined ? {} : { oauth: dependencies.oauthControl }),
    }
  }
  if (dependencies.managementNetsuite === undefined) {
    throw new Error("MANAGEMENT_IDENTITY_NOT_CONFIGURED")
  }
  return {
    client: dependencies.managementNetsuite,
    config: dependencies.config.managementNetsuite ?? dependencies.config.netsuite,
    ...(dependencies.managementOauthControl === undefined
      ? {}
      : { oauth: dependencies.managementOauthControl }),
  }
}

function compareRoleResults(
  current: JsonObject,
  management: JsonObject,
  families: readonly string[],
  permissions: readonly string[],
): JsonObject {
  const currentVisibility = indexedEntries(current["visibility"], "recordFamily")
  const managementVisibility = indexedEntries(management["visibility"], "recordFamily")
  const currentPermissions = indexedEntries(current["permissions"], "name")
  const managementPermissions = indexedEntries(management["permissions"], "name")
  return {
    currentIdentity: asObject(current["identity"]),
    managementIdentity: asObject(management["identity"]),
    matrix: families.map((recordFamily) => {
      const left = currentVisibility.get(recordFamily) ?? {}
      const right = managementVisibility.get(recordFamily) ?? {}
      const currentCount = numeric(left["visibleCount"])
      const managementCount = numeric(right["visibleCount"])
      return {
        recordFamily,
        ...(currentCount === undefined ? {} : { currentVisibleCount: currentCount }),
        ...(managementCount === undefined ? {} : { managementVisibleCount: managementCount }),
        ...(currentCount === undefined || managementCount === undefined
          ? {}
          : { difference: managementCount - currentCount }),
        ...(typeof left["restrictionReason"] === "string"
          ? { currentRestriction: left["restrictionReason"] }
          : {}),
        ...(typeof right["restrictionReason"] === "string"
          ? { managementRestriction: right["restrictionReason"] }
          : {}),
      }
    }),
    permissions: permissions.map((name) => ({
      name,
      currentLevel: numeric(currentPermissions.get(name)?.["level"]) ?? 0,
      managementLevel: numeric(managementPermissions.get(name)?.["level"]) ?? 0,
    })),
  }
}

function indexedEntries(value: unknown, key: string): Map<string, JsonObject> {
  const entries = Array.isArray(value)
    ? value.filter(
        (item): item is JsonObject =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : []
  return new Map(entries.map((entry) => [String(entry[key]), entry]))
}

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined
}

function tokenEligibilityRequirements(config: AppConfig["netsuite"]): readonly string[] {
  return config.oauthFlow === "authorization_code"
    ? [
        "enabled integration record",
        "authorization code grant",
        "eligible user role",
        "refresh token",
      ]
    : [
        "enabled integration record",
        "client credentials grant",
        "certificate mapping",
        "eligible role",
      ]
}

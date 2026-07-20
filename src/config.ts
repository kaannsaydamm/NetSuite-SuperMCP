import { z } from "zod"
import { ConfigError } from "./shared/errors"
import type { Result } from "./shared/result"
import { err, ok } from "./shared/result"
import { PACKAGE_VERSION } from "./version"

const EnvironmentSchema = z.enum(["sandbox", "production"])
const OAuthFlowSchema = z.enum(["client_credentials", "authorization_code"])
const McpAuthModeSchema = z.enum(["bearer", "oauth", "none"])

const NetSuiteConfigSchema = z
  .object({
    accountId: z.string().min(1),
    environment: EnvironmentSchema,
    baseUrl: z.string().url(),
    restletUrl: z.string().url(),
    tokenUrl: z.string().url(),
    oauthFlow: OAuthFlowSchema,
    consumerKey: z.string().optional(),
    certificateId: z.string().optional(),
    privateKeyPemBase64: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    refreshToken: z.string().optional(),
    authorizationUrl: z.string().url().optional(),
    redirectUri: z.string().url().optional(),
  })
  .superRefine((value, context) => {
    if (value.oauthFlow === "client_credentials") {
      requireField(value.consumerKey, "consumerKey", context)
      requireField(value.certificateId, "certificateId", context)
      requireField(value.privateKeyPemBase64, "privateKeyPemBase64", context)
      return
    }
    requireField(value.clientId, "clientId", context)
    requireField(value.clientSecret, "clientSecret", context)
  })

const ConfigSchema = z
  .object({
    serverName: z.string().min(1),
    serverVersion: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    authMode: McpAuthModeSchema,
    bearerToken: z.string().min(12).optional(),
    publicUrl: z.string().url().optional(),
    oauthStorePath: z.string().min(1),
    oauthSecret: z.string().min(32).optional(),
    netsuite: NetSuiteConfigSchema,
    managementNetsuite: NetSuiteConfigSchema.optional(),
    auditLogPath: z.string().min(1),
    jobStorePath: z.string().min(1),
    exportDirectory: z.string().min(1),
    integrationStorePath: z.string().min(1),
    customizationStorePath: z.string().min(1),
    customizationProjectDirectory: z.string().min(1),
    semanticStorePath: z.string().min(1),
    runbookStorePath: z.string().min(1),
    compositeStorePath: z.string().min(1),
    lowRiskRepairClasses: z.array(
      z.enum(["localMetadataRefresh", "readJobRecovery", "exportRebuild"]),
    ),
    cursorSecret: z.string().min(16),
  })
  .superRefine((value, context) => {
    if (
      value.authMode !== "oauth" &&
      value.netsuite.oauthFlow === "authorization_code" &&
      (value.netsuite.refreshToken === undefined || value.netsuite.refreshToken.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["netsuite", "refreshToken"],
        message: "refreshToken is required",
      })
    }
    if (
      value.managementNetsuite?.oauthFlow === "authorization_code" &&
      (value.managementNetsuite.refreshToken === undefined ||
        value.managementNetsuite.refreshToken.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["managementNetsuite", "refreshToken"],
        message: "management refreshToken is required",
      })
    }
    if (value.authMode === "bearer") {
      requireField(value.bearerToken, "bearerToken", context)
      return
    }

    if (value.authMode === "oauth") {
      requireField(value.publicUrl, "publicUrl", context)
      requireField(value.oauthSecret, "oauthSecret", context)
      requireField(value.netsuite.authorizationUrl, "netsuite.authorizationUrl", context)
      requireField(value.netsuite.redirectUri, "netsuite.redirectUri", context)
      if (value.netsuite.oauthFlow !== "authorization_code") {
        context.addIssue({
          code: "custom",
          path: ["netsuite", "oauthFlow"],
          message: "MCP_AUTH_MODE=oauth requires NETSUITE_OAUTH_FLOW=authorization_code",
        })
      }
      if (value.publicUrl !== undefined && new URL(value.publicUrl).protocol !== "https:") {
        context.addIssue({
          code: "custom",
          path: ["publicUrl"],
          message: "MCP_PUBLIC_URL must use HTTPS",
        })
      }
      if (
        value.publicUrl !== undefined &&
        value.netsuite.redirectUri !== undefined &&
        value.netsuite.redirectUri !==
          `${value.publicUrl.replace(/\/+$/, "")}/oauth/netsuite/callback`
      ) {
        context.addIssue({
          code: "custom",
          path: ["netsuite", "redirectUri"],
          message: "NETSUITE_REDIRECT_URI must equal MCP_PUBLIC_URL/oauth/netsuite/callback",
        })
      }
      return
    }

    if (!["127.0.0.1", "localhost", "::1"].includes(value.host)) {
      context.addIssue({
        code: "custom",
        path: ["authMode"],
        message: "MCP_AUTH_MODE=none is allowed only when MCP_HOST is 127.0.0.1, localhost, or ::1",
      })
    }
  })

export type AppConfig = z.infer<typeof ConfigSchema>
export type NetSuiteEnvironment = z.infer<typeof EnvironmentSchema>

export function parseConfig(env: NodeJS.ProcessEnv): Result<AppConfig, ConfigError> {
  const parsed = ConfigSchema.safeParse({
    serverName: env["MCP_SERVER_NAME"] ?? "NetSuite SuperMCP",
    serverVersion: nonEmptyEnv(env["MCP_SERVER_VERSION_OVERRIDE"]) ?? PACKAGE_VERSION,
    host: env["MCP_HOST"] ?? "127.0.0.1",
    port: Number(env["MCP_PORT"] ?? "3025"),
    authMode: env["MCP_AUTH_MODE"] ?? "bearer",
    bearerToken: env["MCP_BEARER_TOKEN"],
    publicUrl: nonEmptyEnv(env["MCP_PUBLIC_URL"]),
    oauthStorePath: env["MCP_OAUTH_STORE_PATH"] ?? "./data/mcp-oauth.json",
    oauthSecret: nonEmptyEnv(env["MCP_OAUTH_SECRET"]),
    netsuite: {
      accountId: env["NETSUITE_ACCOUNT_ID"],
      environment: env["NETSUITE_ENVIRONMENT"],
      baseUrl: env["NETSUITE_BASE_URL"],
      restletUrl: env["NETSUITE_RESTLET_URL"],
      tokenUrl: env["NETSUITE_TOKEN_URL"],
      oauthFlow: env["NETSUITE_OAUTH_FLOW"] ?? "client_credentials",
      consumerKey: env["NETSUITE_CONSUMER_KEY"],
      certificateId: env["NETSUITE_CERTIFICATE_ID"],
      privateKeyPemBase64: env["NETSUITE_PRIVATE_KEY_PEM_BASE64"],
      clientId: env["NETSUITE_CLIENT_ID"],
      clientSecret: env["NETSUITE_CLIENT_SECRET"],
      refreshToken: env["NETSUITE_REFRESH_TOKEN"],
      authorizationUrl: env["NETSUITE_AUTHORIZATION_URL"],
      redirectUri: env["NETSUITE_REDIRECT_URI"],
    },
    managementNetsuite: managementConfigFromEnv(env),
    auditLogPath: env["AUDIT_LOG_PATH"] ?? "./data/audit.ndjson",
    jobStorePath: env["JOB_STORE_PATH"] ?? "./data/read-jobs.json",
    exportDirectory: env["EXPORT_DIRECTORY"] ?? "./data/exports",
    integrationStorePath: env["INTEGRATION_STORE_PATH"] ?? "./data/integrations.json",
    customizationStorePath:
      env["CUSTOMIZATION_STORE_PATH"] ?? "./data/customization-deployments.json",
    customizationProjectDirectory:
      env["CUSTOMIZATION_PROJECT_DIRECTORY"] ?? "./data/customization-projects",
    semanticStorePath: env["SEMANTIC_STORE_PATH"] ?? "./data/semantic-definitions.json",
    runbookStorePath: env["RUNBOOK_STORE_PATH"] ?? "./data/runbooks.json",
    compositeStorePath: env["COMPOSITE_STORE_PATH"] ?? "./data/composites.json",
    lowRiskRepairClasses: commaList(env["RUNBOOK_LOW_RISK_REPAIR_CLASSES"]),
    cursorSecret:
      env["MCP_CURSOR_SECRET"] ??
      env["MCP_BEARER_TOKEN"] ??
      env["NETSUITE_CLIENT_SECRET"] ??
      env["NETSUITE_PRIVATE_KEY_PEM_BASE64"] ??
      env["NETSUITE_REFRESH_TOKEN"],
  })

  if (!parsed.success) {
    return err(new ConfigError(parsed.error.issues.map((issue) => issue.message)))
  }

  return ok(parsed.data)
}

function managementConfigFromEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string | undefined> | undefined {
  if (nonEmptyEnv(env["NETSUITE_MANAGEMENT_ACCOUNT_ID"]) === undefined) return undefined
  return {
    accountId: env["NETSUITE_MANAGEMENT_ACCOUNT_ID"],
    environment: env["NETSUITE_MANAGEMENT_ENVIRONMENT"],
    baseUrl: env["NETSUITE_MANAGEMENT_BASE_URL"],
    restletUrl: env["NETSUITE_MANAGEMENT_RESTLET_URL"],
    tokenUrl: env["NETSUITE_MANAGEMENT_TOKEN_URL"],
    oauthFlow: env["NETSUITE_MANAGEMENT_OAUTH_FLOW"] ?? "authorization_code",
    consumerKey: env["NETSUITE_MANAGEMENT_CONSUMER_KEY"],
    certificateId: env["NETSUITE_MANAGEMENT_CERTIFICATE_ID"],
    privateKeyPemBase64: env["NETSUITE_MANAGEMENT_PRIVATE_KEY_PEM_BASE64"],
    clientId: env["NETSUITE_MANAGEMENT_CLIENT_ID"],
    clientSecret: env["NETSUITE_MANAGEMENT_CLIENT_SECRET"],
    refreshToken: env["NETSUITE_MANAGEMENT_REFRESH_TOKEN"],
    authorizationUrl: env["NETSUITE_MANAGEMENT_AUTHORIZATION_URL"],
    redirectUri: env["NETSUITE_MANAGEMENT_REDIRECT_URI"],
  }
}

function requireField(value: string | undefined, path: string, context: z.RefinementCtx): void {
  if (value === undefined || value.length === 0) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: `${path} is required`,
    })
  }
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined
  }
  return value
}

function commaList(value: string | undefined): string[] {
  return value === undefined
    ? []
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
}

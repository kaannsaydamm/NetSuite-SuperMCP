import { z } from "zod"
import { ConfigError } from "./shared/errors"
import type { Result } from "./shared/result"
import { err, ok } from "./shared/result"

const EnvironmentSchema = z.enum(["sandbox", "production"])
const OAuthFlowSchema = z.enum(["client_credentials", "authorization_code"])

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
    requireField(value.refreshToken, "refreshToken", context)
  })

const ConfigSchema = z.object({
  serverName: z.string().min(1),
  serverVersion: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  bearerToken: z.string().min(12),
  netsuite: NetSuiteConfigSchema,
  auditLogPath: z.string().min(1),
})

export type AppConfig = z.infer<typeof ConfigSchema>
export type NetSuiteEnvironment = z.infer<typeof EnvironmentSchema>

export function parseConfig(env: NodeJS.ProcessEnv): Result<AppConfig, ConfigError> {
  const parsed = ConfigSchema.safeParse({
    serverName: env["MCP_SERVER_NAME"] ?? "NetSuite SuperMCP",
    serverVersion: env["MCP_SERVER_VERSION"] ?? "0.1.1",
    host: env["MCP_HOST"] ?? "127.0.0.1",
    port: Number(env["MCP_PORT"] ?? "3025"),
    bearerToken: env["MCP_BEARER_TOKEN"],
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
    auditLogPath: env["AUDIT_LOG_PATH"] ?? "./data/audit.ndjson",
  })

  if (!parsed.success) {
    return err(new ConfigError(parsed.error.issues.map((issue) => issue.message)))
  }

  return ok(parsed.data)
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

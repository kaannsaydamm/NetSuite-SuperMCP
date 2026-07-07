import { z } from "zod"
import { ConfigError } from "./shared/errors"
import type { Result } from "./shared/result"
import { err, ok } from "./shared/result"

const EnvironmentSchema = z.enum(["sandbox", "production"])

const ConfigSchema = z.object({
  serverName: z.string().min(1),
  serverVersion: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  bearerToken: z.string().min(12),
  netsuite: z.object({
    accountId: z.string().min(1),
    environment: EnvironmentSchema,
    baseUrl: z.string().url(),
    restletUrl: z.string().url(),
    consumerKey: z.string().min(1),
    certificateId: z.string().min(1),
    privateKeyPemBase64: z.string().min(1),
    tokenUrl: z.string().url(),
  }),
  productionWritesEnabled: z.boolean(),
  auditLogPath: z.string().min(1),
})

export type AppConfig = z.infer<typeof ConfigSchema>
export type NetSuiteEnvironment = z.infer<typeof EnvironmentSchema>

export function parseConfig(env: NodeJS.ProcessEnv): Result<AppConfig, ConfigError> {
  const parsed = ConfigSchema.safeParse({
    serverName: env["MCP_SERVER_NAME"] ?? "NetSuite SuperMCP",
    serverVersion: env["MCP_SERVER_VERSION"] ?? "0.1.0",
    host: env["MCP_HOST"] ?? "127.0.0.1",
    port: Number(env["MCP_PORT"] ?? "3025"),
    bearerToken: env["MCP_BEARER_TOKEN"],
    netsuite: {
      accountId: env["NETSUITE_ACCOUNT_ID"],
      environment: env["NETSUITE_ENVIRONMENT"],
      baseUrl: env["NETSUITE_BASE_URL"],
      restletUrl: env["NETSUITE_RESTLET_URL"],
      consumerKey: env["NETSUITE_CONSUMER_KEY"],
      certificateId: env["NETSUITE_CERTIFICATE_ID"],
      privateKeyPemBase64: env["NETSUITE_PRIVATE_KEY_PEM_BASE64"],
      tokenUrl: env["NETSUITE_TOKEN_URL"],
    },
    productionWritesEnabled: env["PRODUCTION_WRITES_ENABLED"] === "true",
    auditLogPath: env["AUDIT_LOG_PATH"] ?? "./data/audit.ndjson",
  })

  if (!parsed.success) {
    return err(new ConfigError(parsed.error.issues.map((issue) => issue.message)))
  }

  return ok(parsed.data)
}

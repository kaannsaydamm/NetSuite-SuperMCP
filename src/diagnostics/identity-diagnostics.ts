import type { AppConfig } from "../config"
import type { NetSuiteClient } from "../netsuite/client"
import type { JsonObject, JsonValue } from "../shared/json"

export type IdentityProfile = "current" | "management"

const tableByFamily = {
  customer: "customer",
  vendor: "vendor",
  employee: "employee",
  item: "item",
  transaction: "transaction",
} as const

export async function diagnoseAuthentication(
  profile: IdentityProfile,
  config: AppConfig["netsuite"],
  client: NetSuiteClient,
  includeAuthenticatedChecks: boolean,
): Promise<JsonObject> {
  const checks: JsonObject[] = [
    { name: "account", passed: config.accountId.length > 0 },
    { name: "tokenEndpoint", passed: isHttpUrl(config.tokenUrl) },
    { name: "restEndpoint", passed: isHttpUrl(config.baseUrl) },
    { name: "restletEndpoint", passed: isHttpUrl(config.restletUrl) },
    { name: "flowCredentials", passed: hasFlowCredentials(config) },
  ]
  if (!includeAuthenticatedChecks) {
    return diagnosis(profile, config, checks, false, "offline_configuration_only")
  }
  try {
    await client.getRecordMetadata({ select: [], mediaType: "application/schema+json" })
    const context = await currentIdentity(client)
    checks.push({ name: "authenticatedMetadata", passed: true })
    checks.push({ name: "restletIdentity", passed: true })
    return {
      ...diagnosis(profile, config, checks, true, "healthy"),
      identity: context,
    }
  } catch (error) {
    const classified = classifyAuthenticationError(error)
    checks.push({ name: "authenticatedMetadata", passed: false, detail: classified.detail })
    return {
      ...diagnosis(profile, config, checks, false, classified.classification),
      likelyCause: classified.detail,
    }
  }
}

export async function analyzeRoleAccess(
  profile: IdentityProfile,
  client: NetSuiteClient,
  recordFamilies: readonly (keyof typeof tableByFamily)[],
  permissions: readonly string[],
): Promise<JsonObject> {
  const identity = await currentIdentity(client)
  const visibility: JsonObject[] = []
  for (const recordFamily of recordFamilies) {
    try {
      const response = await client.runSuiteQl({
        query: `SELECT COUNT(*) AS count FROM ${tableByFamily[recordFamily]}`,
        params: [],
        limit: 1,
      })
      visibility.push({
        recordFamily,
        visibleCount: countFromSuiteQl(response),
        allowed: true,
      })
    } catch (error) {
      visibility.push({
        recordFamily,
        allowed: false,
        restrictionReason: safeErrorMessage(error),
      })
    }
  }
  const permissionLevels = await readPermissionLevels(client, permissions)
  return { profile, identity, visibility, permissions: permissionLevels }
}

export async function currentIdentity(client: NetSuiteClient): Promise<JsonObject> {
  const response = await client.runRestletAction({
    action: "ns_checkAccountPermissions",
    phase: "preview",
    payload: {},
  })
  const identity = response["currentUser"]
  return isObject(identity) ? identity : {}
}

export async function readPermissionLevels(
  client: NetSuiteClient,
  permissions: readonly string[],
): Promise<readonly JsonObject[]> {
  if (permissions.length === 0) return []
  const response = await client.runRestletAction({
    action: "ns_getRoleDiagnosticContext",
    phase: "preview",
    payload: { permissions: [...permissions] },
  })
  const levels = response["permissions"]
  return Array.isArray(levels) ? levels.filter(isObject) : []
}

export function tokenMetadata(
  profile: IdentityProfile,
  config: AppConfig["netsuite"],
  cachedAccessToken: boolean,
): JsonObject {
  return {
    profile,
    accountId: config.accountId,
    environment: config.environment,
    oauthFlow: config.oauthFlow,
    hasRefreshToken: Boolean(config.refreshToken),
    hasClientCredentials: Boolean(config.clientId && config.clientSecret),
    hasCertificateCredentials: Boolean(
      config.consumerKey && config.certificateId && config.privateKeyPemBase64,
    ),
    cachedAccessToken,
  }
}

export function classifyAuthenticationError(error: unknown): {
  readonly classification: string
  readonly detail: string
} {
  const message = safeErrorMessage(error).toLowerCase()
  if (message.includes("revoked")) {
    return { classification: "revoked_refresh_token", detail: "The refresh token was revoked." }
  }
  if (message.includes("expired") || message.includes("invalid_grant")) {
    return {
      classification: "expired_authorization",
      detail: "The delegated authorization is expired or no longer valid; run browser OAuth again.",
    }
  }
  if (message.includes("invalid_client") || message.includes("disabled integration")) {
    return {
      classification: "disabled_or_invalid_integration",
      detail: "The integration record or client authentication is invalid or disabled.",
    }
  }
  if (message.includes("403") || message.includes("forbidden") || message.includes("permission")) {
    return {
      classification: "role_restriction",
      detail: "OAuth succeeded but the selected NetSuite role cannot access the probe.",
    }
  }
  if (message.includes("404") || message.includes("account")) {
    return {
      classification: "wrong_account_or_endpoint",
      detail: "The account ID or derived NetSuite endpoint does not match the authorization.",
    }
  }
  return {
    classification: "unreachable_endpoint",
    detail: "The NetSuite authentication or REST endpoint could not be reached.",
  }
}

function diagnosis(
  profile: IdentityProfile,
  config: AppConfig["netsuite"],
  checks: readonly JsonObject[],
  authenticated: boolean,
  classification: string,
): JsonObject {
  return {
    profile,
    accountId: config.accountId,
    environment: config.environment,
    oauthFlow: config.oauthFlow,
    configured: checks.every((check) => check["passed"] === true),
    authenticated,
    classification,
    checks: [...checks],
  }
}

function hasFlowCredentials(config: AppConfig["netsuite"]): boolean {
  return config.oauthFlow === "authorization_code"
    ? Boolean(config.clientId && config.clientSecret && config.refreshToken)
    : Boolean(config.consumerKey && config.certificateId && config.privateKeyPemBase64)
}

function countFromSuiteQl(response: JsonObject): number {
  const direct = response["count"]
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.max(0, Math.trunc(direct))
  const items = response["items"]
  const value = Array.isArray(items) && isObject(items[0]) ? items[0]["count"] : undefined
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown authentication error"
  return error.message.replace(/token|secret|password|authorization/gi, "credential")
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

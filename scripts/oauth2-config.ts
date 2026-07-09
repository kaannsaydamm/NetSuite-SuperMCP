import { randomUUID } from "node:crypto"

export type NetSuiteEnvironment = "production" | "sandbox"

export type NetSuiteUrls = {
  readonly authorizationUrl: string
  readonly baseUrl: string
  readonly restletUrl: string
  readonly tokenUrl: string
}

export type OAuth2Answers = {
  readonly accountId: string
  readonly environment: NetSuiteEnvironment
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly restletUrl?: string
}

export function deriveNetSuiteUrls(accountId: string): NetSuiteUrls {
  const domainAccount = accountId.toLowerCase().replaceAll("_", "-")
  return {
    authorizationUrl: `https://${domainAccount}.app.netsuite.com/app/login/oauth2/authorize.nl`,
    baseUrl: `https://${domainAccount}.suitetalk.api.netsuite.com`,
    restletUrl: `https://${domainAccount}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_supermcp_action&deploy=customdeploy_supermcp_action`,
    tokenUrl: `https://${domainAccount}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`,
  }
}

export function parseNetSuiteEnvironment(value: string): NetSuiteEnvironment {
  const normalized = value.toLowerCase()
  if (normalized === "production" || normalized === "sandbox") {
    return normalized
  }
  throw new Error("--environment must be production or sandbox")
}

export function cleanDefault(value: string): string {
  const placeholders = new Set([
    "1234567_SB1",
    "1234567-SB1",
    "change-me",
    "change-me-token-please",
    "base64-pem-here",
    "0.1.0",
  ])
  if (placeholders.has(value) || value.includes("1234567-sb1.")) {
    return ""
  }
  return value
}

export function buildOAuth2Env(
  current: ReadonlyMap<string, string>,
  answers: OAuth2Answers,
): Map<string, string> {
  const urls = deriveNetSuiteUrls(answers.accountId)
  const next = new Map(current)
  const bearerToken = cleanDefault(current.get("MCP_BEARER_TOKEN") ?? "") || randomToken()

  next.set(
    "MCP_SERVER_NAME",
    cleanDefault(current.get("MCP_SERVER_NAME") ?? "") || "NetSuite SuperMCP",
  )
  const versionOverride = cleanDefault(current.get("MCP_SERVER_VERSION_OVERRIDE") ?? "")
  if (versionOverride.length > 0) {
    next.set("MCP_SERVER_VERSION_OVERRIDE", versionOverride)
  } else {
    next.delete("MCP_SERVER_VERSION")
    next.delete("MCP_SERVER_VERSION_OVERRIDE")
  }
  next.set("MCP_HOST", cleanDefault(current.get("MCP_HOST") ?? "") || "127.0.0.1")
  next.set("MCP_PORT", cleanDefault(current.get("MCP_PORT") ?? "") || "3025")
  next.set("MCP_BEARER_TOKEN", bearerToken)
  next.set("NETSUITE_ACCOUNT_ID", answers.accountId)
  next.set("NETSUITE_ENVIRONMENT", answers.environment)
  next.set("NETSUITE_BASE_URL", urls.baseUrl)
  next.set("NETSUITE_RESTLET_URL", answers.restletUrl ?? urls.restletUrl)
  next.set("NETSUITE_OAUTH_FLOW", "authorization_code")
  next.set("NETSUITE_AUTHORIZATION_URL", urls.authorizationUrl)
  next.set("NETSUITE_CLIENT_ID", answers.clientId)
  next.set("NETSUITE_CLIENT_SECRET", answers.clientSecret)
  next.set("NETSUITE_REDIRECT_URI", answers.redirectUri)
  next.set("NETSUITE_TOKEN_URL", urls.tokenUrl)
  next.set("PRODUCTION_WRITES_ENABLED", current.get("PRODUCTION_WRITES_ENABLED") || "false")
  next.set("AUDIT_LOG_PATH", current.get("AUDIT_LOG_PATH") || "./data/audit.ndjson")
  return next
}

function randomToken(): string {
  return `mcp_${randomUUID().replaceAll("-", "")}`
}

import { describe, expect, it } from "bun:test"
import { parseConfig } from "../src/config"

const validEnv = {
  MCP_SERVER_NAME: "NetSuite SuperMCP",
  MCP_SERVER_VERSION: "0.1.0",
  MCP_HOST: "127.0.0.1",
  MCP_PORT: "3025",
  MCP_BEARER_TOKEN: "test-token-12345",
  NETSUITE_ACCOUNT_ID: "1234567_SB1",
  NETSUITE_ENVIRONMENT: "sandbox",
  NETSUITE_BASE_URL: "https://1234567-sb1.suitetalk.api.netsuite.com",
  NETSUITE_RESTLET_URL: "https://1234567-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl",
  NETSUITE_OAUTH_FLOW: "client_credentials",
  NETSUITE_CONSUMER_KEY: "consumer-key",
  NETSUITE_CERTIFICATE_ID: "cert-id",
  NETSUITE_PRIVATE_KEY_PEM_BASE64: "cGVt",
  NETSUITE_TOKEN_URL:
    "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token",
  AUDIT_LOG_PATH: "./data/audit.ndjson",
} satisfies NodeJS.ProcessEnv

describe("parseConfig", () => {
  it("parses an explicit management identity without replacing the business identity", () => {
    const parsed = parseConfig({
      ...validEnv,
      NETSUITE_MANAGEMENT_ACCOUNT_ID: "7654321_SB1",
      NETSUITE_MANAGEMENT_ENVIRONMENT: "sandbox",
      NETSUITE_MANAGEMENT_BASE_URL: "https://7654321-sb1.suitetalk.api.netsuite.com",
      NETSUITE_MANAGEMENT_RESTLET_URL:
        "https://7654321-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl",
      NETSUITE_MANAGEMENT_TOKEN_URL:
        "https://7654321-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token",
      NETSUITE_MANAGEMENT_OAUTH_FLOW: "authorization_code",
      NETSUITE_MANAGEMENT_CLIENT_ID: "management-client",
      NETSUITE_MANAGEMENT_CLIENT_SECRET: "management-secret",
      NETSUITE_MANAGEMENT_REFRESH_TOKEN: "management-refresh",
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.netsuite.accountId).not.toBe(parsed.value.managementNetsuite?.accountId)
      expect(parsed.value.managementNetsuite?.accountId).toBe("7654321_SB1")
    }
  })

  it("parses a complete environment when all required values are present", () => {
    // Given
    const env = validEnv

    // When
    const result = parseConfig(env)

    // Then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.netsuite.environment).toBe("sandbox")
      expect(result.value.netsuite.accountId).toBe("1234567_SB1")
      expect(result.value.netsuite.oauthFlow).toBe("client_credentials")
      expect(result.value.cursorSecret).toBe("test-token-12345")
      expect(result.value.jobStorePath).toBe("./data/read-jobs.json")
      expect(result.value.exportDirectory).toBe("./data/exports")
      expect(result.value.integrationStorePath).toBe("./data/integrations.json")
      expect(result.value.customizationStorePath).toBe("./data/customization-deployments.json")
      expect(result.value.semanticStorePath).toBe("./data/semantic-definitions.json")
      expect(result.value.customizationProjectDirectory).toBe("./data/customization-projects")
    }
  })

  it("parses authorization-code OAuth config with a refresh token", () => {
    // Given
    const env = {
      ...validEnv,
      NETSUITE_OAUTH_FLOW: "authorization_code",
      NETSUITE_CLIENT_ID: "client-id",
      NETSUITE_CLIENT_SECRET: "client-secret",
      NETSUITE_REFRESH_TOKEN: "refresh-token",
      NETSUITE_AUTHORIZATION_URL:
        "https://1234567-sb1.app.netsuite.com/app/login/oauth2/authorize.nl",
      NETSUITE_REDIRECT_URI: "http://127.0.0.1:3025/oauth/callback",
      NETSUITE_CONSUMER_KEY: "",
      NETSUITE_CERTIFICATE_ID: "",
      NETSUITE_PRIVATE_KEY_PEM_BASE64: "",
    }

    // When
    const result = parseConfig(env)

    // Then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.netsuite.oauthFlow).toBe("authorization_code")
      expect(result.value.netsuite.refreshToken).toBe("refresh-token")
    }
  })

  it("returns a typed config error when required secrets are missing", () => {
    // Given
    const env = { ...validEnv, MCP_BEARER_TOKEN: "" }

    // When
    const result = parseConfig(env)

    // Then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.name).toBe("ConfigError")
    }
  })
})

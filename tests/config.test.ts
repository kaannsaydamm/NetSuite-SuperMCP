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
  NETSUITE_CONSUMER_KEY: "consumer-key",
  NETSUITE_CERTIFICATE_ID: "cert-id",
  NETSUITE_PRIVATE_KEY_PEM_BASE64: "cGVt",
  NETSUITE_TOKEN_URL:
    "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token",
  PRODUCTION_WRITES_ENABLED: "false",
  AUDIT_LOG_PATH: "./data/audit.ndjson",
} satisfies NodeJS.ProcessEnv

describe("parseConfig", () => {
  it("parses a complete environment when all required values are present", () => {
    // Given
    const env = validEnv

    // When
    const result = parseConfig(env)

    // Then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.netsuite.environment).toBe("sandbox")
      expect(result.value.productionWritesEnabled).toBe(false)
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

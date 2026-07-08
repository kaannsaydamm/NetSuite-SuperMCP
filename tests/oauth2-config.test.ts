import { describe, expect, it } from "bun:test"
import {
  buildOAuth2Env,
  deriveNetSuiteUrls,
  parseNetSuiteEnvironment,
} from "../scripts/oauth2-config"

describe("OAuth 2.0 setup config", () => {
  it("derives NetSuite OAuth, REST, and RESTlet URLs from the account ID", () => {
    const urls = deriveNetSuiteUrls("11675047")

    expect(urls.authorizationUrl).toBe(
      "https://11675047.app.netsuite.com/app/login/oauth2/authorize.nl",
    )
    expect(urls.baseUrl).toBe("https://11675047.suitetalk.api.netsuite.com")
    expect(urls.tokenUrl).toBe(
      "https://11675047.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token",
    )
    expect(urls.restletUrl).toContain("customscript_supermcp_action")
  })

  it("writes authorization-code OAuth config while preserving existing refresh tokens", () => {
    const current = new Map([
      ["NETSUITE_REFRESH_TOKEN", "refresh-token"],
      ["MCP_BEARER_TOKEN", "existing-bearer"],
    ])
    const env = buildOAuth2Env(current, {
      accountId: "11675047",
      environment: "production",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://127.0.0.1:3026/oauth/callback",
    })

    expect(env.get("NETSUITE_OAUTH_FLOW")).toBe("authorization_code")
    expect(env.get("NETSUITE_CLIENT_ID")).toBe("client-id")
    expect(env.get("NETSUITE_CLIENT_SECRET")).toBe("client-secret")
    expect(env.get("NETSUITE_REFRESH_TOKEN")).toBe("refresh-token")
    expect(env.get("MCP_BEARER_TOKEN")).toBe("existing-bearer")
  })

  it("rejects invalid NetSuite environment names", () => {
    expect(() => parseNetSuiteEnvironment("dev")).toThrow(
      "--environment must be production or sandbox",
    )
  })
})

import { describe, expect, it } from "bun:test"
import { createAuthorizationUrl } from "../scripts/oauth-login"
import { NetSuiteTokenProvider } from "../src/netsuite/oauth"
import { testConfig } from "./test-support"

describe("NetSuiteTokenProvider", () => {
  it("uses refresh-token grant for browser authorization-code OAuth", async () => {
    // Given
    const originalFetch = globalThis.fetch
    const bodies: URLSearchParams[] = []
    const mockFetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const request =
          input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
        bodies.push(new URLSearchParams(await request.text()))
        return Response.json({ access_token: "access-token", expires_in: 3600 })
      },
      { preconnect: originalFetch.preconnect },
    )
    globalThis.fetch = mockFetch

    try {
      const provider = new NetSuiteTokenProvider({
        ...testConfig().netsuite,
        oauthFlow: "authorization_code",
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        consumerKey: "",
        certificateId: "",
        privateKeyPemBase64: "",
      })

      // When
      const token = await provider.getAccessToken()

      // Then
      expect(token).toBe("access-token")
      expect(bodies).toHaveLength(1)
      expect(bodies[0]?.get("grant_type")).toBe("refresh_token")
      expect(bodies[0]?.get("client_id")).toBe("client-id")
      expect(bodies[0]?.get("client_secret")).toBe("client-secret")
      expect(bodies[0]?.get("refresh_token")).toBe("refresh-token")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("shares one token refresh across concurrent callers", async () => {
    // Given
    const originalFetch = globalThis.fetch
    const bodies: URLSearchParams[] = []
    const mockFetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const request =
          input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
        bodies.push(new URLSearchParams(await request.text()))
        await new Promise((resolve) => setTimeout(resolve, 20))
        return Response.json({ access_token: "access-token", expires_in: 3600 })
      },
      { preconnect: originalFetch.preconnect },
    )
    globalThis.fetch = mockFetch

    try {
      const provider = new NetSuiteTokenProvider({
        ...testConfig().netsuite,
        oauthFlow: "authorization_code",
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        consumerKey: "",
        certificateId: "",
        privateKeyPemBase64: "",
      })

      // When
      const tokens = await Promise.all([
        provider.getAccessToken(),
        provider.getAccessToken(),
        provider.getAccessToken(),
      ])

      // Then
      expect(tokens).toEqual(["access-token", "access-token", "access-token"])
      expect(bodies).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("createAuthorizationUrl", () => {
  it("adds NetSuite prompt login for account switching", () => {
    const url = new URL(
      createAuthorizationUrl({
        authorizationUrl: "https://11675047.app.netsuite.com/app/login/oauth2/authorize.nl",
        clientId: "client-id",
        prompt: "login consent",
        redirectUri: "https://127.0.0.1:3026/oauth/callback",
        state: "state-value",
      }),
    )

    expect(url.searchParams.get("prompt")).toBe("login consent")
    expect(url.searchParams.get("client_id")).toBe("client-id")
  })
})

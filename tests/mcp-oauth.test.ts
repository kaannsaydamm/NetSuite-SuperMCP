import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../src/app"
import { McpOAuthService, type NetSuiteAuthorizationExchange } from "../src/oauth/mcp-oauth-service"
import { FakeNetSuiteClient, testConfig } from "./test-support"

const publicUrl = "https://mcp.example.com"

describe("MCP OAuth 2.1 broker", () => {
  test("advertises protected-resource and authorization-server metadata", async () => {
    const service = await oauthService()
    const config = oauthConfig()
    const app = createApp(config, { mcpOAuthService: service })

    const protectedMetadata = await app.request("/.well-known/oauth-protected-resource/mcp")
    expect(protectedMetadata.status).toBe(200)
    expect(await protectedMetadata.json()).toEqual({
      resource: `${publicUrl}/mcp`,
      authorization_servers: [publicUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools"],
    })

    const serverMetadata = await app.request("/.well-known/oauth-authorization-server")
    expect(serverMetadata.status).toBe(200)
    expect(await serverMetadata.json()).toMatchObject({
      issuer: publicUrl,
      authorization_endpoint: `${publicUrl}/oauth/authorize`,
      token_endpoint: `${publicUrl}/oauth/token`,
      registration_endpoint: `${publicUrl}/oauth/register`,
      revocation_endpoint: `${publicUrl}/oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
    })
  })

  test("registers a public client and completes PKCE with rotating refresh tokens", async () => {
    const service = await oauthService()
    const client = await service.registerClient({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    })

    const verifier = "a".repeat(64)
    const challenge = await pkceChallenge(verifier)
    const clientRedirectUri = requiredValue(client.redirect_uris[0], "client redirect URI")
    const redirect = await service.beginAuthorization({
      clientId: client.client_id,
      redirectUri: clientRedirectUri,
      state: "claude-state",
      codeChallenge: challenge,
      resource: `${publicUrl}/mcp`,
    })
    const upstreamState = new URL(redirect).searchParams.get("state")
    expect(upstreamState).toBeString()

    const callback = await service.completeNetSuiteAuthorization({
      state: requiredValue(upstreamState, "upstream state"),
      code: "netsuite-code",
      company: "1234567",
      entity: "42",
      role: "101",
    })
    const authorizationCode = new URL(callback).searchParams.get("code")
    expect(new URL(callback).searchParams.get("state")).toBe("claude-state")
    expect(await readFile(service.store.path, "utf8")).not.toContain("netsuite-refresh")

    const tokens = await service.exchangeAuthorizationCode({
      clientId: client.client_id,
      code: requiredValue(authorizationCode, "authorization code"),
      codeVerifier: verifier,
      redirectUri: clientRedirectUri,
      resource: `${publicUrl}/mcp`,
    })
    expect(tokens.token_type).toBe("Bearer")
    expect((await service.verifyAccessToken(tokens.access_token)).subject).toBe("1234567:42:101")

    const rotated = await service.exchangeRefreshToken({
      clientId: client.client_id,
      refreshToken: tokens.refresh_token,
      resource: `${publicUrl}/mcp`,
    })
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token)
    await expect(
      service.exchangeRefreshToken({
        clientId: client.client_id,
        refreshToken: tokens.refresh_token,
        resource: `${publicUrl}/mcp`,
      }),
    ).rejects.toThrow("invalid_grant")

    await service.revokeToken(rotated.refresh_token)
    await expect(service.verifyAccessToken(rotated.access_token)).rejects.toThrow("invalid_token")
  })

  test("returns an RFC 9728 challenge for an unauthenticated MCP request", async () => {
    const service = await oauthService()
    const app = createApp(oauthConfig(), { mcpOAuthService: service })
    const response = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource/mcp"`,
    )
  })

  test("completes the Claude remote connector HTTP flow end to end", async () => {
    const service = await oauthService()
    const app = createApp(oauthConfig(), {
      mcpOAuthService: service,
      netsuite: new FakeNetSuiteClient(),
    })
    const registrationResponse = await app.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    })
    expect(registrationResponse.status).toBe(201)
    const registration = (await registrationResponse.json()) as { client_id: string }
    const verifier = "b".repeat(64)
    const authorizeUrl = new URL(`${publicUrl}/oauth/authorize`)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("client_id", registration.client_id)
    authorizeUrl.searchParams.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback")
    authorizeUrl.searchParams.set("state", "claude-state")
    authorizeUrl.searchParams.set("code_challenge", await pkceChallenge(verifier))
    authorizeUrl.searchParams.set("code_challenge_method", "S256")
    authorizeUrl.searchParams.set("resource", `${publicUrl}/mcp`)

    const authorizeResponse = await app.request(authorizeUrl.pathname + authorizeUrl.search)
    expect(authorizeResponse.status).toBe(302)
    const authorizeLocation = requiredValue(
      authorizeResponse.headers.get("location"),
      "authorize location",
    )
    const upstreamState = new URL(authorizeLocation).searchParams.get("state")
    const callbackResponse = await app.request(
      `/oauth/netsuite/callback?state=${upstreamState}&code=netsuite-code&company=1234567&entity=42&role=101`,
    )
    expect(callbackResponse.status).toBe(302)
    const callbackLocation = requiredValue(
      callbackResponse.headers.get("location"),
      "callback location",
    )
    const authorizationCode = new URL(callbackLocation).searchParams.get("code")
    const tokenResponse = await app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registration.client_id,
        code: requiredValue(authorizationCode, "authorization code"),
        code_verifier: verifier,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        resource: `${publicUrl}/mcp`,
      }),
    })
    expect(tokenResponse.status).toBe(200)
    const token = (await tokenResponse.json()) as { access_token: string }
    const initializeResponse = await app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Claude", version: "1" },
        },
      }),
    })
    expect(initializeResponse.status).toBe(200)
  })
})

function oauthConfig() {
  return testConfig({
    authMode: "oauth",
    publicUrl,
    oauthStorePath: "./data/test-mcp-oauth.json",
    oauthSecret: "test-oauth-secret-that-is-at-least-32-characters",
    netsuite: {
      ...testConfig().netsuite,
      oauthFlow: "authorization_code",
      clientId: "netsuite-client",
      clientSecret: "netsuite-secret",
      refreshToken: "bootstrap-refresh-token",
      authorizationUrl: "https://1234567.app.netsuite.com/app/login/oauth2/authorize.nl",
      redirectUri: `${publicUrl}/oauth/netsuite/callback`,
    },
  })
}

async function oauthService(): Promise<McpOAuthService> {
  const directory = await mkdtemp(join(tmpdir(), "supermcp-oauth-"))
  const upstream: NetSuiteAuthorizationExchange = {
    createAuthorizationUrl(input) {
      const url = new URL("https://1234567.app.netsuite.com/app/login/oauth2/authorize.nl")
      url.searchParams.set("state", input.state)
      url.searchParams.set("code_challenge", input.codeChallenge)
      return url.toString()
    },
    async exchangeCode() {
      return { refreshToken: "netsuite-refresh", accessToken: "netsuite-access", expiresIn: 3600 }
    },
  }
  return new McpOAuthService({
    publicUrl,
    storePath: join(directory, "oauth.json"),
    encryptionSecret: "test-oauth-secret-that-is-at-least-32-characters",
    accountId: "1234567",
    upstream,
  })
}

async function pkceChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier)
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("base64url")
}

function requiredValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) throw new Error(`${name} is missing`)
  return value
}

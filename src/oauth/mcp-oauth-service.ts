import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import {
  McpOAuthStore,
  type OAuthClient,
  type OAuthSession,
  type RefreshTokenRecord,
} from "./mcp-oauth-store"

const ClientRegistrationSchema = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string().url()).min(1).max(20),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).default(["code"]),
  token_endpoint_auth_method: z.literal("none").default("none"),
})

export type ClientRegistrationInput = z.input<typeof ClientRegistrationSchema>

export type NetSuiteAuthorizationExchange = {
  createAuthorizationUrl(input: { readonly state: string; readonly codeChallenge: string }): string
  exchangeCode(input: { readonly code: string; readonly codeVerifier: string }): Promise<{
    readonly accessToken: string
    readonly refreshToken: string
    readonly expiresIn: number
  }>
  revokeRefreshToken?(refreshToken: string): Promise<void>
}

export type McpOAuthTokens = {
  readonly access_token: string
  readonly token_type: "Bearer"
  readonly expires_in: number
  readonly refresh_token: string
  readonly scope: string
}

export type VerifiedMcpAccess = {
  readonly sessionId: string
  readonly clientId: string
  readonly subject: string
  readonly accountId: string
  readonly roleId?: string
  readonly entityId?: string
  readonly resource: string
  readonly scopes: readonly string[]
  readonly netSuiteRefreshToken: string
  readonly expiresAt: number
}

export class McpOAuthService {
  readonly publicUrl: string
  readonly resourceUrl: string
  readonly store: McpOAuthStore
  readonly #accountId: string
  readonly #upstream: NetSuiteAuthorizationExchange

  constructor(input: {
    readonly publicUrl: string
    readonly storePath: string
    readonly encryptionSecret: string
    readonly accountId: string
    readonly upstream: NetSuiteAuthorizationExchange
  }) {
    this.publicUrl = stripTrailingSlash(input.publicUrl)
    this.resourceUrl = `${this.publicUrl}/mcp`
    this.store = new McpOAuthStore(input.storePath, input.encryptionSecret)
    this.#accountId = input.accountId
    this.#upstream = input.upstream
  }

  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.resourceUrl,
      authorization_servers: [this.publicUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools"],
    }
  }

  authorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.publicUrl,
      authorization_endpoint: `${this.publicUrl}/oauth/authorize`,
      token_endpoint: `${this.publicUrl}/oauth/token`,
      registration_endpoint: `${this.publicUrl}/oauth/register`,
      revocation_endpoint: `${this.publicUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:tools"],
    }
  }

  async registerClient(input: ClientRegistrationInput): Promise<OAuthClient> {
    const parsed = ClientRegistrationSchema.parse(input)
    for (const redirectUri of parsed.redirect_uris) validateRedirectUri(redirectUri)
    const client: OAuthClient = {
      ...parsed,
      client_id: `smcp_${randomBytes(24).toString("base64url")}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    }
    await this.store.putClient(client)
    return client
  }

  async beginAuthorization(input: {
    readonly clientId: string
    readonly redirectUri: string
    readonly state?: string
    readonly codeChallenge: string
    readonly resource?: string
  }): Promise<string> {
    const client = await this.requireClient(input.clientId)
    requireRedirectUri(client, input.redirectUri)
    if (!isPkceChallenge(input.codeChallenge))
      throw oauthError("invalid_request", "PKCE S256 is required")
    const resource = input.resource ?? this.resourceUrl
    requireResource(resource, this.resourceUrl)
    const upstreamState = randomBytes(32).toString("base64url")
    const upstreamVerifier = randomBytes(48).toString("base64url")
    await this.store.putPending(upstreamState, {
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      ...(input.state === undefined ? {} : { clientState: input.state }),
      codeChallenge: input.codeChallenge,
      resource,
      encryptedUpstreamVerifier: this.store.encrypt(upstreamVerifier),
      expiresAt: nowSeconds() + 600,
    })
    return this.#upstream.createAuthorizationUrl({
      state: upstreamState,
      codeChallenge: sha256Base64Url(upstreamVerifier),
    })
  }

  async completeNetSuiteAuthorization(input: {
    readonly state: string
    readonly code: string
    readonly company?: string
    readonly entity?: string
    readonly role?: string
  }): Promise<string> {
    const pending = await this.store.consumePending(input.state)
    if (pending === undefined || pending.expiresAt <= nowSeconds()) {
      throw oauthError("invalid_request", "OAuth state is invalid or expired")
    }
    const upstreamVerifier = this.store.decrypt(pending.encryptedUpstreamVerifier)
    const upstreamToken = await this.#upstream.exchangeCode({
      code: input.code,
      codeVerifier: upstreamVerifier,
    })
    const accountId = input.company ?? this.#accountId
    if (normalizeAccountId(accountId) !== normalizeAccountId(this.#accountId)) {
      throw oauthError("access_denied", "NetSuite callback account does not match this MCP server")
    }
    const entityId = nonEmpty(input.entity)
    const roleId = nonEmpty(input.role)
    const subject = [accountId, entityId ?? "user", roleId ?? "role"].join(":")
    const sessionId = randomBytes(24).toString("base64url")
    await this.store.putSession({
      id: sessionId,
      subject,
      accountId,
      ...(roleId === undefined ? {} : { roleId }),
      ...(entityId === undefined ? {} : { entityId }),
      encryptedNetSuiteRefreshToken: this.store.encrypt(upstreamToken.refreshToken),
      createdAt: nowSeconds(),
    })
    const authorizationCode = randomBytes(32).toString("base64url")
    await this.store.putAuthorizationCode(authorizationCode, {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      resource: pending.resource,
      sessionId,
      expiresAt: nowSeconds() + 300,
    })
    const redirect = new URL(pending.redirectUri)
    redirect.searchParams.set("code", authorizationCode)
    if (pending.clientState !== undefined) redirect.searchParams.set("state", pending.clientState)
    return redirect.toString()
  }

  async exchangeAuthorizationCode(input: {
    readonly clientId: string
    readonly code: string
    readonly codeVerifier: string
    readonly redirectUri: string
    readonly resource?: string
  }): Promise<McpOAuthTokens> {
    await this.requireClient(input.clientId)
    const authorization = await this.store.consumeAuthorizationCode(input.code)
    if (authorization === undefined || authorization.expiresAt <= nowSeconds()) {
      throw oauthError("invalid_grant", "Authorization code is invalid or expired")
    }
    if (
      authorization.clientId !== input.clientId ||
      authorization.redirectUri !== input.redirectUri ||
      !timingSafeEqualText(authorization.codeChallenge, sha256Base64Url(input.codeVerifier))
    ) {
      throw oauthError("invalid_grant", "Authorization code validation failed")
    }
    requireResource(input.resource ?? authorization.resource, authorization.resource)
    return await this.issueTokens({
      clientId: input.clientId,
      resource: authorization.resource,
      scopes: ["mcp:tools"],
      sessionId: authorization.sessionId,
    })
  }

  async exchangeRefreshToken(input: {
    readonly clientId: string
    readonly refreshToken: string
    readonly resource?: string
  }): Promise<McpOAuthTokens> {
    await this.requireClient(input.clientId)
    const refresh = await this.store.consumeRefreshToken(input.refreshToken)
    if (
      refresh === undefined ||
      refresh.expiresAt <= nowSeconds() ||
      refresh.clientId !== input.clientId
    ) {
      throw oauthError("invalid_grant", "Refresh token is invalid or expired")
    }
    requireResource(input.resource ?? refresh.resource, refresh.resource)
    return await this.issueTokens(refresh)
  }

  async verifyAccessToken(token: string): Promise<VerifiedMcpAccess> {
    const access = await this.store.getAccessToken(token)
    if (access === undefined || access.expiresAt <= nowSeconds()) {
      throw oauthError("invalid_token", "Access token is invalid or expired")
    }
    const session = await this.requireSession(access.sessionId)
    return {
      sessionId: access.sessionId,
      clientId: access.clientId,
      subject: session.subject,
      accountId: session.accountId,
      ...(session.roleId === undefined ? {} : { roleId: session.roleId }),
      ...(session.entityId === undefined ? {} : { entityId: session.entityId }),
      resource: access.resource,
      scopes: access.scopes,
      netSuiteRefreshToken: this.store.decrypt(session.encryptedNetSuiteRefreshToken),
      expiresAt: access.expiresAt,
    }
  }

  async updateNetSuiteRefreshToken(sessionId: string, refreshToken: string): Promise<void> {
    await this.store.updateSessionRefreshToken(sessionId, this.store.encrypt(refreshToken))
  }

  async revokeToken(token: string): Promise<void> {
    const session = await this.store.revokeToken(token)
    if (session !== undefined && this.#upstream.revokeRefreshToken !== undefined) {
      await this.#upstream.revokeRefreshToken(
        this.store.decrypt(session.encryptedNetSuiteRefreshToken),
      )
    }
  }

  private async issueTokens(
    input: Pick<RefreshTokenRecord, "clientId" | "resource" | "scopes" | "sessionId">,
  ): Promise<McpOAuthTokens> {
    await this.requireSession(input.sessionId)
    const accessToken = `smcp_at_${randomBytes(32).toString("base64url")}`
    const refreshToken = `smcp_rt_${randomBytes(40).toString("base64url")}`
    const accessExpiresAt = nowSeconds() + 3600
    await this.store.putAccessToken(accessToken, {
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      sessionId: input.sessionId,
      expiresAt: accessExpiresAt,
    })
    await this.store.putRefreshToken(refreshToken, {
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      sessionId: input.sessionId,
      expiresAt: nowSeconds() + 30 * 24 * 60 * 60,
    })
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: input.scopes.join(" "),
    }
  }

  private async requireClient(clientId: string): Promise<OAuthClient> {
    const client = await this.store.getClient(clientId)
    if (client === undefined) throw oauthError("invalid_client", "Unknown OAuth client")
    return client
  }

  private async requireSession(sessionId: string): Promise<OAuthSession> {
    const session = await this.store.getSession(sessionId)
    if (session === undefined) throw oauthError("invalid_grant", "OAuth session is unavailable")
    return session
  }
}

export class McpOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`)
  }
}

function oauthError(code: string, message: string): McpOAuthError {
  return new McpOAuthError(code, message)
}

function requireRedirectUri(client: OAuthClient, redirectUri: string): void {
  if (!client.redirect_uris.includes(redirectUri)) {
    throw oauthError("invalid_request", "redirect_uri is not registered")
  }
}

function validateRedirectUri(value: string): void {
  const url = new URL(value)
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw oauthError("invalid_client_metadata", "redirect_uris must use HTTPS or loopback HTTP")
  }
  if (url.hash.length > 0)
    throw oauthError("invalid_client_metadata", "redirect_uris cannot contain fragments")
}

function requireResource(actual: string, expected: string): void {
  if (stripTrailingSlash(actual) !== stripTrailingSlash(expected)) {
    throw oauthError("invalid_target", "OAuth resource does not match the MCP endpoint")
  }
}

function isPkceChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value)
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
}

function timingSafeEqualText(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value
}

function normalizeAccountId(value: string): string {
  return value.toUpperCase().replace(/-/g, "_")
}

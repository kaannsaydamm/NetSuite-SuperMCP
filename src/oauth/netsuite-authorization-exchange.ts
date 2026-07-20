import ky, { HTTPError } from "ky"
import { z } from "zod"
import type { AppConfig } from "../config"
import { McpOAuthError, type NetSuiteAuthorizationExchange } from "./mcp-oauth-service"

const NetSuiteTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
})

export class NetSuiteAuthorizationCodeExchange implements NetSuiteAuthorizationExchange {
  constructor(readonly config: AppConfig["netsuite"]) {}

  createAuthorizationUrl(input: {
    readonly state: string
    readonly codeChallenge: string
  }): string {
    const authorizationUrl = required(this.config.authorizationUrl, "NETSUITE_AUTHORIZATION_URL")
    const url = new URL(authorizationUrl)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", required(this.config.clientId, "NETSUITE_CLIENT_ID"))
    url.searchParams.set("redirect_uri", required(this.config.redirectUri, "NETSUITE_REDIRECT_URI"))
    url.searchParams.set("scope", "restlets rest_webservices")
    url.searchParams.set("state", input.state)
    url.searchParams.set("code_challenge", input.codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("prompt", "login")
    return url.toString()
  }

  async exchangeCode(input: {
    readonly code: string
    readonly codeVerifier: string
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    try {
      const parsed = NetSuiteTokenSchema.parse(
        await ky
          .post(this.config.tokenUrl, {
            timeout: 30_000,
            retry: 0,
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code: input.code,
              redirect_uri: required(this.config.redirectUri, "NETSUITE_REDIRECT_URI"),
              client_id: required(this.config.clientId, "NETSUITE_CLIENT_ID"),
              client_secret: required(this.config.clientSecret, "NETSUITE_CLIENT_SECRET"),
              code_verifier: input.codeVerifier,
            }),
          })
          .json(),
      )
      return {
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token,
        expiresIn: parsed.expires_in,
      }
    } catch (error) {
      if (error instanceof HTTPError) {
        throw new McpOAuthError(
          "server_error",
          `NetSuite token exchange failed with HTTP ${error.response.status}`,
        )
      }
      throw error
    }
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const revokeUrl = this.config.tokenUrl.replace(/\/token(?:\?.*)?$/, "/revoke")
    try {
      await ky.post(revokeUrl, {
        timeout: 30_000,
        retry: 0,
        headers: {
          authorization: `Basic ${Buffer.from(
            `${required(this.config.clientId, "NETSUITE_CLIENT_ID")}:${required(
              this.config.clientSecret,
              "NETSUITE_CLIENT_SECRET",
            )}`,
          ).toString("base64")}`,
        },
        body: new URLSearchParams({ token: refreshToken }),
      })
    } catch (error) {
      if (error instanceof HTTPError) {
        throw new McpOAuthError(
          "server_error",
          `NetSuite token revocation failed with HTTP ${error.response.status}`,
        )
      }
      throw error
    }
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new McpOAuthError("server_error", `${name} is not configured`)
  }
  return value
}

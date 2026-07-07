import { constants, createPrivateKey, sign } from "node:crypto"
import ky, { HTTPError } from "ky"
import { z } from "zod"
import type { AppConfig } from "../config"
import { NetSuiteNotConfiguredError, NetSuiteRequestError } from "../shared/errors"

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
})

type CachedToken = {
  readonly accessToken: string
  readonly expiresAtMs: number
}

export class NetSuiteTokenProvider {
  #cachedToken: CachedToken | null = null

  constructor(readonly config: AppConfig["netsuite"]) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.#cachedToken !== null && this.#cachedToken.expiresAtMs > now + 60_000) {
      return this.#cachedToken.accessToken
    }

    try {
      const body =
        this.config.oauthFlow === "authorization_code"
          ? this.createRefreshTokenRequest()
          : this.createClientCredentialsRequest(now)
      const parsed = TokenResponseSchema.parse(
        await ky
          .post(this.config.tokenUrl, {
            timeout: 30_000,
            retry: { limit: 1, methods: ["post"], statusCodes: [408, 429, 500, 502, 503, 504] },
            body,
          })
          .json(),
      )
      this.#cachedToken = {
        accessToken: parsed.access_token,
        expiresAtMs: now + parsed.expires_in * 1000,
      }
      return parsed.access_token
    } catch (error) {
      if (error instanceof HTTPError) {
        throw new NetSuiteRequestError(error.response.status, await error.response.text())
      }
      if (error instanceof Error) {
        throw new NetSuiteNotConfiguredError([error.message])
      }
      throw error
    }
  }

  private createClientCredentialsRequest(nowMs: number): URLSearchParams {
    const assertion = this.createClientAssertion(nowMs)
    return new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    })
  }

  private createRefreshTokenRequest(): URLSearchParams {
    return new URLSearchParams({
      grant_type: "refresh_token",
      client_id: required(this.config.clientId, "NETSUITE_CLIENT_ID"),
      client_secret: required(this.config.clientSecret, "NETSUITE_CLIENT_SECRET"),
      refresh_token: required(this.config.refreshToken, "NETSUITE_REFRESH_TOKEN"),
    })
  }

  private createClientAssertion(nowMs: number): string {
    const privateKeyPem = Buffer.from(
      required(this.config.privateKeyPemBase64, "NETSUITE_PRIVATE_KEY_PEM_BASE64"),
      "base64",
    ).toString("utf8")
    const key = createPrivateKey(privateKeyPem)
    const nowSeconds = Math.floor(nowMs / 1000)
    const header = base64UrlJson({
      alg: "PS256",
      typ: "JWT",
      kid: required(this.config.certificateId, "NETSUITE_CERTIFICATE_ID"),
    })
    const payload = base64UrlJson({
      iss: required(this.config.consumerKey, "NETSUITE_CONSUMER_KEY"),
      scope: ["restlets", "rest_webservices"].join(" "),
      aud: this.config.tokenUrl,
      exp: nowSeconds + 300,
      iat: nowSeconds,
    })
    const body = `${header}.${payload}`
    const signature = sign("RSA-SHA256", Buffer.from(body), {
      key,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }).toString("base64url")
    return `${body}.${signature}`
  }
}

function base64UrlJson(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new NetSuiteNotConfiguredError([`${name} is required`])
  }
  return value
}

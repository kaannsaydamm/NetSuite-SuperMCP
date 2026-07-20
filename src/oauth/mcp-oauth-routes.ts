import type { Hono } from "hono"
import { z } from "zod"
import { McpOAuthError, type McpOAuthService } from "./mcp-oauth-service"

const RegisterBodySchema = z.object({
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
  response_types: z.array(z.literal("code")).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
})

export function mountMcpOAuthRoutes(app: Hono, service: McpOAuthService): void {
  app.get("/.well-known/oauth-protected-resource", (context) =>
    context.json(service.protectedResourceMetadata()),
  )
  app.get("/.well-known/oauth-protected-resource/mcp", (context) =>
    context.json(service.protectedResourceMetadata()),
  )
  app.get("/.well-known/oauth-authorization-server", (context) =>
    context.json(service.authorizationServerMetadata()),
  )

  app.post("/oauth/register", async (context) => {
    try {
      const body = RegisterBodySchema.parse(await context.req.json())
      const client = await service.registerClient({
        client_name: body.client_name,
        redirect_uris: body.redirect_uris,
        ...(body.grant_types === undefined ? {} : { grant_types: body.grant_types }),
        ...(body.response_types === undefined ? {} : { response_types: body.response_types }),
        ...(body.token_endpoint_auth_method === undefined
          ? {}
          : { token_endpoint_auth_method: body.token_endpoint_auth_method }),
      })
      return context.json(client, 201, noStoreHeaders())
    } catch (error) {
      return oauthErrorResponse(context, error, 400)
    }
  })

  app.get("/oauth/authorize", async (context) => {
    const query = context.req.query()
    try {
      if (query["response_type"] !== "code") {
        throw new McpOAuthError("unsupported_response_type", "Only response_type=code is supported")
      }
      if (query["code_challenge_method"] !== "S256") {
        throw new McpOAuthError("invalid_request", "PKCE code_challenge_method must be S256")
      }
      const redirect = await service.beginAuthorization({
        clientId: requiredQuery(query, "client_id"),
        redirectUri: requiredQuery(query, "redirect_uri"),
        ...(query["state"] === undefined ? {} : { state: query["state"] }),
        codeChallenge: requiredQuery(query, "code_challenge"),
        ...(query["resource"] === undefined ? {} : { resource: query["resource"] }),
      })
      return context.redirect(redirect, 302)
    } catch (error) {
      return oauthErrorResponse(context, error, 400)
    }
  })

  app.get("/oauth/netsuite/callback", async (context) => {
    const query = context.req.query()
    try {
      if (query["error"] !== undefined) {
        throw new McpOAuthError("access_denied", "NetSuite authorization was denied")
      }
      const redirect = await service.completeNetSuiteAuthorization({
        state: requiredQuery(query, "state"),
        code: requiredQuery(query, "code"),
        ...(query["company"] === undefined ? {} : { company: query["company"] }),
        ...(query["entity"] === undefined ? {} : { entity: query["entity"] }),
        ...(query["role"] === undefined ? {} : { role: query["role"] }),
      })
      return context.redirect(redirect, 302)
    } catch (error) {
      return oauthErrorResponse(context, error, 400)
    }
  })

  app.post("/oauth/token", async (context) => {
    try {
      const form = await context.req.formData()
      const grantType = formValue(form, "grant_type")
      const clientId = formValue(form, "client_id")
      const resource = optionalFormValue(form, "resource")
      if (grantType === "authorization_code") {
        const tokens = await service.exchangeAuthorizationCode({
          clientId,
          code: formValue(form, "code"),
          codeVerifier: formValue(form, "code_verifier"),
          redirectUri: formValue(form, "redirect_uri"),
          ...(resource === undefined ? {} : { resource }),
        })
        return context.json(tokens, 200, noStoreHeaders())
      }
      if (grantType === "refresh_token") {
        const tokens = await service.exchangeRefreshToken({
          clientId,
          refreshToken: formValue(form, "refresh_token"),
          ...(resource === undefined ? {} : { resource }),
        })
        return context.json(tokens, 200, noStoreHeaders())
      }
      throw new McpOAuthError("unsupported_grant_type", "Unsupported OAuth grant_type")
    } catch (error) {
      return oauthErrorResponse(context, error, 400)
    }
  })

  app.post("/oauth/revoke", async (context) => {
    try {
      const form = await context.req.formData()
      await service.revokeToken(formValue(form, "token"))
      return context.body(null, 200, noStoreHeaders())
    } catch (error) {
      return oauthErrorResponse(context, error, 400)
    }
  })
}

function requiredQuery(query: Record<string, string>, key: string): string {
  const value = query[key]
  if (value === undefined || value.length === 0) {
    throw new McpOAuthError("invalid_request", `${key} is required`)
  }
  return value
}

function formValue(form: FormData, key: string): string {
  const value = form.get(key)
  if (typeof value !== "string" || value.length === 0) {
    throw new McpOAuthError("invalid_request", `${key} is required`)
  }
  return value
}

function optionalFormValue(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store", pragma: "no-cache" }
}

function oauthErrorResponse(
  context: { json: (body: unknown, status: 400, headers?: Record<string, string>) => Response },
  error: unknown,
  status: 400,
): Response {
  const oauthError =
    error instanceof McpOAuthError
      ? error
      : new McpOAuthError(
          "invalid_request",
          error instanceof Error ? error.message : "OAuth request failed",
        )
  return context.json(
    { error: oauthError.code, error_description: oauthError.message.replace(/^\w+:\s*/, "") },
    status,
    noStoreHeaders(),
  )
}

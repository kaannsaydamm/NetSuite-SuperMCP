import { z } from "zod"

const AuthorizationHeaderSchema = z.string().regex(/^Bearer .+$/)

export type RequestIdentity = {
  readonly requester: string
  readonly client: string
}

export function isAuthorized(authorization: string | null, expectedToken: string): boolean {
  const parsed = AuthorizationHeaderSchema.safeParse(authorization)
  if (!parsed.success) {
    return false
  }

  return parsed.data.slice("Bearer ".length) === expectedToken
}

export function identityFromHeaders(headers: Headers): RequestIdentity {
  return {
    requester: headers.get("x-supermcp-user") ?? "oauth-account-user",
    client: headers.get("x-supermcp-client") ?? "mcp-http",
  }
}

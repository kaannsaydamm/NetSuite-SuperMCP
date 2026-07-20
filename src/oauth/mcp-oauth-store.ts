import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"

const ClientSchema = z.object({
  client_id: z.string(),
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.literal("none"),
  client_id_issued_at: z.number().int(),
})

const PendingSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  clientState: z.string().optional(),
  codeChallenge: z.string(),
  resource: z.string(),
  encryptedUpstreamVerifier: z.string(),
  expiresAt: z.number().int(),
})

const SessionSchema = z.object({
  id: z.string(),
  subject: z.string(),
  accountId: z.string(),
  roleId: z.string().optional(),
  entityId: z.string().optional(),
  encryptedNetSuiteRefreshToken: z.string(),
  createdAt: z.number().int(),
})

const AuthorizationCodeSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  resource: z.string(),
  sessionId: z.string(),
  expiresAt: z.number().int(),
})

const AccessTokenSchema = z.object({
  clientId: z.string(),
  resource: z.string(),
  scopes: z.array(z.string()),
  sessionId: z.string(),
  expiresAt: z.number().int(),
})

const RefreshTokenSchema = z.object({
  clientId: z.string(),
  resource: z.string(),
  scopes: z.array(z.string()),
  sessionId: z.string(),
  expiresAt: z.number().int(),
})

const StoreSchema = z.object({
  clients: z.record(z.string(), ClientSchema),
  pending: z.record(z.string(), PendingSchema),
  sessions: z.record(z.string(), SessionSchema),
  authorizationCodes: z.record(z.string(), AuthorizationCodeSchema),
  accessTokens: z.record(z.string(), AccessTokenSchema),
  refreshTokens: z.record(z.string(), RefreshTokenSchema),
})

type StoreData = z.infer<typeof StoreSchema>
export type OAuthClient = z.infer<typeof ClientSchema>
export type PendingAuthorization = z.infer<typeof PendingSchema>
export type OAuthSession = z.infer<typeof SessionSchema>
export type AuthorizationCode = z.infer<typeof AuthorizationCodeSchema>
export type AccessTokenRecord = z.infer<typeof AccessTokenSchema>
export type RefreshTokenRecord = z.infer<typeof RefreshTokenSchema>

const emptyStore = (): StoreData => ({
  clients: {},
  pending: {},
  sessions: {},
  authorizationCodes: {},
  accessTokens: {},
  refreshTokens: {},
})

export class McpOAuthStore {
  readonly #key: Buffer
  #lock: Promise<void> = Promise.resolve()

  constructor(
    readonly path: string,
    encryptionSecret: string,
  ) {
    this.#key = createHash("sha256").update(encryptionSecret).digest()
  }

  encrypt(value: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv)
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".")
  }

  decrypt(value: string): string {
    const [version, ivValue, tagValue, ciphertextValue] = value.split(".")
    if (
      version !== "v1" ||
      ivValue === undefined ||
      tagValue === undefined ||
      ciphertextValue === undefined
    ) {
      throw new Error("Invalid encrypted OAuth value")
    }
    const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(ivValue, "base64url"))
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  }

  async putClient(client: OAuthClient): Promise<void> {
    await this.mutate((data) => {
      data.clients[client.client_id] = client
    })
  }

  async getClient(clientId: string): Promise<OAuthClient | undefined> {
    return await this.inspect((data) => data.clients[clientId])
  }

  async putPending(state: string, pending: PendingAuthorization): Promise<void> {
    await this.mutate((data) => {
      data.pending[hash(state)] = pending
    })
  }

  async consumePending(state: string): Promise<PendingAuthorization | undefined> {
    return await this.mutate((data) => {
      const key = hash(state)
      const pending = data.pending[key]
      delete data.pending[key]
      return pending
    })
  }

  async putSession(session: OAuthSession): Promise<void> {
    await this.mutate((data) => {
      data.sessions[session.id] = session
    })
  }

  async getSession(sessionId: string): Promise<OAuthSession | undefined> {
    return await this.inspect((data) => data.sessions[sessionId])
  }

  async updateSessionRefreshToken(sessionId: string, encryptedRefreshToken: string): Promise<void> {
    await this.mutate((data) => {
      const session = data.sessions[sessionId]
      if (session === undefined) throw new Error("OAuth session is unavailable")
      data.sessions[sessionId] = {
        ...session,
        encryptedNetSuiteRefreshToken: encryptedRefreshToken,
      }
    })
  }

  async putAuthorizationCode(code: string, value: AuthorizationCode): Promise<void> {
    await this.mutate((data) => {
      data.authorizationCodes[hash(code)] = value
    })
  }

  async consumeAuthorizationCode(code: string): Promise<AuthorizationCode | undefined> {
    return await this.mutate((data) => {
      const key = hash(code)
      const authorizationCode = data.authorizationCodes[key]
      delete data.authorizationCodes[key]
      return authorizationCode
    })
  }

  async putAccessToken(token: string, value: AccessTokenRecord): Promise<void> {
    await this.mutate((data) => {
      data.accessTokens[hash(token)] = value
    })
  }

  async getAccessToken(token: string): Promise<AccessTokenRecord | undefined> {
    return await this.inspect((data) => data.accessTokens[hash(token)])
  }

  async putRefreshToken(token: string, value: RefreshTokenRecord): Promise<void> {
    await this.mutate((data) => {
      data.refreshTokens[hash(token)] = value
    })
  }

  async consumeRefreshToken(token: string): Promise<RefreshTokenRecord | undefined> {
    return await this.mutate((data) => {
      const key = hash(token)
      const refreshToken = data.refreshTokens[key]
      delete data.refreshTokens[key]
      return refreshToken
    })
  }

  async revokeToken(token: string): Promise<OAuthSession | undefined> {
    return await this.mutate((data) => {
      const key = hash(token)
      const sessionId = data.accessTokens[key]?.sessionId ?? data.refreshTokens[key]?.sessionId
      delete data.accessTokens[key]
      delete data.refreshTokens[key]
      if (sessionId === undefined) return undefined
      for (const [accessKey, access] of Object.entries(data.accessTokens)) {
        if (access.sessionId === sessionId) delete data.accessTokens[accessKey]
      }
      for (const [refreshKey, refresh] of Object.entries(data.refreshTokens)) {
        if (refresh.sessionId === sessionId) delete data.refreshTokens[refreshKey]
      }
      const session = data.sessions[sessionId]
      delete data.sessions[sessionId]
      return session
    })
  }

  private async inspect<T>(reader: (data: StoreData) => T): Promise<T> {
    return await this.synchronized(async () => reader(await this.read()))
  }

  private async mutate<T>(mutator: (data: StoreData) => T): Promise<T> {
    return await this.synchronized(async () => {
      const data = await this.read()
      purgeExpired(data, Math.floor(Date.now() / 1000))
      const result = mutator(data)
      await this.write(data)
      return result
    })
  }

  private async synchronized<T>(operation: () => Promise<T>): Promise<T> {
    let release = (): void => undefined
    const previous = this.#lock
    this.#lock = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async read(): Promise<StoreData> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")))
    } catch (error) {
      if (isMissingFile(error)) return emptyStore()
      throw error
    }
  }

  private async write(data: StoreData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.path)
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
}

function purgeExpired(data: StoreData, now: number): void {
  for (const [key, value] of Object.entries(data.pending)) {
    if (value.expiresAt <= now) delete data.pending[key]
  }
  for (const [key, value] of Object.entries(data.authorizationCodes)) {
    if (value.expiresAt <= now) delete data.authorizationCodes[key]
  }
  for (const [key, value] of Object.entries(data.accessTokens)) {
    if (value.expiresAt <= now) delete data.accessTokens[key]
  }
  for (const [key, value] of Object.entries(data.refreshTokens)) {
    if (value.expiresAt <= now) delete data.refreshTokens[key]
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

import { randomBytes } from "node:crypto"
import { copyFile, readFile, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import jsrsasign from "jsrsasign"
import ky, { HTTPError } from "ky"
import { z } from "zod"
import { openBrowser } from "./browser-open"

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
})

const { KEYUTIL, KJUR } = jsrsasign

type CertificatePem = {
  readonly cert: string
  readonly key: string
}

const packageRoot = join(import.meta.dir, "..")
const workspaceRoot = process.cwd()
const envPath = join(workspaceRoot, ".env")

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : "NetSuite OAuth login failed")
    process.exit(1)
  })
}

async function main(): Promise<void> {
  await ensureEnvFile(envPath)
  const env = await readEnv(envPath)

  const authorizationUrl = requiredEnv(env, "NETSUITE_AUTHORIZATION_URL")
  const tokenUrl = requiredEnv(env, "NETSUITE_TOKEN_URL")
  const clientId = requiredEnv(env, "NETSUITE_CLIENT_ID")
  const clientSecret = requiredEnv(env, "NETSUITE_CLIENT_SECRET")
  const redirectUri = requiredEnv(env, "NETSUITE_REDIRECT_URI")
  const state = randomBytes(24).toString("base64url")
  const prompt = argValue("--prompt")
  const authUrl = createAuthorizationUrl({ authorizationUrl, clientId, redirectUri, state, prompt })

  if (new URL(redirectUri).protocol === "https:") {
    console.log(
      "Starting local HTTPS OAuth callback listener with an ephemeral self-signed certificate.",
    )
  }
  console.log(`Opening NetSuite OAuth consent page: ${authUrl}`)
  await openBrowser(authUrl)
  console.log(`Waiting for NetSuite callback on ${redirectUri}. Keep this terminal open.`)
  if (process.stdin.isTTY) {
    console.log(
      "If Chrome cannot reach the local callback, copy the full 127.0.0.1 callback URL and paste it here.",
    )
  }

  const code = await waitForAuthorizationCode(redirectUri, state)
  const token = await exchangeCode({ tokenUrl, clientId, clientSecret, redirectUri, code })

  env.set("NETSUITE_OAUTH_FLOW", "authorization_code")
  env.set("NETSUITE_REFRESH_TOKEN", token.refresh_token)
  await writeEnv(envPath, env)

  console.log("NetSuite OAuth login complete. Refresh token was saved to .env.")
}

export function createAuthorizationUrl(input: {
  readonly authorizationUrl: string
  readonly clientId: string
  readonly prompt?: string | undefined
  readonly redirectUri: string
  readonly state: string
}): string {
  const url = new URL(input.authorizationUrl)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("scope", "restlets,rest_webservices")
  url.searchParams.set("state", input.state)
  if (input.prompt !== undefined && input.prompt.length > 0) {
    url.searchParams.set("prompt", input.prompt)
  }
  return url.toString()
}

async function waitForAuthorizationCode(
  redirectUri: string,
  expectedState: string,
): Promise<string> {
  const url = new URL(redirectUri)
  const port = Number(url.port || (url.protocol === "https:" ? "443" : "80"))
  const path = url.pathname

  let closeServer: (() => void) | undefined
  const serverCode = new Promise<string>((resolve, reject) => {
    const handleCallback = (request: IncomingMessage, response: ServerResponse): void => {
      try {
        const callbackUrl = new URL(request.url ?? "/", redirectUri)
        if (callbackUrl.pathname !== path) {
          response.writeHead(404).end("Not found")
          return
        }
        const code = parseAuthorizationCallback(callbackUrl.toString(), redirectUri, expectedState)
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        response.end("NetSuite SuperMCP OAuth login complete. You can close this tab.")
        server.close()
        resolve(code)
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" })
        response.end(error instanceof Error ? error.message : "OAuth callback failed")
        server.close()
        reject(error)
      }
    }
    const server =
      url.protocol === "https:"
        ? createHttpsServer(createLocalhostCertificate(), handleCallback)
        : createHttpServer(handleCallback)

    server.once("error", reject)
    closeServer = () => server.close()
    server.listen(port, url.hostname)
  })

  try {
    return await Promise.race([serverCode, waitForPastedCallback(redirectUri, expectedState)])
  } finally {
    closeServer?.()
  }
}

async function waitForPastedCallback(redirectUri: string, expectedState: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return await new Promise(() => undefined)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (
      await rl.question("Callback URL paste, or leave blank while waiting for automatic callback: ")
    ).trim()
    if (answer.length === 0) {
      return await new Promise(() => undefined)
    }
    return parseAuthorizationCallback(answer, redirectUri, expectedState)
  } finally {
    rl.close()
  }
}

export function parseAuthorizationCallback(
  callbackUrl: string,
  redirectUri: string,
  expectedState: string,
): string {
  const expectedUrl = new URL(redirectUri)
  const url = new URL(callbackUrl, redirectUri)
  if (url.pathname !== expectedUrl.pathname) {
    throw new Error("OAuth callback URL path did not match the configured redirect URI")
  }
  const state = url.searchParams.get("state")
  const code = url.searchParams.get("code")
  const error = url.searchParams.get("error")
  if (error !== null) {
    throw new Error(`NetSuite authorization failed: ${error}`)
  }
  if (state !== expectedState) {
    throw new Error("OAuth state mismatch")
  }
  if (code === null || code.length === 0) {
    throw new Error("OAuth callback did not include a code")
  }
  return code
}

async function exchangeCode(input: {
  readonly tokenUrl: string
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly code: string
}): Promise<z.infer<typeof TokenResponseSchema>> {
  try {
    return TokenResponseSchema.parse(
      await ky
        .post(input.tokenUrl, {
          timeout: 30_000,
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: input.code,
            redirect_uri: input.redirectUri,
            client_id: input.clientId,
            client_secret: input.clientSecret,
          }),
        })
        .json(),
    )
  } catch (error) {
    if (error instanceof HTTPError) {
      throw new Error(
        `NetSuite token exchange failed: ${error.response.status} ${await error.response.text()}`,
      )
    }
    throw error
  }
}

function createLocalhostCertificate(): CertificatePem {
  const keyPair = KEYUTIL.generateKeypair("RSA", 2048)
  const privateKey = keyPair.prvKeyObj
  const now = new Date()
  const notBefore = toUtcTime(new Date(now.getTime() - 60_000))
  const notAfter = toUtcTime(new Date(now.getTime() + 60 * 60 * 1000))
  const certificate = new KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { hex: randomBytes(16).toString("hex") },
    sigalg: "SHA256withRSA",
    issuer: { str: "/CN=NetSuite SuperMCP Local OAuth" },
    notbefore: notBefore,
    notafter: notAfter,
    subject: { str: "/CN=127.0.0.1" },
    sbjpubkey: keyPair.pubKeyObj,
    ext: [
      { extname: "basicConstraints", cA: false },
      { extname: "keyUsage", critical: true, names: ["digitalSignature", "keyEncipherment"] },
      { extname: "extKeyUsage", array: [{ name: "serverAuth" }] },
      { extname: "subjectAltName", array: [{ ip: "127.0.0.1" }, { dns: "localhost" }] },
    ],
    cakey: privateKey,
  })

  return {
    cert: certificate.getPEM(),
    key: KEYUTIL.getPEM(privateKey, "PKCS8PRV"),
  }
}

function toUtcTime(value: Date): string {
  const year = String(value.getUTCFullYear()).slice(-2)
  const month = String(value.getUTCMonth() + 1).padStart(2, "0")
  const day = String(value.getUTCDate()).padStart(2, "0")
  const hour = String(value.getUTCHours()).padStart(2, "0")
  const minute = String(value.getUTCMinutes()).padStart(2, "0")
  const second = String(value.getUTCSeconds()).padStart(2, "0")
  return `${year}${month}${day}${hour}${minute}${second}Z`
}

async function readEnv(path: string): Promise<Map<string, string>> {
  const text = await readFile(path, "utf8")
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
      continue
    }
    const index = line.indexOf("=")
    if (index > 0) {
      values.set(line.slice(0, index), line.slice(index + 1))
    }
  }
  return values
}

async function ensureEnvFile(path: string): Promise<void> {
  try {
    await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await copyFile(join(packageRoot, ".env.example"), path)
      console.log(`Created ${path} from .env.example. Fill the NetSuite OAuth values and rerun.`)
      return
    }
    throw error
  }
}

async function writeEnv(path: string, values: Map<string, string>): Promise<void> {
  await writeFile(
    path,
    `${[...values].map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    "utf8",
  )
}

function requiredEnv(env: Map<string, string>, key: string): string {
  const value = env.get(key)
  if (value === undefined || value.length === 0 || value === "change-me") {
    throw new Error(`${key} must be set in .env before browser OAuth login`)
  }
  return value
}

function argValue(name: string): string | undefined {
  const prefix = `${name}=`
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
}

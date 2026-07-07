import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { copyFile, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join } from "node:path"
import ky, { HTTPError } from "ky"
import { z } from "zod"

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
})

const packageRoot = join(import.meta.dir, "..")
const workspaceRoot = process.cwd()
const envPath = join(workspaceRoot, ".env")

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : "NetSuite OAuth login failed")
  process.exit(1)
})

async function main(): Promise<void> {
  await ensureEnvFile(envPath)
  const env = await readEnv(envPath)

  const authorizationUrl = requiredEnv(env, "NETSUITE_AUTHORIZATION_URL")
  const tokenUrl = requiredEnv(env, "NETSUITE_TOKEN_URL")
  const clientId = requiredEnv(env, "NETSUITE_CLIENT_ID")
  const clientSecret = requiredEnv(env, "NETSUITE_CLIENT_SECRET")
  const redirectUri = requiredEnv(env, "NETSUITE_REDIRECT_URI")
  const state = randomBytes(24).toString("base64url")
  const authUrl = createAuthorizationUrl({ authorizationUrl, clientId, redirectUri, state })

  console.log(`Opening NetSuite OAuth consent page: ${authUrl}`)
  await openBrowser(authUrl)

  const code = await waitForAuthorizationCode(redirectUri, state)
  const token = await exchangeCode({ tokenUrl, clientId, clientSecret, redirectUri, code })

  env.set("NETSUITE_OAUTH_FLOW", "authorization_code")
  env.set("NETSUITE_REFRESH_TOKEN", token.refresh_token)
  await writeEnv(envPath, env)

  console.log("NetSuite OAuth login complete. Refresh token was saved to .env.")
}

function createAuthorizationUrl(input: {
  readonly authorizationUrl: string
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
}): string {
  const url = new URL(input.authorizationUrl)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("scope", "restlets rest_webservices")
  url.searchParams.set("state", input.state)
  return url.toString()
}

async function waitForAuthorizationCode(
  redirectUri: string,
  expectedState: string,
): Promise<string> {
  const url = new URL(redirectUri)
  const port = Number(url.port || (url.protocol === "https:" ? "443" : "80"))
  const path = url.pathname

  return await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", redirectUri)
        if (requestUrl.pathname !== path) {
          response.writeHead(404).end("Not found")
          return
        }
        const state = requestUrl.searchParams.get("state")
        const code = requestUrl.searchParams.get("code")
        const error = requestUrl.searchParams.get("error")
        if (error !== null) {
          throw new Error(`NetSuite authorization failed: ${error}`)
        }
        if (state !== expectedState) {
          throw new Error("OAuth state mismatch")
        }
        if (code === null || code.length === 0) {
          throw new Error("OAuth callback did not include a code")
        }
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
    })
    server.once("error", reject)
    server.listen(port, url.hostname)
  })
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

async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  const child = spawn(command, args, { detached: true, stdio: "ignore" })
  child.unref()
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

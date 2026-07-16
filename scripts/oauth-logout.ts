import { existsSync } from "node:fs"
import { resolve } from "node:path"
import ky from "ky"
import { readEnvFile, removeEnvKeys } from "./env-file"

const envPath = resolve(process.cwd(), ".env")

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : "NetSuite OAuth logout failed")
  process.exit(1)
})

async function main(): Promise<void> {
  if (!existsSync(envPath)) throw new Error(`Missing ${envPath}`)
  const env = await readEnvFile(envPath)
  const localOnly = process.argv.includes("--local-only")
  const refreshToken = env["NETSUITE_REFRESH_TOKEN"]
  if (!localOnly && refreshToken) {
    const tokenUrl = required(env, "NETSUITE_TOKEN_URL")
    const clientId = required(env, "NETSUITE_CLIENT_ID")
    const clientSecret = required(env, "NETSUITE_CLIENT_SECRET")
    const revokeUrl = tokenUrl.replace(/\/token(?:\?.*)?$/, "/revoke")
    await ky.post(revokeUrl, {
      timeout: 30_000,
      retry: 0,
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ token: refreshToken }),
    })
    console.log("Revoked the NetSuite OAuth authorization.")
  }
  await removeEnvKeys(envPath, ["NETSUITE_REFRESH_TOKEN"])
  console.log("Cleared the local NetSuite refresh token. Restart connected MCP clients.")
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value)
    throw new Error(`${name} is required for remote revocation; use --local-only otherwise`)
  return value
}

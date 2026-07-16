import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { parseConfig } from "../src/config"
import { diagnoseAuthentication } from "../src/diagnostics/identity-diagnostics"
import { OAuthNetSuiteClient } from "../src/netsuite/client"
import { NetSuiteTokenProvider } from "../src/netsuite/oauth"
import { readEnvFile } from "./env-file"

const envPath = resolve(process.cwd(), ".env")

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Authentication diagnosis failed")
  process.exit(1)
})

async function main(): Promise<void> {
  if (!existsSync(envPath)) {
    console.log("FAIL config - .env is missing")
    console.log("Run: netsuite-supermcp setup")
    process.exit(1)
  }
  const env = await readEnvFile(envPath)
  const missing = requiredOAuthFields(env).filter((name) => !env[name]?.trim())
  for (const name of requiredOAuthFields(env)) {
    console.log(`${missing.includes(name) ? "FAIL" : "PASS"} ${name}`)
  }
  if (missing.length > 0) {
    console.log(`Missing ${missing.length} required OAuth setting(s).`)
    process.exit(1)
  }
  const parsed = parseConfig(env)
  if (!parsed.ok) {
    console.log(`FAIL config - ${parsed.error.message}`)
    process.exit(1)
  }
  const provider = new NetSuiteTokenProvider(parsed.value.netsuite)
  const client = new OAuthNetSuiteClient(parsed.value.netsuite, () => provider.getAccessToken())
  const result = await diagnoseAuthentication("current", parsed.value.netsuite, client, true)
  console.log(JSON.stringify(result, null, 2))
  process.exit(result["authenticated"] === true ? 0 : 1)
}

function requiredOAuthFields(env: NodeJS.ProcessEnv): readonly string[] {
  const common = [
    "NETSUITE_ACCOUNT_ID",
    "NETSUITE_ENVIRONMENT",
    "NETSUITE_BASE_URL",
    "NETSUITE_RESTLET_URL",
    "NETSUITE_TOKEN_URL",
  ]
  return env["NETSUITE_OAUTH_FLOW"] === "authorization_code"
    ? [...common, "NETSUITE_CLIENT_ID", "NETSUITE_CLIENT_SECRET", "NETSUITE_REFRESH_TOKEN"]
    : [
        ...common,
        "NETSUITE_CONSUMER_KEY",
        "NETSUITE_CERTIFICATE_ID",
        "NETSUITE_PRIVATE_KEY_PEM_BASE64",
      ]
}

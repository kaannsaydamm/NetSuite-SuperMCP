import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseConfig } from "../src/config"
import { OAuthNetSuiteClient } from "../src/netsuite/client"
import { NetSuiteTokenProvider } from "../src/netsuite/oauth"
import { NetSuiteRequestError } from "../src/shared/errors"

type CheckResult = {
  readonly detail?: string
  readonly name: string
  readonly ok: boolean
}

const envPath = join(resolve(process.cwd()), ".env")

await main().catch((error) => {
  console.error(red(error instanceof Error ? error.message : "Doctor failed"))
  process.exit(1)
})

async function main(): Promise<void> {
  printHeader()
  if (!existsSync(envPath)) {
    console.log(red(`Missing ${envPath}`))
    console.log("Run: netsuite-supermcp setup")
    process.exit(1)
  }

  const env = await readEnv(envPath)
  const parsed = parseConfig(env)
  if (!parsed.ok) {
    console.log(red(parsed.error.message))
    console.log("Run: netsuite-supermcp setup")
    process.exit(1)
  }

  const config = parsed.value
  const provider = new NetSuiteTokenProvider(config.netsuite)
  const client = new OAuthNetSuiteClient(config.netsuite, () => provider.getAccessToken())
  const checks: CheckResult[] = []

  checks.push({
    name: "config",
    ok: true,
    detail: `${config.netsuite.accountId} ${config.netsuite.environment}`,
  })
  checks.push(await check("oauth_refresh_token", () => provider.getAccessToken()))
  checks.push(
    await check("rest_metadata_catalog", () =>
      client.getRecordMetadata({ select: [], mediaType: "application/schema+json" }),
    ),
  )
  checks.push(
    await check("suiteql", () =>
      client.runSuiteQl({ query: "SELECT id, entityid FROM customer", params: [], limit: 1 }),
    ),
  )
  checks.push(
    await check("restlet_action_layer", () =>
      client.runRestletAction({
        action: "ns_checkAccountPermissions",
        phase: "preview",
        payload: {},
      }),
    ),
  )

  for (const result of checks) {
    console.log(
      `${result.ok ? green("PASS") : red("FAIL")} ${result.name}${result.detail ? ` - ${result.detail}` : ""}`,
    )
  }

  const restlet = checks.find((result) => result.name === "restlet_action_layer")
  if (restlet?.ok === false) {
    console.log("")
    console.log(yellow("RESTlet action layer is not reachable."))
    console.log(
      "Deploy these files in NetSuite and set NETSUITE_RESTLET_URL to the deployment URL:",
    )
    console.log("  netsuite/suitescript/supermcp_action_restlet.js")
    console.log("  netsuite/suitescript/supermcp_read_actions.js")
    console.log("  netsuite/suitescript/supermcp_transform_actions.js")
    console.log("  netsuite/suitescript/supermcp_integration_actions.js")
    console.log("  netsuite/suitescript/supermcp_mapping_actions.js")
    console.log("")
    console.log("Expected script/deploy IDs if using the default .env URL:")
    console.log("  customscript_supermcp_action")
    console.log("  customdeploy_supermcp_action")
    console.log("")
    console.log("To generate a SuiteCloud project for this RESTlet:")
    console.log("  netsuite-supermcp suitecloud")
    console.log("  cd .netsuite-supermcp-suitecloud")
    console.log("  npx -y @oracle/suitecloud-cli@3.2.0 account:setup -i")
    console.log("  npx -y @oracle/suitecloud-cli@3.2.0 project:deploy --validate")
  }

  process.exit(checks.every((result) => result.ok) ? 0 : 1)
}

async function check(name: string, run: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await run()
    return { name, ok: true }
  } catch (error) {
    return { name, ok: false, detail: describeError(error) }
  }
}

function describeError(error: unknown): string {
  if (error instanceof NetSuiteRequestError) {
    const body = error.responseBody.replace(/\s+/g, " ").trim()
    return `HTTP ${error.statusCode}${body.length > 0 ? ` ${body.slice(0, 240)}` : ""}`
  }
  return error instanceof Error ? error.message : String(error)
}

async function readEnv(path: string): Promise<NodeJS.ProcessEnv> {
  const values: NodeJS.ProcessEnv = { ...process.env }
  const text = await readFile(path, "utf8")
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
      continue
    }
    const index = line.indexOf("=")
    if (index > 0) {
      values[line.slice(0, index)] = line.slice(index + 1)
    }
  }
  return values
}

function printHeader(): void {
  console.log("")
  console.log(cyan("NetSuite SuperMCP Doctor"))
  console.log("")
}

function cyan(value: string): string {
  return `\x1b[36m${value}\x1b[0m`
}

function green(value: string): string {
  return `\x1b[32m${value}\x1b[0m`
}

function red(value: string): string {
  return `\x1b[31m${value}\x1b[0m`
}

function yellow(value: string): string {
  return `\x1b[33m${value}\x1b[0m`
}

import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, copyFile, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { stdin as input, stdout as output } from "node:process"
import { createInterface } from "node:readline/promises"
import { openBrowser } from "./browser-open"

const packageRoot = join(import.meta.dir, "..")
const workspaceRoot = resolve(process.cwd())
const envPath = join(workspaceRoot, ".env")
const docs = {
  enableFeatures:
    "https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3068358.html",
  integration:
    "https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html",
  authCode:
    "https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158074210415.html",
}

type NetSuiteEnvironment = "production" | "sandbox"

type Answers = {
  readonly accountId: string
  readonly environment: NetSuiteEnvironment
  readonly clientId: string
  readonly clientSecret: string
  readonly restletUrl: string
}

const args = new Set(process.argv.slice(2))
const noOpen = args.has("--no-open")
const skipOAuth = args.has("--skip-oauth")
const skipInstall = args.has("--skip-install")
const yes = args.has("--yes") || args.has("-y")

await main().catch((error) => {
  console.error(red(error instanceof Error ? error.message : "Setup failed"))
  process.exit(1)
})

async function main(): Promise<void> {
  printHeader()
  await ensureEnvFile()
  const current = await readEnv(envPath)

  printStep("1", "NetSuite Integration")
  printIntegrationInstructions()
  if (!noOpen && (yes || (await confirm("Open NetSuite integrations page now?", true)))) {
    await openBrowser("https://system.netsuite.com/app/center/card.nl?sc=-29")
  }

  printStep("2", "Local configuration")
  const answers = await collectAnswers(current)
  const next = buildEnv(current, answers)
  await writeEnv(envPath, next)
  console.log(green(`Saved ${envPath}`))

  printStep("3", "OAuth browser login")
  if (!skipOAuth && (yes || (await confirm("Run browser OAuth login now?", true)))) {
    run("bun", ["run", join(packageRoot, "scripts", "oauth-login.ts")])
  } else {
    console.log(dim("Later: run netsuite-supermcp-oauth-login"))
  }

  printStep("4", "Agent clients")
  if (
    !skipInstall &&
    (yes || (await confirm("Install MCP config into detected agent clients?", true)))
  ) {
    run("bun", ["run", join(packageRoot, "scripts", "install-clients.ts"), "--all-detected"])
  } else {
    console.log(dim("Later: run netsuite-supermcp-install --all-detected"))
  }

  printDone()
}

async function ensureEnvFile(): Promise<void> {
  if (existsSync(envPath)) {
    return
  }
  await copyFile(join(packageRoot, ".env.example"), envPath)
  await chmod(envPath, 0o600).catch(() => undefined)
  console.log(green(`Created ${envPath}`))
}

function printHeader(): void {
  console.log("")
  console.log(cyan("NetSuite SuperMCP Setup"))
  console.log(dim("Guided local setup for browser OAuth and agent clients."))
  console.log("")
}

function printIntegrationInstructions(): void {
  console.log("In NetSuite, create/edit an Integration record:")
  console.log(`  ${bold("Path:")} Setup > Integration > Manage Integrations > New`)
  console.log("")
  console.log("Set:")
  console.log(`  ${green("✓")} State: Enabled`)
  console.log(`  ${green("✓")} OAuth 2.0 > Authorization Code Grant`)
  console.log(`  ${green("✓")} Scope: RESTlets`)
  console.log(`  ${green("✓")} Scope: REST Web Services`)
  console.log(`  ${red("✗")} NetSuite AI Connector Service`)
  console.log(`  ${red("✗")} Public Client`)
  console.log(`  ${red("✗")} Client Credentials (Machine To Machine) Grant`)
  console.log("")
  console.log(`Redirect URI: ${bold("https://127.0.0.1:3026/oauth/callback")}`)
  console.log("")
  console.log("After Save, copy Client ID and Client Secret into this wizard.")
  console.log(dim(`Docs: ${docs.integration}`))
  console.log(dim(`OAuth flow: ${docs.authCode}`))
}

async function collectAnswers(current: Map<string, string>): Promise<Answers> {
  const accountArg = argValue("--account")
  const environmentArg = argValue("--environment")
  const restletArg = argValue("--restlet-url")
  const clientIdArg = argValue("--client-id")
  const clientSecretArg = argValue("--client-secret")
  if (
    accountArg !== undefined &&
    environmentArg !== undefined &&
    clientIdArg !== undefined &&
    clientSecretArg !== undefined
  ) {
    const environment = parseEnvironment(environmentArg)
    const restletUrl = restletArg ?? deriveUrls(accountArg).restletUrl
    if (!isUrl(restletUrl)) {
      throw new Error("--restlet-url must be a valid URL")
    }
    return {
      accountId: accountArg,
      environment,
      clientId: clientIdArg,
      clientSecret: clientSecretArg,
      restletUrl,
    }
  }

  const rl = createInterface({ input, output })
  try {
    const accountId = await ask(
      rl,
      "NetSuite Account ID",
      cleanDefault(current.get("NETSUITE_ACCOUNT_ID")?.replace("_", "-") ?? ""),
      isNonEmpty,
    )
    const environment = await askEnvironment(
      rl,
      cleanDefault(current.get("NETSUITE_ENVIRONMENT") ?? ""),
    )
    const derived = deriveUrls(accountId)
    const restletUrl = await ask(
      rl,
      "RESTlet URL (Enter to use placeholder until RESTlet deploy)",
      cleanDefault(current.get("NETSUITE_RESTLET_URL") ?? "") || derived.restletUrl,
      isUrl,
    )
    const clientId = await ask(
      rl,
      "OAuth Client ID",
      cleanDefault(current.get("NETSUITE_CLIENT_ID") ?? ""),
      isNonEmpty,
    )
    const clientSecret = await askSecret(
      rl,
      "OAuth Client Secret",
      cleanDefault(current.get("NETSUITE_CLIENT_SECRET") ?? ""),
    )
    return { accountId, environment, clientId, clientSecret, restletUrl }
  } finally {
    rl.close()
  }
}

async function askEnvironment(
  rl: ReturnType<typeof createInterface>,
  current: string | undefined,
): Promise<NetSuiteEnvironment> {
  const fallback = current === "sandbox" || current === "production" ? current : "production"
  while (true) {
    const answer = (await rl.question(`Environment [production/sandbox] (${fallback}): `)).trim()
    const value = answer.length === 0 ? fallback : answer.toLowerCase()
    if (value === "production" || value === "sandbox") {
      return value
    }
    console.log(red("Type production or sandbox."))
  }
}

function parseEnvironment(value: string): NetSuiteEnvironment {
  const normalized = value.toLowerCase()
  if (normalized === "production" || normalized === "sandbox") {
    return normalized
  }
  throw new Error("--environment must be production or sandbox")
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback: string,
  validate: (value: string) => boolean,
): Promise<string> {
  while (true) {
    const suffix = fallback.length > 0 ? ` (${fallback})` : ""
    const answer = (await rl.question(`${label}${suffix}: `)).trim()
    const value = answer.length === 0 ? fallback : answer
    if (validate(value)) {
      return value
    }
    console.log(red(`Invalid ${label}.`))
  }
}

async function askSecret(
  rl: ReturnType<typeof createInterface>,
  label: string,
  current: string | undefined,
): Promise<string> {
  const keep = current !== undefined && current.length > 0 && current !== "change-me"
  while (true) {
    const suffix = keep ? " (Enter to keep current)" : ""
    const answer = (await rl.question(`${label}${suffix}: `)).trim()
    if (answer.length > 0) {
      return answer
    }
    if (keep) {
      return current
    }
    console.log(red(`${label} is required.`))
  }
}

async function confirm(question: string, fallback: boolean): Promise<boolean> {
  const rl = createInterface({ input, output })
  try {
    const suffix = fallback ? "Y/n" : "y/N"
    const answer = (await rl.question(`${question} [${suffix}]: `)).trim().toLowerCase()
    if (answer.length === 0) {
      return fallback
    }
    return answer === "y" || answer === "yes"
  } finally {
    rl.close()
  }
}

function deriveUrls(accountId: string): {
  readonly authorizationUrl: string
  readonly baseUrl: string
  readonly restletUrl: string
  readonly tokenUrl: string
} {
  const domainAccount = accountId.toLowerCase().replaceAll("_", "-")
  return {
    authorizationUrl: `https://${domainAccount}.app.netsuite.com/app/login/oauth2/authorize.nl`,
    baseUrl: `https://${domainAccount}.suitetalk.api.netsuite.com`,
    restletUrl: `https://${domainAccount}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_supermcp_action&deploy=customdeploy_supermcp_action`,
    tokenUrl: `https://${domainAccount}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`,
  }
}

function buildEnv(current: Map<string, string>, answers: Answers): Map<string, string> {
  const urls = deriveUrls(answers.accountId)
  const next = new Map(current)
  const bearerToken =
    current.get("MCP_BEARER_TOKEN")?.replace("change-me-token-please", "") || randomToken()
  next.set("MCP_SERVER_NAME", current.get("MCP_SERVER_NAME") || "NetSuite SuperMCP")
  next.set("MCP_SERVER_VERSION", cleanDefault(current.get("MCP_SERVER_VERSION") ?? "") || "0.1.5")
  next.set("MCP_HOST", current.get("MCP_HOST") || "127.0.0.1")
  next.set("MCP_PORT", current.get("MCP_PORT") || "3025")
  next.set("MCP_BEARER_TOKEN", bearerToken)
  next.set("NETSUITE_ACCOUNT_ID", answers.accountId)
  next.set("NETSUITE_ENVIRONMENT", answers.environment)
  next.set("NETSUITE_BASE_URL", urls.baseUrl)
  next.set("NETSUITE_RESTLET_URL", answers.restletUrl)
  next.set("NETSUITE_OAUTH_FLOW", "authorization_code")
  next.set("NETSUITE_AUTHORIZATION_URL", urls.authorizationUrl)
  next.set("NETSUITE_CLIENT_ID", answers.clientId)
  next.set("NETSUITE_CLIENT_SECRET", answers.clientSecret)
  next.set("NETSUITE_REDIRECT_URI", "https://127.0.0.1:3026/oauth/callback")
  next.set("NETSUITE_TOKEN_URL", urls.tokenUrl)
  next.set("PRODUCTION_WRITES_ENABLED", current.get("PRODUCTION_WRITES_ENABLED") || "false")
  next.set("AUDIT_LOG_PATH", current.get("AUDIT_LOG_PATH") || "./data/audit.ndjson")
  return next
}

async function readEnv(path: string): Promise<Map<string, string>> {
  const values = new Map<string, string>()
  if (!existsSync(path)) {
    return values
  }
  const text = await readFile(path, "utf8")
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

async function writeEnv(path: string, values: Map<string, string>): Promise<void> {
  await writeFile(path, `${[...values].map(([key, value]) => `${key}=${value}`).join("\n")}\n`)
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`)
  }
}

function printStep(index: string, title: string): void {
  console.log("")
  console.log(cyan(`${index}. ${title}`))
}

function printDone(): void {
  console.log("")
  console.log(green("Setup finished."))
  console.log("Run a final permission probe from your MCP client with:")
  console.log(bold("  ns_checkAccountPermissions"))
  console.log("")
}

function randomToken(): string {
  return `mcp_${randomUUID().replaceAll("-", "")}`
}

function argValue(name: string): string | undefined {
  const prefix = `${name}=`
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
}

function cleanDefault(value: string): string {
  const placeholders = new Set([
    "1234567_SB1",
    "1234567-SB1",
    "change-me",
    "change-me-token-please",
    "base64-pem-here",
    "0.1.0",
  ])
  if (placeholders.has(value) || value.includes("1234567-sb1.")) {
    return ""
  }
  return value
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0 && value !== "change-me"
}

function isUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
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

function bold(value: string): string {
  return `\x1b[1m${value}\x1b[0m`
}

function dim(value: string): string {
  return `\x1b[2m${value}\x1b[0m`
}

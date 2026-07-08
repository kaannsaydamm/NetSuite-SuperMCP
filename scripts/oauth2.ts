import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, copyFile, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { stdin as input, stdout as output } from "node:process"
import { createInterface } from "node:readline/promises"
import {
  buildOAuth2Env,
  cleanDefault,
  deriveNetSuiteUrls,
  type NetSuiteEnvironment,
  type OAuth2Answers,
  parseNetSuiteEnvironment,
} from "./oauth2-config"

const packageRoot = join(import.meta.dir, "..")
const workspaceRoot = resolve(process.cwd())
const envPath = join(workspaceRoot, ".env")
const redirectUri = "https://127.0.0.1:3026/oauth/callback"
const args = new Set(process.argv.slice(2))
const yes = args.has("--yes") || args.has("-y")
const skipLogin = args.has("--skip-login")
const skipDoctor = args.has("--skip-doctor")

await main().catch((error) => {
  console.error(red(error instanceof Error ? error.message : "OAuth 2.0 setup failed"))
  process.exit(1)
})

async function main(): Promise<void> {
  printHeader()
  await ensureEnvFile()
  const current = await readEnv(envPath)
  const answers = await collectAnswers(current)
  const next = buildOAuth2Env(current, answers)
  await writeEnv(envPath, next)

  console.log(green(`Saved OAuth 2.0 config to ${envPath}`))
  console.log("")
  console.log("NetSuite Integration must have:")
  console.log(`  ${green("OK")} Authorization Code Grant`)
  console.log(`  ${green("OK")} RESTlets + REST Web Services scopes`)
  console.log(`  ${green("OK")} Redirect URI: ${answers.redirectUri}`)
  console.log(`  ${red("OFF")} NetSuite AI Connector Service scope`)
  console.log("")

  if (!skipLogin) {
    run("bun", ["run", join(packageRoot, "scripts", "oauth-login.ts")])
  } else {
    console.log(dim("Skipped browser login. Later: netsuite-supermcp-oauth-login"))
  }

  if (!skipDoctor) {
    const doctorStatus = runOptional("bun", ["run", join(packageRoot, "scripts", "doctor.ts")])
    if (doctorStatus !== 0) {
      console.log("")
      console.log(yellow("OAuth completed or config was saved, but doctor still found an issue."))
      console.log(bold("Run: netsuite-supermcp doctor"))
    }
  }
}

async function ensureEnvFile(): Promise<void> {
  if (existsSync(envPath)) {
    return
  }
  await copyFile(join(packageRoot, ".env.example"), envPath)
  await chmod(envPath, 0o600).catch(() => undefined)
  console.log(green(`Created ${envPath}`))
}

async function collectAnswers(current: Map<string, string>): Promise<OAuth2Answers> {
  const accountArg = argValue("--account")
  const environmentArg = argValue("--environment")
  const clientIdArg = argValue("--client-id")
  const clientSecretArg = argValue("--client-secret")
  const restletArg = argValue("--restlet-url")
  const redirectArg = argValue("--redirect-uri")

  if (yes) {
    const accountId = accountArg ?? cleanDefault(current.get("NETSUITE_ACCOUNT_ID") ?? "")
    const environment = parseNetSuiteEnvironment(
      environmentArg ?? (cleanDefault(current.get("NETSUITE_ENVIRONMENT") ?? "") || "production"),
    )
    const clientId = clientIdArg ?? cleanDefault(current.get("NETSUITE_CLIENT_ID") ?? "")
    const clientSecret =
      clientSecretArg ?? cleanDefault(current.get("NETSUITE_CLIENT_SECRET") ?? "")
    if (accountId.length === 0 || clientId.length === 0 || clientSecret.length === 0) {
      throw new Error(
        "--yes needs --account, --client-id, and --client-secret when those values are not already in .env",
      )
    }
    const savedRestletUrl = restletArg ?? cleanDefault(current.get("NETSUITE_RESTLET_URL") ?? "")
    return {
      accountId,
      environment,
      clientId,
      clientSecret,
      redirectUri:
        redirectArg ?? (cleanDefault(current.get("NETSUITE_REDIRECT_URI") ?? "") || redirectUri),
      ...(savedRestletUrl.length > 0 ? { restletUrl: savedRestletUrl } : {}),
    }
  }

  const rl = createInterface({ input, output })
  try {
    const accountId = await ask(
      rl,
      "NetSuite Account ID",
      accountArg ?? cleanDefault(current.get("NETSUITE_ACCOUNT_ID")?.replace("_", "-") ?? ""),
      isNonEmpty,
    )
    const environment = await askEnvironment(
      rl,
      environmentArg ?? cleanDefault(current.get("NETSUITE_ENVIRONMENT") ?? ""),
    )
    const urls = deriveNetSuiteUrls(accountId)
    const restletUrl = await ask(
      rl,
      "RESTlet URL",
      restletArg ?? (cleanDefault(current.get("NETSUITE_RESTLET_URL") ?? "") || urls.restletUrl),
      isUrl,
    )
    const clientId = await ask(
      rl,
      "OAuth Client ID",
      clientIdArg ?? cleanDefault(current.get("NETSUITE_CLIENT_ID") ?? ""),
      isNonEmpty,
    )
    const clientSecret = await askSecret(
      rl,
      "OAuth Client Secret",
      clientSecretArg ?? cleanDefault(current.get("NETSUITE_CLIENT_SECRET") ?? ""),
    )
    const callback = await ask(
      rl,
      "OAuth Redirect URI",
      redirectArg ?? (cleanDefault(current.get("NETSUITE_REDIRECT_URI") ?? "") || redirectUri),
      isUrl,
    )
    return { accountId, environment, clientId, clientSecret, redirectUri: callback, restletUrl }
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
    try {
      return parseNetSuiteEnvironment(value)
    } catch {
      console.log(red("Type production or sandbox."))
    }
  }
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
  const keep = current !== undefined && current.length > 0
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

function run(command: string, commandArgs: readonly string[]): void {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed`)
  }
}

function runOptional(command: string, commandArgs: readonly string[]): number {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  return result.status ?? 1
}

function argValue(name: string): string | undefined {
  const prefix = `${name}=`
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
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

function printHeader(): void {
  console.log("")
  console.log(cyan("NetSuite SuperMCP OAuth 2.0"))
  console.log(
    dim("Fast browser login: account ID + Integration Client ID/Secret -> refresh token."),
  )
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

function bold(value: string): string {
  return `\x1b[1m${value}\x1b[0m`
}

function dim(value: string): string {
  return `\x1b[2m${value}\x1b[0m`
}

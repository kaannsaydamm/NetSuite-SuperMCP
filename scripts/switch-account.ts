import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const packageRoot = join(import.meta.dir, "..")
const envPath = join(resolve(process.cwd()), ".env")

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : "NetSuite account switch failed")
  process.exit(1)
})

async function main(): Promise<void> {
  if (!existsSync(envPath)) {
    throw new Error(`Missing ${envPath}. Run netsuite-supermcp oauth2 first.`)
  }

  const env = await readEnv(envPath)
  env.delete("NETSUITE_REFRESH_TOKEN")
  await writeEnv(envPath, env)
  console.log("Cleared local NetSuite OAuth refresh token.")
  console.log(
    "Opening NetSuite OAuth with prompt=login consent so you can choose another account or role.",
  )

  const result = spawnSync(
    "bun",
    ["run", join(packageRoot, "scripts", "oauth-login.ts"), "--prompt=login consent"],
    { stdio: "inherit", shell: process.platform === "win32" },
  )
  process.exit(result.status ?? 1)
}

async function readEnv(path: string): Promise<Map<string, string>> {
  const values = new Map<string, string>()
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

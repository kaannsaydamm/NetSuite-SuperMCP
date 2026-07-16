import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const packageRoot = join(import.meta.dir, "..")
const suiteScriptSourceDir = join(packageRoot, "netsuite", "suitescript")
const suiteScriptFiles = [
  "supermcp_action_restlet.js",
  "supermcp_diagnostic_actions.js",
  "supermcp_file_actions.js",
  "supermcp_inventory_actions.js",
  "supermcp_read_actions.js",
  "supermcp_platform_actions.js",
  "supermcp_report_actions.js",
  "supermcp_transform_actions.js",
  "supermcp_integration_actions.js",
  "supermcp_mapping_actions.js",
  "supermcp_operation_actions.js",
] as const

type DeploymentStatus = "RELEASED" | "TESTING"

type Options = {
  readonly authId?: string
  readonly deploy: boolean
  readonly outDir: string
  readonly status: DeploymentStatus
  readonly validate: boolean
}

await main().catch((error) => {
  console.error(
    red(error instanceof Error ? error.message : "SuiteCloud project generation failed"),
  )
  process.exit(1)
})

async function main(): Promise<void> {
  const options = readOptions()
  const root = resolve(process.cwd(), options.outDir)
  const scriptsDir = join(root, "FileCabinet", "SuiteScripts", "SuperMCP")
  const objectsDir = join(root, "Objects")

  await mkdir(scriptsDir, { recursive: true })
  await mkdir(objectsDir, { recursive: true })

  for (const fileName of suiteScriptFiles) {
    await copyFile(join(suiteScriptSourceDir, fileName), join(scriptsDir, fileName))
  }

  await writeFile(join(root, "manifest.xml"), manifestXml())
  await writeFile(join(root, "deploy.xml"), deployXml())
  await writeFile(
    join(objectsDir, "customscript_supermcp_action.xml"),
    restletObjectXml(options.status),
  )
  await writeFile(join(root, "README.md"), projectReadme(options.status))

  console.log(green("SuiteCloud RESTlet project generated."))
  console.log(`Project: ${root}`)
  console.log("")
  const javaEnv = ensureSuiteCloudJavaEnv()
  console.log("")
  if (options.deploy) {
    runSuiteCloud(root, javaEnv, options)
  } else {
    console.log("Next:")
    console.log(`  netsuite-supermcp suitecloud --deploy`)
    console.log("")
    console.log("This uses npx for Oracle SuiteCloud CLI and manages a portable JDK on Windows.")
  }
}

function ensureSuiteCloudJavaEnv(): NodeJS.ProcessEnv {
  const java = spawnSync("java", ["-version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  const major =
    java.error !== undefined || (java.status ?? 1) !== 0
      ? null
      : parseJavaMajorVersion(`${java.stderr}\n${java.stdout}`)
  if (major === 17 || major === 21) {
    console.log(green(`SuiteCloud CLI preflight: Java ${major} is compatible.`))
    return process.env
  }

  const portableJavaHome = findPortableJdkHome()
  if (portableJavaHome !== null) {
    console.log(green(`SuiteCloud CLI preflight: using portable JDK at ${portableJavaHome}`))
    return {
      ...process.env,
      JAVA_HOME: portableJavaHome,
      PATH: `${join(portableJavaHome, "bin")};${process.env["PATH"] ?? ""}`,
    }
  }

  if (process.platform === "win32") {
    installPortableJdk()
    const installedJavaHome = findPortableJdkHome()
    if (installedJavaHome !== null) {
      console.log(green(`SuiteCloud CLI preflight: installed portable JDK at ${installedJavaHome}`))
      return {
        ...process.env,
        JAVA_HOME: installedJavaHome,
        PATH: `${join(installedJavaHome, "bin")};${process.env["PATH"] ?? ""}`,
      }
    }
  }

  throw new Error("SuiteCloud CLI needs JDK 17 or 21 and no compatible Java runtime was found.")
}

function parseJavaMajorVersion(value: string): number | null {
  const quoted = value.match(/version\s+"([^"]+)"/)
  const version = quoted?.[1]
  if (version === undefined) {
    return null
  }
  if (version.startsWith("1.")) {
    const legacy = Number(version.split(".")[1])
    return Number.isFinite(legacy) ? legacy : null
  }
  const major = Number(version.split(".")[0])
  return Number.isFinite(major) ? major : null
}

function readOptions(): Options {
  const outDir = argValue("--out") ?? ".netsuite-supermcp-suitecloud"
  const statusValue = argValue("--status") ?? "RELEASED"
  const authId = argValue("--auth-id") ?? process.env["NETSUITE_SUITECLOUD_AUTH_ID"]
  const deploy = process.argv.includes("--deploy")
  const validate = !process.argv.includes("--no-validate")
  if (statusValue !== "RELEASED" && statusValue !== "TESTING") {
    throw new Error("--status must be RELEASED or TESTING")
  }
  if (outDir.trim().length === 0 || outDir.includes("\0")) {
    throw new Error("--out must be a valid relative or absolute path")
  }
  if (!existsSync(suiteScriptSourceDir)) {
    throw new Error(`Missing bundled SuiteScript directory: ${suiteScriptSourceDir}`)
  }
  return {
    ...(authId === undefined || authId.trim().length === 0 ? {} : { authId }),
    deploy,
    outDir,
    status: statusValue,
    validate,
  }
}

function runSuiteCloud(root: string, env: NodeJS.ProcessEnv, options: Options): void {
  console.log("Running Oracle SuiteCloud CLI through npx.")
  const authIds = listAuthIds(root, env)
  const authId = options.authId ?? findAuthIdForAccount(env, authIds)
  if (authId === null) {
    run("npx", ["-y", "@oracle/suitecloud-cli@3.2.0", "account:setup", "-i"], root, env)
  } else {
    console.log(green(`SuiteCloud auth: using ${authId}`))
    selectBrowserAuthId(root, env, authIds, authId)
  }
  run(
    "npx",
    [
      "-y",
      "@oracle/suitecloud-cli@3.2.0",
      "project:deploy",
      ...(options.validate ? ["--validate"] : []),
    ],
    root,
    env,
  )
  console.log("")
  console.log(green("SuiteCloud deploy command finished."))
  console.log("Run: netsuite-supermcp doctor")
}

function listAuthIds(root: string, env: NodeJS.ProcessEnv): readonly string[] {
  const result = spawnSync(
    "npx",
    ["-y", "@oracle/suitecloud-cli@3.2.0", "account:manageauth", "--list"],
    {
      cwd: root,
      env,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  )
  if ((result.status ?? 1) !== 0) {
    return []
  }

  const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g")
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(ansiEscapePattern, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split("|")[0]?.trim())
    .filter((authId): authId is string => authId !== undefined && authId.length > 0)
}

function findAuthIdForAccount(
  env: NodeJS.ProcessEnv,
  candidates: readonly string[],
): string | null {
  const accountId = env["NETSUITE_ACCOUNT_ID"]?.replace(/_/g, "-").toLowerCase()
  if (accountId === undefined) {
    return onlyEntry(candidates)
  }

  const matching = candidates.filter((authId) => authId.toLowerCase().includes(accountId))
  return onlyEntry(matching) ?? onlyEntry(candidates)
}

function selectBrowserAuthId(
  root: string,
  env: NodeJS.ProcessEnv,
  authIds: readonly string[],
  authId: string,
): void {
  const index = authIds.indexOf(authId)
  if (index < 0) {
    throw new Error(`SuiteCloud auth ID was not found: ${authId}`)
  }
  const input = `${"\u001b[B".repeat(index + 1)}\n`
  const result = spawnSync("npx", ["-y", "@oracle/suitecloud-cli@3.2.0", "account:setup", "-i"], {
    cwd: root,
    env,
    input,
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  })
  if ((result.status ?? 1) !== 0) {
    throw new Error("SuiteCloud account:setup interactive auth selection failed")
  }
}

function onlyEntry(values: readonly string[]): string | null {
  if (values.length !== 1) {
    return null
  }
  const value = values[0]
  return value === undefined ? null : value
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`)
  }
}

function findPortableJdkHome(): string | null {
  if (process.platform !== "win32") {
    return null
  }
  const localAppData = process.env["LOCALAPPDATA"]
  if (localAppData === undefined) {
    return null
  }
  const root = join(localAppData, "NetSuiteSuperMCP", "jdk", "temurin-21")
  const candidates = [
    join(root, "jdk-21.0.11+10"),
    join(root, "jdk-21.0.10+9"),
    join(root, "jdk-21.0.9+10"),
  ]
  return candidates.find((candidate) => existsSync(join(candidate, "bin", "java.exe"))) ?? null
}

function installPortableJdk(): void {
  const localAppData = process.env["LOCALAPPDATA"]
  if (localAppData === undefined) {
    throw new Error("LOCALAPPDATA is not set; cannot install portable JDK.")
  }
  const installRoot = join(localAppData, "NetSuiteSuperMCP", "jdk", "temurin-21")
  console.log(yellow("Compatible Java was not found. Installing portable Temurin JDK 21..."))
  const script = [
    "$ErrorActionPreference='Stop'",
    `$dest='${escapePowerShell(installRoot)}'`,
    "New-Item -ItemType Directory -Force -Path $dest | Out-Null",
    "$zip=Join-Path $dest 'temurin-21.zip'",
    "$url='https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk'",
    "Invoke-WebRequest -Uri $url -OutFile $zip",
    "Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force",
    "Remove-Item -LiteralPath $zip -Force",
  ].join("; ")
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  )
  if ((result.status ?? 1) !== 0) {
    throw new Error("Portable JDK install failed")
  }
}

function escapePowerShell(value: string): string {
  return value.replaceAll("'", "''")
}

function manifestXml(): string {
  return `${xmlHeader()}<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>NetSuite SuperMCP</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features>
      <feature required="false">CRM</feature>
      <feature required="true">SERVERSIDESCRIPTING</feature>
    </features>
  </dependencies>
</manifest>
`
}

function deployXml(): string {
  return `${xmlHeader()}<deploy>
  <files>
    <path>~/FileCabinet/SuiteScripts/SuperMCP/*</path>
  </files>
  <objects>
    <path>~/Objects/customscript_supermcp_action.xml</path>
  </objects>
</deploy>
`
}

function restletObjectXml(status: DeploymentStatus): string {
  return `${xmlHeader()}<Restlet scriptid="customscript_supermcp_action">
  <isinactive>F</isinactive>
  <name>NetSuite SuperMCP Action RESTlet</name>
  <notifyowner>F</notifyowner>
  <scriptfile>[/SuiteScripts/SuperMCP/supermcp_action_restlet.js]</scriptfile>
  <scriptdeployments>
    <scriptdeployment scriptid="customdeploy_supermcp_action">
      <allroles>T</allroles>
      <isdeployed>T</isdeployed>
      <loglevel>AUDIT</loglevel>
      <status>${status}</status>
      <title>NetSuite SuperMCP Action RESTlet</title>
    </scriptdeployment>
  </scriptdeployments>
</Restlet>
`
}

function projectReadme(status: DeploymentStatus): string {
  return `# NetSuite SuperMCP SuiteCloud Project

This Account Customization Project deploys only the NetSuite SuperMCP RESTlet action layer.
It does not create or update NetSuite business records.

Generated files:

- File Cabinet scripts under \`/SuiteScripts/SuperMCP\`
- RESTlet script \`customscript_supermcp_action\`
- RESTlet deployment \`customdeploy_supermcp_action\`
- Deployment status \`${status}\`

Deploy:

\`\`\`bash
npx -y @oracle/suitecloud-cli@3.2.0 account:setup -i
npx -y @oracle/suitecloud-cli@3.2.0 project:deploy --validate
\`\`\`

Oracle SuiteCloud CLI requires JDK 17 or 21. After deployment, run:

\`\`\`bash
netsuite-supermcp doctor
\`\`\`
`
}

function argValue(name: string): string | undefined {
  const prefix = `${name}=`
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
}

function xmlHeader(): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
}

function green(value: string): string {
  return `\x1b[32m${value}\x1b[0m`
}

function yellow(value: string): string {
  return `\x1b[33m${value}\x1b[0m`
}

function red(value: string): string {
  return `\x1b[31m${value}\x1b[0m`
}

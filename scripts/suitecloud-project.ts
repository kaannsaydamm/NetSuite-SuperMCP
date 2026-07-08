import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const packageRoot = join(import.meta.dir, "..")
const suiteScriptSourceDir = join(packageRoot, "netsuite", "suitescript")
const suiteScriptFiles = [
  "supermcp_action_restlet.js",
  "supermcp_read_actions.js",
  "supermcp_transform_actions.js",
  "supermcp_integration_actions.js",
  "supermcp_mapping_actions.js",
] as const

type DeploymentStatus = "RELEASED" | "TESTING"

type Options = {
  readonly outDir: string
  readonly status: DeploymentStatus
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
  printJavaPreflight()
  console.log("")
  console.log("Next:")
  console.log(`  cd ${shellPath(root)}`)
  console.log("  npx -y @oracle/suitecloud-cli@3.2.0 account:setup -i")
  console.log("  npx -y @oracle/suitecloud-cli@3.2.0 project:deploy --validate")
  console.log("")
  console.log("After deploy:")
  console.log("  netsuite-supermcp doctor")
}

function printJavaPreflight(): void {
  const java = spawnSync("java", ["-version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  if (java.error !== undefined || (java.status ?? 1) !== 0) {
    console.log(
      yellow("SuiteCloud CLI preflight: Java was not found. Install Oracle JDK 17 or 21."),
    )
    return
  }

  const versionText = `${java.stderr}\n${java.stdout}`
  const major = parseJavaMajorVersion(versionText)
  if (major === 17 || major === 21) {
    console.log(green(`SuiteCloud CLI preflight: Java ${major} is compatible.`))
    return
  }

  console.log(
    yellow(
      `SuiteCloud CLI preflight: Java ${major ?? "unknown"} detected. Oracle SuiteCloud CLI requires JDK 17 or 21.`,
    ),
  )
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
  if (statusValue !== "RELEASED" && statusValue !== "TESTING") {
    throw new Error("--status must be RELEASED or TESTING")
  }
  if (outDir.trim().length === 0 || outDir.includes("\0")) {
    throw new Error("--out must be a valid relative or absolute path")
  }
  if (!existsSync(suiteScriptSourceDir)) {
    throw new Error(`Missing bundled SuiteScript directory: ${suiteScriptSourceDir}`)
  }
  return { outDir, status: statusValue }
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

function shellPath(path: string): string {
  return path.includes(" ") ? `"${path}"` : path
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

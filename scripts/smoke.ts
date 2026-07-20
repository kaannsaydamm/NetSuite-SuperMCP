import { type ChildProcess, spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { z } from "zod"

const SmokeConfigSchema = z.object({
  baseUrl: z.string().url().default("http://127.0.0.1:3125"),
  token: z.string().min(12).default("test-token-12345"),
})

const config = SmokeConfigSchema.parse({
  baseUrl: process.env["SMOKE_BASE_URL"],
  token: process.env["MCP_BEARER_TOKEN"],
})

const server = spawn("bun", ["run", "start"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    MCP_PORT: new URL(config.baseUrl).port,
    MCP_BEARER_TOKEN: config.token,
    NETSUITE_ACCOUNT_ID: "1234567_SB1",
    NETSUITE_ENVIRONMENT: "sandbox",
    NETSUITE_BASE_URL: "https://1234567-sb1.suitetalk.api.netsuite.com",
    NETSUITE_RESTLET_URL:
      "https://1234567-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_supermcp_action&deploy=customdeploy_supermcp_action",
    NETSUITE_OAUTH_FLOW: "client_credentials",
    NETSUITE_CONSUMER_KEY: "consumer-key",
    NETSUITE_CERTIFICATE_ID: "cert-id",
    NETSUITE_PRIVATE_KEY_PEM_BASE64: "cGVt",
    NETSUITE_TOKEN_URL:
      "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token",
    AUDIT_LOG_PATH: "./data/smoke-audit.ndjson",
  },
})
let serverOutput = ""
server.stdout.on("data", (chunk: Buffer) => {
  serverOutput += chunk.toString("utf8")
})
server.stderr.on("data", (chunk: Buffer) => {
  serverOutput += chunk.toString("utf8")
})

try {
  await waitForHealth(config.baseUrl)
  await assertUnauthorized(config.baseUrl)
  await assertMcpInitialize(config.baseUrl, config.token)
  await assertEnvironmentTool(config.baseUrl, config.token)
  await assertVersionTool(config.baseUrl, config.token)
  await assertTunnelMode()
  console.log("smoke ok")
} finally {
  server.kill()
  await rm("./data/smoke-audit.ndjson", { force: true })
  await rm("./data", { force: true, recursive: true })
}

async function waitForHealth(baseUrl: string): Promise<void> {
  await waitForServerHealth(baseUrl, server, () => serverOutput)
}

async function waitForServerHealth(
  baseUrl: string,
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before health check passed: ${output()}`)
    }
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) {
        return
      }
    } catch (error) {
      if (error instanceof Error) {
        await delay(100)
        continue
      }
      throw error
    }
    await delay(100)
  }
  throw new Error(`health check did not become ready: ${output()}`)
}

async function assertUnauthorized(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initializePayload(1)),
  })
  if (response.status !== 401) {
    throw new Error(`expected unauthorized MCP request to return 401, got ${response.status}`)
  }
}

async function assertTunnelMode(): Promise<void> {
  const tunnelPort = 3127
  const tunnelBaseUrl = `http://127.0.0.1:${tunnelPort}`
  const tunnelServer = spawn("bun", ["run", "start"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MCP_AUTH_MODE: "none",
      MCP_PORT: String(tunnelPort),
      NETSUITE_ACCOUNT_ID: "1234567_SB1",
      NETSUITE_ENVIRONMENT: "sandbox",
      NETSUITE_BASE_URL: "https://1234567-sb1.suitetalk.api.netsuite.com",
      NETSUITE_RESTLET_URL:
        "https://1234567-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_supermcp_action&deploy=customdeploy_supermcp_action",
      NETSUITE_OAUTH_FLOW: "client_credentials",
      NETSUITE_CONSUMER_KEY: "consumer-key",
      NETSUITE_CERTIFICATE_ID: "cert-id",
      NETSUITE_PRIVATE_KEY_PEM_BASE64: "cGVt",
      NETSUITE_TOKEN_URL:
        "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token",
      AUDIT_LOG_PATH: "./data/smoke-tunnel-audit.ndjson",
    },
  })
  let tunnelOutput = ""
  tunnelServer.stdout.on("data", (chunk: Buffer) => {
    tunnelOutput += chunk.toString("utf8")
  })
  tunnelServer.stderr.on("data", (chunk: Buffer) => {
    tunnelOutput += chunk.toString("utf8")
  })

  try {
    await waitForServerHealth(tunnelBaseUrl, tunnelServer, () => tunnelOutput)
    const response = await fetch(`${tunnelBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initializePayload(4)),
    })
    if (!response.ok) {
      throw new Error(
        `expected tunnel mode unauthenticated MCP request to pass, got ${response.status}`,
      )
    }
  } finally {
    tunnelServer.kill()
    await rm("./data/smoke-tunnel-audit.ndjson", { force: true })
  }
}

async function assertMcpInitialize(baseUrl: string, token: string): Promise<void> {
  const body = await postMcp(baseUrl, token, initializePayload(2))
  if (!JSON.stringify(body).includes("NetSuite SuperMCP")) {
    throw new Error("initialize response did not include server name")
  }
}

async function assertEnvironmentTool(baseUrl: string, token: string): Promise<void> {
  const body = await postMcp(baseUrl, token, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "ns_getEnvironment", arguments: {} },
  })
  if (!JSON.stringify(body).includes("sandbox")) {
    throw new Error("environment tool response did not include sandbox")
  }
}

async function assertVersionTool(baseUrl: string, token: string): Promise<void> {
  const body = await postMcp(baseUrl, token, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "ns_getSuperMcpVersion", arguments: {} },
  })
  const text = JSON.stringify(body)
  if (!text.includes("0.1.44") || !text.includes("toolCount")) {
    throw new Error("version tool response did not include package version and tool count")
  }
}

async function postMcp(baseUrl: string, token: string, payload: object): Promise<unknown> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-supermcp-user": "smoke-user",
      "x-supermcp-client": "smoke-script",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`MCP request failed with HTTP ${response.status}`)
  }

  return await response.json()
}

function initializePayload(id: number): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0.0.0" },
    },
  }
}

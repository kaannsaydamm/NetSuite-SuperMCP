import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { AuditLog } from "./audit"
import { parseConfig } from "./config"
import { formatConfigError } from "./config-help"
import { ExportStore } from "./jobs/export-store"
import { JobStore } from "./jobs/job-store"
import { OAuthNetSuiteClient } from "./netsuite/client"
import { NetSuiteTokenProvider } from "./netsuite/oauth"
import { OperationStore } from "./operations/operation-store"
import { CursorCodec } from "./query/suiteql"
import { registerTools } from "./tools/registry"

const parsedConfig = parseConfig(process.env)

if (!parsedConfig.ok) {
  console.error(formatConfigError(parsedConfig.error))
  process.exit(1)
}

const config = parsedConfig.value
const auditLog = new AuditLog(config.auditLogPath)
const tokenProvider = new NetSuiteTokenProvider(config.netsuite)
const netsuite = new OAuthNetSuiteClient(config.netsuite, () => tokenProvider.getAccessToken())
const operationStore = new OperationStore()
const jobStore = new JobStore(config.jobStorePath)
const exportStore = new ExportStore(config.exportDirectory)
const cursorCodec = new CursorCodec(Buffer.from(config.cursorSecret))
const server = new McpServer(
  { name: config.serverName, version: config.serverVersion },
  {
    instructions:
      "NetSuite SuperMCP exposes NetSuite read, write, transform, integration, and account permission check tools through the configured NetSuite OAuth account. Client applications own tool approval.",
  },
)

registerTools(server, {
  config,
  auditLog,
  netsuite,
  operationStore,
  jobStore,
  exportStore,
  cursorCodec,
  requester: process.env["MCP_REQUESTER"] ?? "local-agent",
  client: process.env["MCP_CLIENT"] ?? "stdio",
})

const transport = new StdioServerTransport()
await server.connect(transport)

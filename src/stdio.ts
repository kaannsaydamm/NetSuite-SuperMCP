import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { AuditLog } from "./audit"
import { CompositeStore } from "./composites/composite-store"
import { parseConfig } from "./config"
import { formatConfigError } from "./config-help"
import { CustomizationStore } from "./customizations/customization-store"
import { HarnessBudgetStore } from "./harness/budget-store"
import { decodeHarnessContext, defaultHarnessContext, isToolAllowed } from "./harness/context"
import { IntegrationStore } from "./integrations/integration-store"
import { ExportStore } from "./jobs/export-store"
import { JobStore } from "./jobs/job-store"
import { OAuthNetSuiteClient } from "./netsuite/client"
import { NetSuiteTokenProvider } from "./netsuite/oauth"
import { OperationStore } from "./operations/operation-store"
import { CursorCodec } from "./query/suiteql"
import { RunbookStore } from "./runbooks/runbook-store"
import { SemanticStore } from "./semantics/semantic-store"
import { type ToolName, toolPolicies } from "./tools/catalog"
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
const integrationStore = new IntegrationStore(config.integrationStorePath)
const customizationStore = new CustomizationStore(config.customizationStorePath)
const semanticStore = new SemanticStore(config.semanticStorePath)
const runbookStore = new RunbookStore(config.runbookStorePath)
const compositeStore = new CompositeStore(config.compositeStorePath)
const harnessBudgetStore = new HarnessBudgetStore(config.harnessBudgetStorePath)
const configuredHarnessContext = decodeHarnessContext(
  process.env["MCP_HARNESS_CONTEXT"],
  process.env["MCP_HARNESS_CONTEXT_SIGNATURE"],
  config.harnessContextSecret,
)
const requester = process.env["MCP_REQUESTER"] ?? "local-agent"
const client = process.env["MCP_CLIENT"] ?? "stdio"
const harnessContext =
  configuredHarnessContext ?? defaultHarnessContext(config.netsuite.environment, requester, client)
const allowedToolNames = new Set(
  (Object.keys(toolPolicies) as ToolName[]).filter((name) => isToolAllowed(harnessContext, name)),
)
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
  integrationStore,
  customizationStore,
  semanticStore,
  runbookStore,
  compositeStore,
  harnessBudgetStore,
  ...(harnessContext === undefined ? {} : { harnessContext }),
  allowedToolNames,
  requester: harnessContext?.subject ?? requester,
  client: harnessContext?.provider ?? client,
})

const transport = new StdioServerTransport()
await server.connect(transport)

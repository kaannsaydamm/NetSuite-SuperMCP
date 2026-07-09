import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createApp } from "../src/app"
import { type AppConfig, parseConfig } from "../src/config"
import { OAuthNetSuiteClient } from "../src/netsuite/client"
import { NetSuiteTokenProvider } from "../src/netsuite/oauth"
import type { JsonObject, JsonValue } from "../src/shared/json"
import { ToolName, toolPolicies } from "../src/tools/catalog"

type ProbeStatus = "pass" | "skip"

type ProbeResult = {
  readonly detail?: string
  readonly name: string
  readonly status: ProbeStatus
}

type MpcToolCall = {
  readonly name: ToolName
  readonly covers?: ToolName
  readonly arguments: JsonObject
}

const envPath = join(resolve(process.cwd()), ".env")

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live tool probe failed")
  process.exit(1)
})

async function main(): Promise<void> {
  if (!existsSync(envPath)) {
    throw new Error(`Missing ${envPath}. Run netsuite-supermcp oauth2 first.`)
  }

  const config = loadConfig(await readEnv(envPath))
  const provider = new NetSuiteTokenProvider(config.netsuite)
  const netsuite = new OAuthNetSuiteClient(config.netsuite, () => provider.getAccessToken())
  const app = createApp(config)
  const discovered = await discoverSafeIds(netsuite)
  const probes = buildProbes(discovered)
  const results: ProbeResult[] = []

  for (const probe of probes) {
    await callMcpTool(app, config, probe)
    results.push({ name: probe.covers ?? probe.name, status: "pass" })
  }

  if (discovered.customerId === undefined) {
    results.push({ name: ToolName.GetRecord, status: "skip", detail: "no customer found" })
  }
  if (discovered.salesOrderId === undefined) {
    results.push({
      name: ToolName.GetTransactionLines,
      status: "skip",
      detail: "no sales order found",
    })
  }
  if (discovered.inventoryStock === undefined) {
    results.push({
      name: ToolName.PrepareInventoryStockImport,
      status: "skip",
      detail: "no inventory balance row with item UPC found",
    })
  }
  for (const toolName of liveUnsafeTools()) {
    results.push({
      name: toolName,
      status: "skip",
      detail: "mutating direct tool; covered by unit tests, not committed against live NetSuite",
    })
  }
  const toolCount = Object.keys(toolPolicies).length
  const passed = new Set(
    results.filter((result) => result.status === "pass").map((result) => result.name),
  ).size
  const skipped = results.filter((result) => result.status === "skip")

  console.log(`live tool probe ok: ${passed}/${toolCount} tools passed`)
  for (const result of skipped) {
    console.log(`skip ${result.name}${result.detail ? ` - ${result.detail}` : ""}`)
  }
}

function buildProbes(discovered: {
  readonly customerId?: string
  readonly inventoryStock?: {
    readonly itemKey: string
    readonly locationId: string
    readonly quantity: number
  }
  readonly salesOrderId?: string
}): MpcToolCall[] {
  const probes: MpcToolCall[] = [
    { name: ToolName.GetEnvironment, arguments: {} },
    { name: ToolName.GetSuperMcpVersion, arguments: {} },
    { name: ToolName.ListCapabilities, arguments: {} },
    { name: ToolName.GetAuditLog, arguments: { limit: 1 } },
    {
      name: ToolName.CheckAccountPermissions,
      arguments: { recordTypes: ["customer"], includeRestlet: true },
    },
    { name: ToolName.FindInventoryAdjustmentAccounts, arguments: { limit: 5 } },
    {
      name: ToolName.GetRecordMetadata,
      arguments: { type: "customer", mediaType: "application/schema+json" },
    },
    { name: ToolName.RunSuiteQl, arguments: { query: "SELECT id FROM customer", limit: 1 } },
    {
      name: ToolName.PreviewAction,
      arguments: { action: ToolName.CheckAccountPermissions, phase: "commit", payload: {} },
    },
    {
      name: ToolName.PrepareAction,
      arguments: { action: ToolName.CheckAccountPermissions, phase: "commit", payload: {} },
    },
  ]

  if (discovered.customerId !== undefined) {
    probes.push({
      name: ToolName.GetRecord,
      arguments: { type: "customer", id: discovered.customerId },
    })
  }
  if (discovered.salesOrderId !== undefined) {
    probes.push({
      name: ToolName.GetTransactionLines,
      arguments: { type: "salesOrder", id: discovered.salesOrderId, sublist: "item" },
    })
  }
  if (discovered.inventoryStock !== undefined) {
    probes.push({
      name: ToolName.PrepareInventoryStockImport,
      arguments: {
        locationId: discovered.inventoryStock.locationId,
        adjustmentAccountId: "1",
        rows: [
          {
            itemKey: discovered.inventoryStock.itemKey,
            targetQuantity: discovered.inventoryStock.quantity,
          },
        ],
      },
    })
  }

  for (const [action, payload] of Object.entries(preparePayloads()) as [ToolName, JsonObject][]) {
    probes.push({
      name: ToolName.PrepareAction,
      covers: action,
      arguments: { action, phase: "commit", payload },
    })
  }

  return probes
}

function preparePayloads(): Partial<Record<ToolName, JsonObject>> {
  return {
    [ToolName.RunSavedSearch]: { savedSearchId: "customsearch_supermcp_probe", pageSize: 1 },
    [ToolName.RunReport]: { reportId: "customsearch_supermcp_probe", pageSize: 1 },
    [ToolName.GetFile]: {
      fileId: "SuiteScripts/SuperMCP/supermcp_action_restlet.js",
      maxBytes: 1024,
    },
    [ToolName.ListPlatformObjects]: {
      category: "scripts",
      columns: ["name", "internalid"],
      pageSize: 5,
    },
    [ToolName.GetPlatformObject]: { recordType: "script", recordId: "1", fields: ["name"] },
    [ToolName.SearchRecords]: {
      recordType: "customer",
      columns: ["internalid", "entityid"],
      pageSize: 5,
    },
    [ToolName.ListReportTypes]: {},
    [ToolName.ListReports]: { pageSize: 5 },
    [ToolName.RunSearch]: {
      recordType: "customer",
      columns: ["internalid", "entityid"],
      pageSize: 5,
    },
    [ToolName.ListFileCabinet]: { maxEntries: 1 },
    [ToolName.GetIntegrationLogs]: { savedSearchId: "customsearch_supermcp_probe", pageSize: 1 },
    [ToolName.GetScriptLogs]: { savedSearchId: "customsearch_supermcp_probe", pageSize: 1 },
    [ToolName.FindScriptErrors]: { savedSearchId: "customsearch_supermcp_probe", pageSize: 1 },
    [ToolName.ListScripts]: { savedSearchId: "customsearch_supermcp_probe", pageSize: 1 },
    [ToolName.ListScriptDeployments]: { savedSearchId: "customsearch_supermcp_probe", pageSize: 1 },
    [ToolName.GetFailedIntegrationJobs]: {
      savedSearchId: "customsearch_supermcp_probe",
      pageSize: 1,
    },
    [ToolName.ExplainIntegrationError]: {
      recordType: "customrecord_supermcp_probe",
      recordId: "1",
      fields: ["name"],
    },
    [ToolName.TransformRecord]: { fromType: "salesorder", fromId: "1", toType: "invoice" },
    [ToolName.FulfillSalesOrder]: { salesOrderId: "1" },
    [ToolName.InvoiceSalesOrder]: { salesOrderId: "1" },
    [ToolName.ReceivePurchaseOrder]: { purchaseOrderId: "1" },
    [ToolName.BillPurchaseOrder]: { purchaseOrderId: "1" },
    [ToolName.RetryIntegrationJob]: {
      recordType: "customrecord_supermcp_probe",
      recordId: "1",
      values: { custrecord_supermcp_probe: true },
    },
    [ToolName.GetMapping]: {
      recordType: "customrecord_supermcp_probe",
      recordId: "1",
      fields: ["name"],
    },
    [ToolName.UpdateMapping]: {
      recordType: "customrecord_supermcp_probe",
      recordId: "1",
      values: { custrecord_supermcp_probe: true },
    },
  }
}

function liveUnsafeTools(): readonly ToolName[] {
  return [
    ToolName.CreateRecord,
    ToolName.WriteFile,
    ToolName.CreateFolder,
    ToolName.UpdateFolder,
    ToolName.DeleteFolder,
    ToolName.CopyFile,
    ToolName.MoveFile,
    ToolName.DeleteFile,
    ToolName.CreateSavedSearch,
    ToolName.UpdateSavedSearch,
    ToolName.DeleteSavedSearch,
    ToolName.UpdateRecord,
    ToolName.SubmitFields,
    ToolName.DeleteRecord,
    ToolName.CommitAction,
    ToolName.CommitInventoryStockImport,
  ]
}

async function discoverSafeIds(netsuite: OAuthNetSuiteClient): Promise<{
  readonly customerId?: string
  readonly inventoryStock?: {
    readonly itemKey: string
    readonly locationId: string
    readonly quantity: number
  }
  readonly salesOrderId?: string
}> {
  const customerId = await firstId(netsuite, "SELECT id FROM customer")
  const salesOrderId = await firstId(netsuite, "SELECT id FROM transaction WHERE type = 'SalesOrd'")
  const inventoryStock = await firstInventoryStock(netsuite)
  return {
    ...(customerId === undefined ? {} : { customerId }),
    ...(salesOrderId === undefined ? {} : { salesOrderId }),
    ...(inventoryStock === undefined ? {} : { inventoryStock }),
  }
}

async function firstId(netsuite: OAuthNetSuiteClient, query: string): Promise<string | undefined> {
  const response = await netsuite.runSuiteQl({ query, params: [], limit: 1 })
  const items = response["items"]
  if (!Array.isArray(items)) {
    return undefined
  }
  const row = items[0]
  if (!isJsonObject(row)) {
    return undefined
  }
  const id = row["id"]
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined
}

async function firstInventoryStock(
  netsuite: OAuthNetSuiteClient,
): Promise<
  { readonly itemKey: string; readonly locationId: string; readonly quantity: number } | undefined
> {
  const response = await netsuite.runSuiteQl({
    query:
      "SELECT item.upccode AS itemkey, inventorybalance.location AS locationid, inventorybalance.quantityonhand AS quantity FROM inventorybalance JOIN item ON item.id = inventorybalance.item WHERE item.upccode IS NOT NULL",
    params: [],
    limit: 1,
  })
  const items = response["items"]
  if (!Array.isArray(items)) {
    return undefined
  }
  const row = items[0]
  if (!isJsonObject(row)) {
    return undefined
  }
  const itemKey = row["itemkey"]
  const locationId = row["locationid"]
  const quantity = row["quantity"]
  if (typeof itemKey !== "string" || typeof locationId !== "string") {
    return undefined
  }
  return { itemKey, locationId, quantity: Number(quantity ?? 0) }
}

async function callMcpTool(
  app: ReturnType<typeof createApp>,
  config: AppConfig,
  toolCall: MpcToolCall,
): Promise<void> {
  const response = await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.bearerToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-supermcp-user": "live-tool-probe",
      "x-supermcp-client": "scripts/live-tool-probe.ts",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: toolCall.name,
      method: "tools/call",
      params: toolCall,
    }),
  })
  const body = await response.json()
  if (response.status !== 200 || isMcpError(body)) {
    throw new Error(
      `${toolCall.name} ${JSON.stringify(toolCall.arguments)} failed: HTTP ${response.status} ${JSON.stringify(body)}`,
    )
  }
}

function isMcpError(value: unknown): boolean {
  if (!isJsonObject(value)) {
    return true
  }
  if (value["error"] !== undefined) {
    return true
  }
  const result = value["result"]
  if (!isJsonObject(result)) {
    return true
  }
  return result["isError"] === true
}

function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = parseConfig(env)
  if (!parsed.ok) {
    throw parsed.error
  }
  return parsed.value
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

function isJsonObject(value: JsonValue | unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

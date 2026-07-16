import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { InventoryStockImportPrepareRequest } from "../netsuite/types"
import { prepareRecordOperation } from "../operations/record-operation"
import { snapshotFingerprint } from "../operations/snapshot"
import { analyzeSuiteQl } from "../query/suiteql"
import type { JsonObject, JsonValue } from "../shared/json"
import {
  InventoryAdjustmentAccountSearchInputSchema,
  InventoryStockImportCommitInputSchema,
  InventoryStockImportPrepareInputSchema,
  RecordCreateInputSchema,
  RecordDeletePlanInputSchema,
  RecordInputSchema,
  RecordMetadataInputSchema,
  RecordUpdateInputSchema,
  SuiteQlInputSchema,
  ToolName,
  TransactionLinesInputSchema,
} from "./catalog"
import { findInventoryAdjustmentAccounts } from "./inventory-adjustment-accounts"
import { prepareInventoryStockImport } from "./inventory-stock-import"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerRecordTools(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.GetRecord,
    {
      title: "Get NetSuite record",
      description: "Reads one NetSuite record by record type and internal ID.",
      inputSchema: RecordInputSchema,
      outputSchema: outputSchemaFor(ToolName.GetRecord),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.GetRecord,
        dependencies,
        input,
        execute: () => dependencies.netsuite.getRecord(input),
      }),
  )

  registerSuiteQlTool(server, dependencies)
  registerMetadataTool(server, dependencies)
  registerTransactionLinesTool(server, dependencies)
  registerCreateRecordTool(server, dependencies)
  registerRecordPatchTool(server, dependencies, ToolName.UpdateRecord)
  registerRecordPatchTool(server, dependencies, ToolName.SubmitFields)
  registerDeleteRecordTool(server, dependencies)
  registerInventoryAdjustmentAccountTool(server, dependencies)
  registerInventoryStockImportTools(server, dependencies)
}

function registerSuiteQlTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.RunSuiteQl,
    {
      title: "Run SuiteQL",
      description: "Runs a read-only SuiteQL query through the integration role.",
      inputSchema: SuiteQlInputSchema,
      outputSchema: outputSchemaFor(ToolName.RunSuiteQl),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.RunSuiteQl,
        dependencies,
        input: suiteQlAuditInput(input),
        execute: () => {
          const analysis = analyzeSuiteQl(input.query)
          if (!analysis.valid) throw new Error(analysis.errors.join("; "))
          return dependencies.netsuite.runSuiteQl(input)
        },
      }),
  )
}

function registerMetadataTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.GetRecordMetadata,
    {
      title: "Get NetSuite record metadata",
      description: "Reads REST record metadata catalog entries for one or more record types.",
      inputSchema: RecordMetadataInputSchema,
      outputSchema: outputSchemaFor(ToolName.GetRecordMetadata),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.GetRecordMetadata,
        dependencies,
        input: metadataAuditInput(input),
        execute: () => dependencies.netsuite.getRecordMetadata(input),
      }),
  )
}

function registerTransactionLinesTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.GetTransactionLines,
    {
      title: "Get NetSuite transaction lines",
      description: "Reads a transaction line sublist through the REST record subresource endpoint.",
      inputSchema: TransactionLinesInputSchema,
      outputSchema: outputSchemaFor(ToolName.GetTransactionLines),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.GetTransactionLines,
        dependencies,
        input,
        execute: () => dependencies.netsuite.getTransactionLines(input),
      }),
  )
}

function registerCreateRecordTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.CreateRecord,
    {
      title: "Create NetSuite record",
      description: "Prepares a NetSuite record creation plan without saving a record.",
      inputSchema: RecordCreateInputSchema,
      outputSchema: outputSchemaFor(ToolName.CreateRecord),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.CreateRecord,
        dependencies,
        input,
        execute: () =>
          prepareRecordOperation(dependencies, ToolName.CreateRecord, jsonAuditInput(input)),
      }),
  )
}

function registerRecordPatchTool(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: typeof ToolName.UpdateRecord | typeof ToolName.SubmitFields,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description: "Prepares a NetSuite record update plan without saving a record.",
      inputSchema: RecordUpdateInputSchema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input,
        execute: () => prepareRecordOperation(dependencies, toolName, jsonAuditInput(input)),
      }),
  )
}

function registerDeleteRecordTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.DeleteRecord,
    {
      title: "Delete NetSuite record",
      description: "Prepares a NetSuite record deletion plan without deleting the record.",
      inputSchema: RecordDeletePlanInputSchema,
      outputSchema: outputSchemaFor(ToolName.DeleteRecord),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.DeleteRecord,
        dependencies,
        input,
        execute: () => prepareRecordOperation(dependencies, ToolName.DeleteRecord, input),
      }),
  )
}

function registerInventoryStockImportTools(
  server: McpServer,
  dependencies: ToolDependencies,
): void {
  server.registerTool(
    ToolName.PrepareInventoryStockImport,
    {
      title: "Prepare inventory stock import",
      description:
        "Builds a dry-run NetSuite inventory adjustment from target stock rows. It matches items, reads current stock, calculates deltas, and returns a commit confirmation string without changing NetSuite.",
      inputSchema: InventoryStockImportPrepareInputSchema,
      outputSchema: outputSchemaFor(ToolName.PrepareInventoryStockImport),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.PrepareInventoryStockImport,
        dependencies,
        input: jsonAuditInput(input),
        execute: () => prepareInventoryOperation(dependencies, input),
      }),
  )

  server.registerTool(
    ToolName.CommitInventoryStockImport,
    {
      title: "Commit inventory stock import",
      description:
        "Legacy convenience name that prepares a server-side inventory adjustment operation plan. It never commits directly; use ns_commitAction with the returned operationId and confirmation.",
      inputSchema: InventoryStockImportCommitInputSchema,
      outputSchema: outputSchemaFor(ToolName.CommitInventoryStockImport),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.CommitInventoryStockImport,
        dependencies,
        input: jsonAuditInput(input),
        execute: () => prepareInventoryOperation(dependencies, input),
      }),
  )
}

async function prepareInventoryOperation(
  dependencies: ToolDependencies,
  input: InventoryStockImportPrepareRequest,
): Promise<JsonObject> {
  const payload = jsonAuditInput(input)
  const preview = await prepareInventoryStockImport(dependencies.netsuite, input)
  const rejected = Array.isArray(preview["rejectedLines"]) ? preview["rejectedLines"].length : 0
  return dependencies.operationStore.create({
    action: ToolName.CommitInventoryStockImport,
    kind: "inventoryAdjustment",
    executor: "inventory",
    environment: dependencies.config.netsuite.environment,
    accountId: dependencies.config.netsuite.accountId,
    requester: dependencies.requester,
    client: dependencies.client,
    source: {
      locationId: input.locationId,
      adjustmentAccountId: input.adjustmentAccountId,
      ...(input.subsidiaryId === undefined ? {} : { subsidiaryId: input.subsidiaryId }),
      ...(input.inventoryStatusId === undefined
        ? {}
        : { inventoryStatusId: input.inventoryStatusId }),
    },
    selection: { mode: "absoluteStockRows", rowCount: input.rows.length },
    payload,
    preview,
    snapshotFingerprint: snapshotFingerprint(preview),
    impact: {
      summary: `Prepare an absolute-stock inventory adjustment for ${input.rows.length} explicit rows at location ${input.locationId}. No record was saved.`,
      details: preview,
    },
    warnings: [
      ...(dependencies.config.netsuite.environment === "production"
        ? ["This plan targets a production NetSuite account."]
        : []),
      ...(rejected > 0 ? [`${rejected} input rows are rejected; commit will not proceed.`] : []),
    ],
  })
}

function registerInventoryAdjustmentAccountTool(
  server: McpServer,
  dependencies: ToolDependencies,
): void {
  server.registerTool(
    ToolName.FindInventoryAdjustmentAccounts,
    {
      title: "Find inventory adjustment accounts",
      description:
        "Finds likely NetSuite account internal IDs for inventoryAdjustment account using read-only SuiteQL. Prefer the returned candidate id as adjustmentAccountId.",
      inputSchema: InventoryAdjustmentAccountSearchInputSchema,
      outputSchema: outputSchemaFor(ToolName.FindInventoryAdjustmentAccounts),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.FindInventoryAdjustmentAccounts,
        dependencies,
        input: jsonAuditInput(input),
        execute: () => findInventoryAdjustmentAccounts(dependencies.netsuite, input),
      }),
  )
}

function jsonAuditInput(input: unknown): JsonObject {
  return JSON.parse(JSON.stringify(input)) as JsonObject
}

function suiteQlAuditInput(input: {
  readonly query: string
  readonly params: readonly JsonValue[]
  readonly limit?: number | undefined
  readonly offset?: number | undefined
}): JsonObject {
  return {
    query: input.query,
    params: input.params,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
  }
}

function metadataAuditInput(input: {
  readonly type?: string | undefined
  readonly select: readonly string[]
  readonly mediaType: string
}): JsonObject {
  return {
    select: input.select,
    mediaType: input.mediaType,
    ...(input.type === undefined ? {} : { type: input.type }),
  }
}

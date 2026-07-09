import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { JsonObject, JsonValue } from "../shared/json"
import {
  InventoryStockImportCommitInputSchema,
  InventoryStockImportPrepareInputSchema,
  RecordCreateInputSchema,
  RecordDeleteInputSchema,
  RecordInputSchema,
  RecordMetadataInputSchema,
  RecordUpdateInputSchema,
  SuiteQlInputSchema,
  ToolName,
  TransactionLinesInputSchema,
} from "./catalog"
import { commitInventoryStockImport, prepareInventoryStockImport } from "./inventory-stock-import"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerRecordTools(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.GetRecord,
    {
      title: "Get NetSuite record",
      description: "Reads one NetSuite record by record type and internal ID.",
      inputSchema: RecordInputSchema,
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
  registerInventoryStockImportTools(server, dependencies)
}

function registerSuiteQlTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.RunSuiteQl,
    {
      title: "Run SuiteQL",
      description: "Runs a read-only SuiteQL query through the integration role.",
      inputSchema: SuiteQlInputSchema,
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.RunSuiteQl,
        dependencies,
        input: suiteQlAuditInput(input),
        execute: () => dependencies.netsuite.runSuiteQl(input),
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
      description: "Creates one NetSuite record through REST Record API POST.",
      inputSchema: RecordCreateInputSchema,
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.CreateRecord,
        dependencies,
        input,
        execute: () => dependencies.netsuite.createRecord(input),
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
      description: "Updates one NetSuite record through REST Record API PATCH.",
      inputSchema: RecordUpdateInputSchema,
    },
    async (input) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input,
        execute: () =>
          toolName === ToolName.SubmitFields
            ? dependencies.netsuite.submitFields(input)
            : dependencies.netsuite.updateRecord(input),
      }),
  )
}

function registerDeleteRecordTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.DeleteRecord,
    {
      title: "Delete NetSuite record",
      description: "Deletes one NetSuite record through REST Record API DELETE.",
      inputSchema: RecordDeleteInputSchema,
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.DeleteRecord,
        dependencies,
        input,
        execute: () => dependencies.netsuite.deleteRecord(input),
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
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.PrepareInventoryStockImport,
        dependencies,
        input: jsonAuditInput(input),
        execute: () => prepareInventoryStockImport(dependencies.netsuite, input),
      }),
  )

  server.registerTool(
    ToolName.CommitInventoryStockImport,
    {
      title: "Commit inventory stock import",
      description:
        "Creates one NetSuite inventoryAdjustment for target stock rows after recomputing deltas and validating the prepare confirmation string.",
      inputSchema: InventoryStockImportCommitInputSchema,
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.CommitInventoryStockImport,
        dependencies,
        input: jsonAuditInput(input),
        execute: () => commitInventoryStockImport(dependencies.netsuite, input),
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

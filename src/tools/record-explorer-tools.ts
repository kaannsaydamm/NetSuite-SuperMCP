import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  BatchGetRecordsInputSchema,
  BatchResolveInternalIdsInputSchema,
  CreateEvidenceBundleInputSchema,
  DescribeFieldInputSchema,
  DescribeRecordTypeInputSchema,
  DiagnoseTransactionInputSchema,
  DiffRecordSnapshotsInputSchema,
  FindFieldByLabelInputSchema,
  FindRecordByExternalIdInputSchema,
  GetRecordWithSublistsInputSchema,
  ListRecordFieldsInputSchema,
  ListRecordTypesInputSchema,
  RecordSnapshotInputSchema,
  SystemNotesInputSchema,
  TransactionChainInputSchema,
} from "../contracts/record-explorer-schemas"
import {
  batchGetRecords,
  createEvidenceBundle,
  createRecordSnapshot,
  diffSnapshots,
  extractFields,
  extractRecordTypes,
  normalizeTransactionChain,
  readRecordTypeMetadata,
  transactionHypotheses,
} from "../record-explorer/explorer"
import type { JsonObject, JsonValue } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerRecordExplorerTools(
  server: McpServer,
  dependencies: ToolDependencies,
): void {
  readTool(
    server,
    dependencies,
    ToolName.ListRecordTypes,
    ListRecordTypesInputSchema,
    async (input) => {
      const metadata = await dependencies.netsuite.getRecordMetadata({
        select: [],
        mediaType: "application/json",
      })
      return extractRecordTypes(metadata, input.search, input.limit)
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.DescribeRecordType,
    DescribeRecordTypeInputSchema,
    async (input) => await readRecordTypeMetadata(dependencies.netsuite, input.type),
  )
  readTool(
    server,
    dependencies,
    ToolName.ListRecordFields,
    ListRecordFieldsInputSchema,
    async (input) => {
      const description = await readRecordTypeMetadata(dependencies.netsuite, input.type)
      const needle = input.search?.toLowerCase()
      const all = extractFields(description.metadata)
      const fields = needle
        ? all.filter(
            (field) =>
              field.id.toLowerCase().includes(needle) || field.label.toLowerCase().includes(needle),
          )
        : all
      return {
        source: description.source,
        fields: fields.slice(0, input.limit),
        count: fields.length,
        truncated: fields.length > input.limit,
      }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.DescribeField,
    DescribeFieldInputSchema,
    async (input) => {
      const description = await readRecordTypeMetadata(dependencies.netsuite, input.type)
      const field = extractFields(description.metadata).find((entry) => entry.id === input.fieldId)
      return field
        ? { found: true, field, source: description.source }
        : { found: false, fieldId: input.fieldId, source: description.source }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.FindFieldByLabel,
    FindFieldByLabelInputSchema,
    async (input) => {
      const description = await readRecordTypeMetadata(dependencies.netsuite, input.type)
      const needle = input.label.toLowerCase()
      const ranked = extractFields(description.metadata)
        .map((field) => ({ ...field, score: labelScore(field.label, needle) }))
        .filter((field) => field.score > 0)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      return {
        results: ranked.slice(0, input.limit),
        count: ranked.length,
        truncated: ranked.length > input.limit,
      }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.FindRecordByExternalId,
    FindRecordByExternalIdInputSchema,
    async (input) =>
      await dependencies.netsuite.runSuiteQl({
        query: `SELECT id, externalid FROM ${input.type} WHERE externalid = ?`,
        params: [input.externalId],
        limit: input.limit,
      }),
  )
  readTool(
    server,
    dependencies,
    ToolName.BatchResolveInternalIds,
    BatchResolveInternalIdsInputSchema,
    async (input) => {
      const query = `SELECT id, ${input.matchField} AS matchvalue FROM ${input.type} WHERE ${input.matchField} IN (${input.values.map(() => "?").join(",")})`
      const response = await dependencies.netsuite.runSuiteQl({
        query,
        params: input.values,
        limit: Math.min(1000, input.values.length * 5),
      })
      return withResolutionGaps(response, input.values)
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.BatchGetRecords,
    BatchGetRecordsInputSchema,
    async (input) => await batchGetRecords(dependencies.netsuite, input.records),
  )
  readTool(
    server,
    dependencies,
    ToolName.GetRecordWithSublists,
    GetRecordWithSublistsInputSchema,
    async (input) =>
      await dependencies.netsuite.runRestletAction({
        action: ToolName.GetRecordWithSublists,
        phase: "preview",
        payload: {
          recordType: input.type,
          recordId: input.id,
          sublists: input.sublists,
          lineLimit: input.lineLimit,
        },
      }),
  )
  readTool(
    server,
    dependencies,
    ToolName.GetTransactionChain,
    TransactionChainInputSchema,
    async (input) => await transactionChain(dependencies, input),
  )
  readTool(
    server,
    dependencies,
    ToolName.GetSystemNotes,
    SystemNotesInputSchema,
    async (input) => await systemNotes(dependencies, input),
  )
  readTool(
    server,
    dependencies,
    ToolName.ExplainRecordHistory,
    SystemNotesInputSchema,
    async (input) => {
      const notes = await systemNotes(dependencies, input)
      const events = Array.isArray(notes["events"]) ? notes["events"] : []
      return {
        ...notes,
        explanation: events.map((event, index) => ({ sequence: index + 1, evidence: event })),
        ordering: "netsuite-returned-sequence",
      }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.GetTransactionEventStream,
    SystemNotesInputSchema,
    async (input) => {
      const notes = await systemNotes(dependencies, input)
      return {
        ...notes,
        ordering: "netsuite-returned-sequence",
        chronologySynthesized: false,
      }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.DiagnoseTransaction,
    DiagnoseTransactionInputSchema,
    async (input) => {
      const chain = await transactionChain(dependencies, input)
      const notes = input.includeSystemNotes
        ? await systemNotes(dependencies, { type: input.type, id: input.id, limit: 250 })
        : undefined
      return {
        chain,
        ...(notes === undefined ? {} : { notes }),
        hypotheses: transactionHypotheses(chain, notes),
      }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.CreateRecordSnapshot,
    RecordSnapshotInputSchema,
    async (input) => ({
      snapshot: await createRecordSnapshot(
        dependencies.netsuite,
        { type: input.type, id: input.id },
        input.sublists,
        input.lineLimit,
      ),
    }),
  )
  readTool(
    server,
    dependencies,
    ToolName.DiffRecordSnapshots,
    DiffRecordSnapshotsInputSchema,
    async (input) => diffSnapshots(input.before, input.after),
  )
  readTool(
    server,
    dependencies,
    ToolName.CreateEvidenceBundle,
    CreateEvidenceBundleInputSchema,
    async (input) => createEvidenceBundle(input.name, input.items as JsonObject[]),
  )
}

async function transactionChain(
  dependencies: ToolDependencies,
  input: z.infer<typeof TransactionChainInputSchema>,
) {
  return normalizeTransactionChain(
    await dependencies.netsuite.runRestletAction({
      action: ToolName.GetTransactionChain,
      phase: "preview",
      payload: {
        recordType: input.type,
        recordId: input.id,
        maxNodes: input.maxNodes,
        integrationReferences: input.integrationReferences,
      },
    }),
  )
}

async function systemNotes(
  dependencies: ToolDependencies,
  input: z.infer<typeof SystemNotesInputSchema>,
) {
  return await dependencies.netsuite.runRestletAction({
    action: ToolName.GetSystemNotes,
    phase: "preview",
    payload: { recordType: input.type, recordId: input.id, limit: input.limit },
  })
}

function readTool<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  schema: z.ZodType<T>,
  execute: (input: T) => Promise<JsonObject>,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description:
        "Reads bounded NetSuite record metadata, relationships, history, or evidence without mutation.",
      inputSchema: schema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input: T) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input: input as JsonObject,
        execute: () => execute(input),
      }),
  )
}

function labelScore(label: string, needle: string): number {
  const candidate = label.toLowerCase()
  if (candidate === needle) return 100
  if (candidate.startsWith(needle)) return 75
  if (candidate.includes(needle)) return 50
  return 0
}

function withResolutionGaps(response: JsonObject, requested: readonly string[]): JsonObject {
  const items = Array.isArray(response["items"]) ? response["items"] : []
  const found = new Set(
    items.flatMap((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? [String((item as JsonObject)["matchvalue"] ?? "")]
        : [],
    ),
  )
  const gaps: JsonValue[] = requested
    .filter((value) => !found.has(value))
    .map((value) => ({ value, reason: "not-visible-or-not-found" }))
  return { ...response, gaps, partial: gaps.length > 0 }
}

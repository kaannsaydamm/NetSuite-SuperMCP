import { randomUUID } from "node:crypto"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  RecordCreateRequestSchema,
  RecordDeleteRequestSchema,
  RecordUpdateRequestSchema,
  type RestletAction,
} from "../netsuite/types"
import type { OperationPlan } from "../operations/operation-store"
import { snapshotFingerprint } from "../operations/snapshot"
import type { JsonObject, JsonValue } from "../shared/json"
import {
  CommitOperationInputSchema,
  GenericActionInputSchema,
  GenericTransformOperationInputSchema,
  PrepareCompensationInputSchema,
  PrepareOperationInputSchema,
  PreviewOperationInputSchema,
  PurchaseOrderOperationInputSchema,
  SalesOrderOperationInputSchema,
  ToolName,
} from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

const actionTools = [
  ToolName.RunSavedSearch,
  ToolName.RunReport,
  ToolName.ListPlatformObjects,
  ToolName.GetPlatformObject,
  ToolName.SearchRecords,
  ToolName.ListReportTypes,
  ToolName.ListReports,
  ToolName.RunSearch,
  ToolName.CreateSavedSearch,
  ToolName.UpdateSavedSearch,
  ToolName.DeleteSavedSearch,
  ToolName.ListFileCabinet,
  ToolName.GetFile,
  ToolName.WriteFile,
  ToolName.CreateFolder,
  ToolName.UpdateFolder,
  ToolName.DeleteFolder,
  ToolName.CopyFile,
  ToolName.MoveFile,
  ToolName.DeleteFile,
  ToolName.GetIntegrationLogs,
  ToolName.GetScriptLogs,
  ToolName.FindScriptErrors,
  ToolName.ListScripts,
  ToolName.ListScriptDeployments,
  ToolName.TransformRecord,
  ToolName.FulfillSalesOrder,
  ToolName.InvoiceSalesOrder,
  ToolName.ReceivePurchaseOrder,
  ToolName.BillPurchaseOrder,
  ToolName.GetFailedIntegrationJobs,
  ToolName.ExplainIntegrationError,
  ToolName.RetryIntegrationJob,
  ToolName.GetMapping,
  ToolName.UpdateMapping,
] as const

const readOnlyActionTools = new Set<ToolName>([
  ToolName.RunSavedSearch,
  ToolName.RunReport,
  ToolName.ListPlatformObjects,
  ToolName.GetPlatformObject,
  ToolName.SearchRecords,
  ToolName.ListReportTypes,
  ToolName.ListReports,
  ToolName.RunSearch,
  ToolName.ListFileCabinet,
  ToolName.GetFile,
  ToolName.GetIntegrationLogs,
  ToolName.GetScriptLogs,
  ToolName.FindScriptErrors,
  ToolName.ListScripts,
  ToolName.ListScriptDeployments,
  ToolName.GetFailedIntegrationJobs,
  ToolName.ExplainIntegrationError,
  ToolName.GetMapping,
])

const transformActionTools = new Set<string>([
  ToolName.TransformRecord,
  ToolName.FulfillSalesOrder,
  ToolName.InvoiceSalesOrder,
  ToolName.ReceivePurchaseOrder,
  ToolName.BillPurchaseOrder,
])

export function registerActionTools(server: McpServer, dependencies: ToolDependencies): void {
  for (const toolName of actionTools) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: !readOnlyActionTools.has(toolName)
          ? `Prepares NetSuite action ${toolName} without saving a record. Commit the reviewed operation separately.`
          : `Runs NetSuite action ${toolName} through the RESTlet action layer.`,
        inputSchema: directActionInputSchema(toolName),
        outputSchema: outputSchemaFor(toolName),
      },
      async (input: unknown) => {
        const actionInput = input as JsonObject & {
          readonly action?: string
          readonly payload?: JsonObject
        }
        return runNetSuiteTool({
          toolName,
          dependencies,
          input: actionInput,
          execute: async () => {
            const payload = normalizeDirectActionPayload(actionInput)
            const phase = directActionPhase(toolName)
            if (phase === "prepare") {
              return await prepareOperation(dependencies, toolName, payload)
            }
            return await dependencies.netsuite.runRestletAction({
              action: toolName,
              phase,
              payload,
            })
          },
        })
      },
    )
  }
  registerPrepareOperationTool(server, dependencies)
  registerPreviewOperationTool(server, dependencies)
  registerCommitOperationTool(server, dependencies)
  registerPrepareCompensationTool(server, dependencies)
}

function registerPrepareCompensationTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.PrepareCompensation,
    {
      title: "Prepare NetSuite compensation plan",
      description:
        "Explains a possible non-atomic compensation for a completed operation without changing NetSuite.",
      inputSchema: PrepareCompensationInputSchema,
      outputSchema: outputSchemaFor(ToolName.PrepareCompensation),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.PrepareCompensation,
        dependencies,
        input,
        execute: async () => {
          const plan = dependencies.operationStore.completed(
            input.operationId,
            operationIdentity(dependencies),
          )
          const target = committedTarget(plan.result)
          if (plan.action === ToolName.FulfillSalesOrder && target !== undefined) {
            return {
              operationId: plan.operationId,
              strategy: "delete",
              atomic: false,
              reversible: true,
              target,
              explanation:
                "The fulfillment may be deleted if NetSuite still permits it. This is a separate reviewed action, not an atomic rollback.",
            }
          }
          return {
            operationId: plan.operationId,
            strategy: "manualReview",
            atomic: false,
            reversible: false,
            ...(target === undefined ? {} : { target }),
            explanation:
              "No deterministic automatic reversal is available. Review a void, deletion, or counter-transaction in NetSuite.",
          }
        },
      }),
  )
}

function directActionInputSchema(toolName: ToolName) {
  switch (toolName) {
    case ToolName.FulfillSalesOrder:
    case ToolName.InvoiceSalesOrder:
      return SalesOrderOperationInputSchema
    case ToolName.ReceivePurchaseOrder:
    case ToolName.BillPurchaseOrder:
      return PurchaseOrderOperationInputSchema
    case ToolName.TransformRecord:
      return GenericTransformOperationInputSchema
    default:
      return GenericActionInputSchema
  }
}

function registerPrepareOperationTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.PrepareAction,
    {
      title: "Prepare NetSuite operation",
      description: "Validates and stores a single-use NetSuite operation without saving a record.",
      inputSchema: PrepareOperationInputSchema,
      outputSchema: outputSchemaFor(ToolName.PrepareAction),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.PrepareAction,
        dependencies,
        input: input as unknown as JsonObject,
        execute: async () => {
          const payload = input.payload as unknown as JsonObject
          return await prepareOperation(dependencies, input.action, payload)
        },
      }),
  )
}

function registerPreviewOperationTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.PreviewAction,
    {
      title: "Preview prepared NetSuite operation",
      description: "Replays a stored operation in preview mode without saving a record.",
      inputSchema: PreviewOperationInputSchema,
      outputSchema: outputSchemaFor(ToolName.PreviewAction),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.PreviewAction,
        dependencies,
        input,
        execute: async () => {
          const plan = dependencies.operationStore.preview(
            input.operationId,
            operationIdentity(dependencies),
          )
          const preview = await dependencies.netsuite.runRestletAction({
            action: plan.action,
            phase: "preview",
            payload: plan.payload,
          })
          return { ...plan, phase: "preview", preview }
        },
      }),
  )
}

function registerCommitOperationTool(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.CommitAction,
    {
      title: "Commit prepared NetSuite operation",
      description: "Commits exactly one unused server-side operation plan after confirmation.",
      inputSchema: CommitOperationInputSchema,
      outputSchema: outputSchemaFor(ToolName.CommitAction),
    },
    async (input) =>
      runNetSuiteTool({
        toolName: ToolName.CommitAction,
        dependencies,
        input,
        execute: async () => {
          const identity = operationIdentity(dependencies)
          const replay = dependencies.operationStore.replayCommit(
            input.operationId,
            input.confirmation,
            identity,
          )
          if (replay !== null) {
            return replay
          }
          const plan = dependencies.operationStore.validateCommit(
            input.operationId,
            input.confirmation,
            identity,
          )
          const currentPreview = await previewOperation(dependencies, plan)
          if (snapshotFingerprint(currentPreview) !== plan.snapshotFingerprint) {
            throw new Error(
              "OPERATION_SOURCE_CHANGED: NetSuite source no longer matches the prepared plan",
            )
          }
          dependencies.operationStore.beginCommit(input.operationId, input.confirmation, identity)
          try {
            const result = await commitOperation(dependencies, plan)
            const committed = { ...result, operationId: plan.operationId, used: true }
            dependencies.operationStore.completeCommit(plan.operationId, committed)
            return committed
          } catch (error) {
            dependencies.operationStore.releaseCommit(plan.operationId)
            throw error
          }
        },
      }),
  )
}

async function previewOperation(
  dependencies: ToolDependencies,
  plan: OperationPlan,
): Promise<JsonObject> {
  if (plan.executor === "restlet") {
    return await dependencies.netsuite.runRestletAction({
      action: plan.action,
      phase: "preview",
      payload: plan.payload,
    })
  }
  if (plan.action === ToolName.CreateRecord) {
    return plan.preview
  }
  const type = requirePlanString(plan.payload, "type")
  const id = requirePlanString(plan.payload, "id")
  return {
    source: await dependencies.netsuite.getRecord({ type, id }),
    requestedValues: plan.payload["values"] ?? {},
  }
}

async function commitOperation(
  dependencies: ToolDependencies,
  plan: OperationPlan,
): Promise<JsonObject> {
  if (plan.executor === "restlet") {
    return await dependencies.netsuite.runRestletAction({
      action: plan.action,
      phase: "commit",
      payload: plan.payload,
    })
  }
  switch (plan.action) {
    case ToolName.CreateRecord:
      return await dependencies.netsuite.createRecord(RecordCreateRequestSchema.parse(plan.payload))
    case ToolName.UpdateRecord:
      return await dependencies.netsuite.updateRecord(RecordUpdateRequestSchema.parse(plan.payload))
    case ToolName.SubmitFields:
      return await dependencies.netsuite.submitFields(RecordUpdateRequestSchema.parse(plan.payload))
    case ToolName.DeleteRecord: {
      const type = requirePlanString(plan.payload, "type")
      const id = requirePlanString(plan.payload, "id")
      return await dependencies.netsuite.deleteRecord(
        RecordDeleteRequestSchema.parse({ type, id, confirmation: `delete:${type}:${id}` }),
      )
    }
    default:
      throw new Error(`Unsupported record operation: ${plan.action}`)
  }
}

function requirePlanString(payload: JsonObject, field: string): string {
  const value = payload[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function directActionPhase(toolName: ToolName): RestletAction["phase"] {
  if (readOnlyActionTools.has(toolName)) {
    return "preview"
  }
  return "prepare"
}

function createOperationPlan(
  dependencies: ToolDependencies,
  action: string,
  payload: JsonObject,
  preparation: JsonObject,
  preview: JsonObject,
): JsonObject {
  const restletConfirmation = preparation["confirmation"]
  let commitPayload =
    typeof restletConfirmation === "string" && payload["confirmation"] === undefined
      ? { ...payload, confirmation: restletConfirmation }
      : payload
  if (transformActionTools.has(action)) {
    commitPayload = {
      ...commitPayload,
      idempotencyKey: `supermcp-${action}-${randomUUID()}`,
    }
  }
  return dependencies.operationStore.create({
    action,
    ...operationMetadata(action, payload, preview, dependencies.config.netsuite.environment),
    payload: commitPayload,
    preview,
    snapshotFingerprint: snapshotFingerprint(preview),
    ...operationIdentity(dependencies),
    environment: dependencies.config.netsuite.environment,
  })
}

function operationMetadata(
  action: string,
  payload: JsonObject,
  preview: JsonObject,
  environment: "sandbox" | "production",
) {
  const source = operationSource(action, payload)
  const selectionValue = payload["selection"]
  const selection =
    typeof selectionValue === "object" && selectionValue !== null && !Array.isArray(selectionValue)
      ? (selectionValue as JsonObject)
      : { mode: "explicitPayload" }
  const sourceType = typeof source["type"] === "string" ? source["type"] : action
  const sourceId = typeof source["id"] === "string" ? source["id"] : "explicit payload"
  const targetType =
    typeof source["targetType"] === "string" ? source["targetType"] : "configured target"
  const selectionLabel = selection["mode"] === "allOpen" ? "all open lines" : "selected inputs"
  return {
    kind: action.startsWith("ns_") ? action.slice(3) : action,
    source,
    selection,
    impact: {
      summary: `Prepare ${targetType} from ${sourceType} ${sourceId} using ${selectionLabel}. No record was saved.`,
      details: preview,
    },
    warnings: [
      ...(environment === "production" ? ["This plan targets a production NetSuite account."] : []),
      ...(selection["mode"] === "allOpen"
        ? ["All currently open lines are explicitly selected; preview them before commit."]
        : []),
    ],
  }
}

function operationSource(action: string, payload: JsonObject): JsonObject {
  const definitions: Record<string, { idField: string; type: string; targetType: string }> = {
    [ToolName.FulfillSalesOrder]: {
      idField: "salesOrderId",
      type: "salesorder",
      targetType: "itemfulfillment",
    },
    [ToolName.InvoiceSalesOrder]: {
      idField: "salesOrderId",
      type: "salesorder",
      targetType: "invoice",
    },
    [ToolName.ReceivePurchaseOrder]: {
      idField: "purchaseOrderId",
      type: "purchaseorder",
      targetType: "itemreceipt",
    },
    [ToolName.BillPurchaseOrder]: {
      idField: "purchaseOrderId",
      type: "purchaseorder",
      targetType: "vendorbill",
    },
  }
  const definition = definitions[action]
  if (definition !== undefined) {
    return {
      type: definition.type,
      id: String(payload[definition.idField]),
      targetType: definition.targetType,
    }
  }
  if (action === ToolName.TransformRecord) {
    return {
      type: String(payload["fromType"]),
      id: String(payload["fromId"]),
      targetType: String(payload["toType"]),
    }
  }
  return { action, target: "explicit payload" }
}

async function prepareOperation(
  dependencies: ToolDependencies,
  action: string,
  payload: JsonObject,
): Promise<JsonObject> {
  const preparation = await dependencies.netsuite.runRestletAction({
    action,
    phase: "prepare",
    payload,
  })
  const preview = await dependencies.netsuite.runRestletAction({
    action,
    phase: "preview",
    payload,
  })
  return createOperationPlan(dependencies, action, payload, preparation, preview)
}

function operationIdentity(dependencies: ToolDependencies) {
  return {
    accountId: dependencies.config.netsuite.accountId,
    requester: dependencies.requester,
    client: dependencies.client,
  }
}

function committedTarget(result: JsonObject | undefined): JsonObject | undefined {
  const record = result?.["record"]
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return undefined
  }
  const target = record as JsonObject
  return typeof target["type"] === "string" && typeof target["id"] === "string" ? target : undefined
}

function normalizeDirectActionPayload(input: {
  readonly action?: string | undefined
  readonly payload?: JsonObject | undefined
  readonly [key: string]: JsonValue | JsonObject | undefined
}): JsonObject {
  if (input.payload !== undefined) {
    return input.payload
  }
  const payload: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key !== "action" && key !== "payload" && value !== undefined) {
      payload[key] = value as JsonValue
    }
  }
  return payload
}

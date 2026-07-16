import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { RestletAction } from "../netsuite/types"
import type { JsonObject, JsonValue } from "../shared/json"
import {
  CommitOperationInputSchema,
  GenericActionInputSchema,
  PrepareOperationInputSchema,
  PreviewOperationInputSchema,
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

export function registerActionTools(server: McpServer, dependencies: ToolDependencies): void {
  for (const toolName of actionTools) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: !readOnlyActionTools.has(toolName)
          ? `Prepares NetSuite action ${toolName} without saving a record. Commit the reviewed operation separately.`
          : `Runs NetSuite action ${toolName} through the RESTlet action layer.`,
        inputSchema: GenericActionInputSchema,
        outputSchema: outputSchemaFor(toolName),
      },
      async (input) =>
        runNetSuiteTool({
          toolName,
          dependencies,
          input,
          execute: async () => {
            const payload = normalizeDirectActionPayload(input)
            const phase = directActionPhase(toolName)
            const result = await dependencies.netsuite.runRestletAction({
              action: toolName,
              phase,
              payload,
            })
            if (phase !== "prepare") {
              return result
            }
            return createOperationPlan(dependencies, toolName, payload, result)
          },
        }),
    )
  }
  registerPrepareOperationTool(server, dependencies)
  registerPreviewOperationTool(server, dependencies)
  registerCommitOperationTool(server, dependencies)
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
        input,
        execute: async () => {
          const preview = await dependencies.netsuite.runRestletAction({
            action: input.action,
            phase: "prepare",
            payload: input.payload,
          })
          return createOperationPlan(dependencies, input.action, input.payload, preview)
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
          const plan = dependencies.operationStore.beginCommit(
            input.operationId,
            input.confirmation,
            operationIdentity(dependencies),
          )
          const result = await dependencies.netsuite.runRestletAction({
            action: plan.action,
            phase: "commit",
            payload: plan.payload,
          })
          return { ...result, operationId: plan.operationId, used: true }
        },
      }),
  )
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
  preview: JsonObject,
): JsonObject {
  const restletConfirmation = preview["confirmation"]
  const commitPayload =
    typeof restletConfirmation === "string" && payload["confirmation"] === undefined
      ? { ...payload, confirmation: restletConfirmation }
      : payload
  return dependencies.operationStore.create({
    action,
    payload: commitPayload,
    preview,
    ...operationIdentity(dependencies),
    environment: dependencies.config.netsuite.environment,
  })
}

function operationIdentity(dependencies: ToolDependencies) {
  return {
    accountId: dependencies.config.netsuite.accountId,
    requester: dependencies.requester,
    client: dependencies.client,
  }
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

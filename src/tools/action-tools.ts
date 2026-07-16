import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { RestletAction } from "../netsuite/types"
import type { JsonObject, JsonValue } from "../shared/json"
import { GenericActionInputSchema, RestletActionInputSchema, ToolName } from "./catalog"
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

const prepareOnlyActionTools = new Set<ToolName>([
  ToolName.TransformRecord,
  ToolName.FulfillSalesOrder,
  ToolName.InvoiceSalesOrder,
  ToolName.ReceivePurchaseOrder,
  ToolName.BillPurchaseOrder,
])

const phasedActionTools = [
  ToolName.PrepareAction,
  ToolName.PreviewAction,
  ToolName.CommitAction,
] as const

type PhasedActionToolName = (typeof phasedActionTools)[number]

const phaseByTool = {
  [ToolName.PrepareAction]: "prepare",
  [ToolName.PreviewAction]: "preview",
  [ToolName.CommitAction]: "commit",
} satisfies Record<PhasedActionToolName, RestletAction["phase"]>

export function registerActionTools(server: McpServer, dependencies: ToolDependencies): void {
  for (const toolName of actionTools) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: prepareOnlyActionTools.has(toolName)
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
          execute: () =>
            dependencies.netsuite.runRestletAction({
              action: toolName,
              phase: directActionPhase(toolName),
              payload: normalizeDirectActionPayload(input),
            }),
        }),
    )
  }

  for (const toolName of phasedActionTools) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: `Runs a generic ${toolName} request against the RESTlet action layer.`,
        inputSchema: RestletActionInputSchema,
        outputSchema: outputSchemaFor(toolName),
      },
      async (input) => {
        const action = normalizePhasedAction(toolName, input)
        return runNetSuiteTool({
          toolName,
          dependencies,
          input: action,
          execute: () => dependencies.netsuite.runRestletAction(action),
        })
      },
    )
  }
}

function directActionPhase(toolName: ToolName): RestletAction["phase"] {
  if (readOnlyActionTools.has(toolName)) {
    return "preview"
  }
  if (prepareOnlyActionTools.has(toolName)) {
    return "prepare"
  }
  return "commit"
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

function normalizePhasedAction(
  toolName: PhasedActionToolName,
  input: RestletAction,
): RestletAction {
  return { ...input, phase: phaseByTool[toolName] }
}

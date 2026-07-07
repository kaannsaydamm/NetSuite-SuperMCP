import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { RestletAction } from "../netsuite/types"
import {
  GenericActionInputSchema,
  RestletActionInputSchema,
  ToolName,
  toolPolicies,
} from "./catalog"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

const actionTools = [
  ToolName.RunSavedSearch,
  ToolName.RunReport,
  ToolName.GetFile,
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
        description: `Runs NetSuite action ${toolName} through the RESTlet action layer.`,
        inputSchema: GenericActionInputSchema,
      },
      async (input) =>
        runNetSuiteTool({
          toolName,
          dependencies,
          input,
          execute: () =>
            dependencies.netsuite.runRestletAction({
              action: toolName,
              phase: phaseForDirectAction(toolName),
              payload: input.payload,
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

function phaseForDirectAction(toolName: ToolName): "preview" | "commit" {
  return toolPolicies[toolName].requiresPreview ? "preview" : "commit"
}

function normalizePhasedAction(
  toolName: PhasedActionToolName,
  input: RestletAction,
): RestletAction {
  return { ...input, phase: phaseByTool[toolName] }
}

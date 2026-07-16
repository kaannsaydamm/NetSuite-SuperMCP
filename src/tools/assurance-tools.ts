import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  discoverProcess,
  discoverRules,
  evaluateInvariants,
  evaluatePolicyFacts,
  fieldWriteConflicts,
  previewGl,
  profileDataQuality,
  rankRootCauses,
  simulateAllocation,
  simulateDownstream,
  simulateInventory,
} from "../assurance/assurance"
import {
  DiscoverProcessInputSchema,
  DiscoverRulesInputSchema,
  EvaluateInvariantsInputSchema,
  EvaluatePolicyFactsInputSchema,
  FieldWriteConflictInputSchema,
  PreviewGlImpactInputSchema,
  ProfileDataQualityInputSchema,
  RankRootCausesInputSchema,
  SimulateChannelAllocationInputSchema,
  SimulateDownstreamImpactInputSchema,
  SimulateInventoryStateInputSchema,
  ValidateMasterDataInputSchema,
} from "../contracts/assurance-schemas"
import type { JsonObject } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerAssuranceTools(server: McpServer, dependencies: ToolDependencies): void {
  register(
    server,
    dependencies,
    ToolName.DiscoverProcess,
    DiscoverProcessInputSchema,
    discoverProcess,
  )
  register(
    server,
    dependencies,
    ToolName.DiscoverBusinessRules,
    DiscoverRulesInputSchema,
    discoverRules,
  )
  register(
    server,
    dependencies,
    ToolName.AnalyzeFieldWriteConflicts,
    FieldWriteConflictInputSchema,
    fieldWriteConflicts,
  )
  register(
    server,
    dependencies,
    ToolName.ProfileDataQuality,
    ProfileDataQualityInputSchema,
    profileDataQuality,
  )
  register(
    server,
    dependencies,
    ToolName.ValidateMasterData,
    ValidateMasterDataInputSchema,
    profileDataQuality,
  )
  register(
    server,
    dependencies,
    ToolName.EvaluateInvariants,
    EvaluateInvariantsInputSchema,
    evaluateInvariants,
  )
  register(
    server,
    dependencies,
    ToolName.EvaluatePolicyFacts,
    EvaluatePolicyFactsInputSchema,
    evaluatePolicyFacts,
  )
  register(
    server,
    dependencies,
    ToolName.SimulateDownstreamImpact,
    SimulateDownstreamImpactInputSchema,
    simulateDownstream,
  )
  register(server, dependencies, ToolName.PreviewGlImpact, PreviewGlImpactInputSchema, (input) => {
    if (input.operationId === undefined) return previewGl(input)
    const operation = dependencies.operationStore.preview(input.operationId, {
      accountId: dependencies.config.netsuite.accountId,
      requester: dependencies.requester,
      client: dependencies.client,
    })
    return previewGl(input, operation.impact)
  })
  register(
    server,
    dependencies,
    ToolName.SimulateInventoryState,
    SimulateInventoryStateInputSchema,
    simulateInventory,
  )
  register(
    server,
    dependencies,
    ToolName.SimulateChannelAllocation,
    SimulateChannelAllocationInputSchema,
    simulateAllocation,
  )
  register(server, dependencies, ToolName.RankRootCauses, RankRootCausesInputSchema, rankRootCauses)
}

function register<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  inputSchema: z.ZodType<T>,
  execute: (input: T) => unknown | Promise<unknown>,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description:
        "Analyzes explicit NetSuite evidence or runs an isolated, non-mutating business simulation.",
      inputSchema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input: T) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input: jsonObject(input),
        execute: async () => jsonObject(await execute(input)),
      }),
  )
}

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

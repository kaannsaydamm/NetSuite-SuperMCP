import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  BuildSupportEvidenceInputSchema,
  CorrelateIncidentsInputSchema,
  DefineRunbookInputSchema,
  EvidenceMemoryInputSchema,
  GenerateLiveDocumentationInputSchema,
  MeasureSlaInputSchema,
  PrepareBoundedRepairInputSchema,
  RecordEvidenceClaimInputSchema,
  RecordRunbookStepInputSchema,
  RepairProposalInputSchema,
  RunbookExecutionInputSchema,
  RunbookRefInputSchema,
  StartRunbookInputSchema,
} from "../contracts/runbook-schemas"
import { getToolContract, validateToolRequest } from "../contracts/tool-registry"
import {
  correlateIncidents,
  evidenceFingerprint,
  liveDocumentation,
  measureSla,
  repairProposal,
  supportEvidenceBundle,
} from "../runbooks/runbook"
import type { JsonObject, JsonValue } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerRunbookTools(server: McpServer, dependencies: ToolDependencies): void {
  register(
    server,
    dependencies,
    ToolName.DefineRunbook,
    DefineRunbookInputSchema,
    async (input) => {
      for (const step of input.steps) {
        const contract = getToolContract(step.toolName)
        const validation = validateToolRequest(contract.name, step.input)
        if (!validation.valid) throw new Error(`RUNBOOK_STEP_INPUT_INVALID: ${step.id}`)
        if (contract.mutatesNetSuite !== step.mutatesNetSuite)
          throw new Error(`RUNBOOK_STEP_MUTATION_MISMATCH: ${step.id}`)
      }
      return await dependencies.runbookStore.define(dependencies.requester, input)
    },
  )
  register(server, dependencies, ToolName.PreviewRunbook, RunbookRefInputSchema, async (input) => {
    const entry = await dependencies.runbookStore.getDefinition(
      dependencies.requester,
      input.runbookId,
      input.runbookVersion,
    )
    return {
      definition: entry.definition,
      definitionFingerprint: entry.fingerprint,
      steps: entry.definition.steps.map((step) => ({
        ...step,
        requiresPreview: step.mutatesNetSuite,
        requiresHarnessApproval: step.mutatesNetSuite,
        executesTool: false,
      })),
    }
  })
  register(
    server,
    dependencies,
    ToolName.StartRunbook,
    StartRunbookInputSchema,
    async (input) =>
      await dependencies.runbookStore.start(
        dependencies.requester,
        input.runbookId,
        input.runbookVersion,
        jsonValue(input.evidence),
      ),
  )
  register(
    server,
    dependencies,
    ToolName.GetRunbookExecution,
    RunbookExecutionInputSchema,
    async (input) =>
      await dependencies.runbookStore.getExecution(dependencies.requester, input.executionId),
  )
  register(
    server,
    dependencies,
    ToolName.RecordRunbookStep,
    RecordRunbookStepInputSchema,
    async (input) => await recordStep(dependencies, input),
  )
  register(server, dependencies, ToolName.ProposeRepair, RepairProposalInputSchema, (input) =>
    repairProposal(input, dependencies.config.lowRiskRepairClasses),
  )
  register(
    server,
    dependencies,
    ToolName.PrepareBoundedRepair,
    PrepareBoundedRepairInputSchema,
    (input) => {
      const proposal = repairProposal(input, dependencies.config.lowRiskRepairClasses)
      if (proposal.requiresOperationProtocol && input.operationId === undefined)
        return { ...proposal, readyForProviderExecution: false, reason: "operation plan required" }
      if (input.operationId !== undefined)
        dependencies.operationStore.preview(input.operationId, identity(dependencies))
      return {
        ...proposal,
        readyForProviderExecution: !proposal.proposalOnly,
        operationPlanValidated: input.operationId !== undefined,
      }
    },
  )
  register(
    server,
    dependencies,
    ToolName.CorrelateIncidents,
    CorrelateIncidentsInputSchema,
    correlateIncidents,
  )
  register(server, dependencies, ToolName.MeasureSla, MeasureSlaInputSchema, (input) =>
    measureSla(input.measurements),
  )
  register(
    server,
    dependencies,
    ToolName.BuildSupportEvidenceBundle,
    BuildSupportEvidenceInputSchema,
    supportEvidenceBundle,
  )
  register(
    server,
    dependencies,
    ToolName.GenerateLiveDocumentation,
    GenerateLiveDocumentationInputSchema,
    liveDocumentation,
  )
  register(
    server,
    dependencies,
    ToolName.RecordEvidenceClaim,
    RecordEvidenceClaimInputSchema,
    async (input) =>
      await dependencies.runbookStore.recordClaim(dependencies.requester, {
        claimId: input.claimId,
        statement: input.statement,
        confidence: input.confidence,
        evidence: jsonValue(input.evidence) as JsonValue[],
        ...(input.supersedesVersion === undefined
          ? {}
          : { supersedesVersion: input.supersedesVersion }),
      }),
  )
  register(
    server,
    dependencies,
    ToolName.GetEvidenceMemory,
    EvidenceMemoryInputSchema,
    async (input) => ({
      claims: await dependencies.runbookStore.claims(dependencies.requester, input.claimId),
    }),
  )
}

async function recordStep(
  dependencies: ToolDependencies,
  input: z.infer<typeof RecordRunbookStepInputSchema>,
) {
  const execution = await dependencies.runbookStore.getExecution(
    dependencies.requester,
    input.executionId,
  )
  if (execution.state !== "running") throw new Error("RUNBOOK_EXECUTION_NOT_RUNNING")
  const definition = await dependencies.runbookStore.getDefinition(
    dependencies.requester,
    execution.runbookId,
    execution.runbookVersion,
  )
  const step = definition.definition.steps[execution.nextStepIndex]
  if (step === undefined || step.id !== input.stepId) throw new Error("RUNBOOK_STEP_OUT_OF_ORDER")
  let operationId: string | undefined
  if (step.mutatesNetSuite) {
    if (
      input.operationId === undefined ||
      input.previewOutput === undefined ||
      input.expectedPreviewFingerprint === undefined
    )
      throw new Error("MUTATING_STEP_REQUIRES_OPERATION_PREVIEW")
    dependencies.operationStore.preview(input.operationId, identity(dependencies))
    operationId = input.operationId
    if (evidenceFingerprint(input.previewOutput) !== input.expectedPreviewFingerprint) {
      return await stopForChangedEvidence(
        dependencies,
        execution.id,
        execution.nextStepIndex,
        input,
      )
    }
  }
  const evidenceHash = evidenceFingerprint(jsonValue(input.observedEvidence))
  return await dependencies.runbookStore.updateExecution(
    dependencies.requester,
    execution.id,
    (current) => {
      const steps = current.steps.map((state, index) =>
        index === current.nextStepIndex
          ? {
              ...state,
              state: input.succeeded ? ("completed" as const) : ("failed" as const),
              evidenceFingerprint: evidenceHash,
              result: input.result,
              ...(operationId === undefined ? {} : { operationId }),
            }
          : state,
      )
      const nextStepIndex = current.nextStepIndex + 1
      return {
        ...current,
        steps,
        nextStepIndex,
        state: input.succeeded
          ? nextStepIndex >= steps.length
            ? "completed"
            : "running"
          : "failed",
      }
    },
  )
}

async function stopForChangedEvidence(
  dependencies: ToolDependencies,
  executionId: string,
  stepIndex: number,
  input: z.infer<typeof RecordRunbookStepInputSchema>,
) {
  return await dependencies.runbookStore.updateExecution(
    dependencies.requester,
    executionId,
    (current) => ({
      ...current,
      state: "stopped",
      steps: current.steps.map((step, index) =>
        index === stepIndex
          ? {
              ...step,
              state: "stopped",
              evidenceFingerprint: evidenceFingerprint(input.previewOutput as JsonValue),
              result: { reason: "preview evidence changed" },
            }
          : step,
      ),
    }),
  )
}

function identity(dependencies: ToolDependencies) {
  return {
    accountId: dependencies.config.netsuite.accountId,
    requester: dependencies.requester,
    client: dependencies.client,
  }
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
        "Defines and records auditable runbooks, bounded repair proposals, incidents, evidence, or documentation.",
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

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

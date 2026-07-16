import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  AckOutboxInputSchema,
  AnonymizePayloadInputSchema,
  CanaryInputSchema,
  CanaryMonitorInputSchema,
  CanaryPrepareInputSchema,
  DefineIntegrationContractInputSchema,
  EmitIntegrationEventInputSchema,
  IntegrationHealthInputSchema,
  PollOutboxInputSchema,
  ReconcileRecordsInputSchema,
  RegressionSuiteInputSchema,
  ReplayPayloadInputSchema,
  ShadowPayloadInputSchema,
  SubscribeIntegrationEventsInputSchema,
  SyntheticTransactionsInputSchema,
  ValidateIntegrationContractInputSchema,
} from "../contracts/integration-schemas"
import {
  anonymizeRecords,
  groupIncidents,
  reconcileRecords,
  syntheticTransactions,
  validateContractRecords,
} from "../integrations/reconciliation"
import type { JsonObject, JsonValue } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerIntegrationTools(server: McpServer, dependencies: ToolDependencies): void {
  registerLocal(
    server,
    dependencies,
    ToolName.GetIntegrationHealth,
    IntegrationHealthInputSchema,
    (input) => ({
      integrationId: input.integrationId,
      counts: { processed: input.processed, pending: input.pending, failed: input.failed },
      outputState: input.outputState,
      incidents: groupIncidents(input.errors as JsonObject[]),
    }),
  )
  registerLocal(
    server,
    dependencies,
    ToolName.DefineIntegrationContract,
    DefineIntegrationContractInputSchema,
    async (input) =>
      await dependencies.integrationStore.defineContract(dependencies.requester, input),
  )
  registerLocal(
    server,
    dependencies,
    ToolName.ValidateIntegrationContract,
    ValidateIntegrationContractInputSchema,
    (input) => validateContractRecords(input.contract, input.records),
  )

  for (const [toolName, domain] of reconciliationTools) {
    registerLocal(server, dependencies, toolName, ReconcileRecordsInputSchema, (input) =>
      reconcileRecords({ ...input, domain }),
    )
  }

  registerShadowTool(server, dependencies, ToolName.ShadowPayload, ShadowPayloadInputSchema)
  registerShadowTool(server, dependencies, ToolName.ReplayPayload, ReplayPayloadInputSchema)

  registerLocal(
    server,
    dependencies,
    ToolName.PrepareCanary,
    CanaryPrepareInputSchema,
    async (input) => {
      if (input.operationIds.length > input.maxRecords)
        throw new Error("CANARY_MAX_RECORDS_EXCEEDED")
      for (const operationId of input.operationIds)
        requirePreparedOperation(dependencies, operationId)
      return await dependencies.integrationStore.prepareCanary(dependencies.requester, input)
    },
  )
  registerLocal(
    server,
    dependencies,
    ToolName.MonitorCanary,
    CanaryMonitorInputSchema,
    async (input) =>
      await dependencies.integrationStore.updateCanary(
        dependencies.requester,
        input.canaryId,
        (canary) => {
          const failed = input.observations.some((entry) => entry.outcome === "fail")
          const passed =
            input.observations.length === canary.operationIds.length &&
            input.observations.every((entry) => entry.outcome === "pass")
          return {
            ...canary,
            state: failed ? "aborted" : passed ? "promotionReady" : "monitoring",
            observations: input.observations,
          }
        },
      ),
  )
  registerLocal(server, dependencies, ToolName.PromoteCanary, CanaryInputSchema, async (input) => {
    const canary = await dependencies.integrationStore.getCanary(
      dependencies.requester,
      input.canaryId,
    )
    if (canary.state !== "promotionReady") throw new Error("CANARY_NOT_READY")
    const plans = canary.operationIds.map((operationId) =>
      requirePreparedOperation(dependencies, operationId),
    )
    return {
      canaryId: canary.id,
      state: "promotionReady",
      operationIds: plans.map((plan) => plan.operationId),
      requiresHarnessApproval: true,
      commitTool: ToolName.CommitAction,
      committed: false,
    }
  })
  registerLocal(
    server,
    dependencies,
    ToolName.AbortCanary,
    CanaryInputSchema,
    async (input) =>
      await dependencies.integrationStore.updateCanary(
        dependencies.requester,
        input.canaryId,
        (canary) => ({
          ...canary,
          state: "aborted",
        }),
      ),
  )

  registerLocal(
    server,
    dependencies,
    ToolName.GenerateSyntheticTransactions,
    SyntheticTransactionsInputSchema,
    (input) => ({
      records: syntheticTransactions(input.count, input.seed, input.template, input.sequenceFields),
      generated: input.count,
      writesDisabled: true,
    }),
  )
  registerLocal(
    server,
    dependencies,
    ToolName.AnonymizePayload,
    AnonymizePayloadInputSchema,
    (input) => ({
      records: anonymizeRecords(input.records, input.fields, input.salt),
      fields: input.fields,
    }),
  )
  registerLocal(
    server,
    dependencies,
    ToolName.GenerateRegressionTests,
    RegressionSuiteInputSchema,
    (input) => ({ ...input, generated: true, writesDisabled: true }),
  )
  registerLocal(
    server,
    dependencies,
    ToolName.RunRegressionTests,
    RegressionSuiteInputSchema,
    async (input) => ({
      name: input.name,
      writesDisabled: true,
      results: await Promise.all(
        input.cases.map(async (testCase) => {
          const actual = await dependencies.netsuite.runRestletAction({
            action: testCase.action,
            phase: "preview",
            payload: testCase.payload,
          })
          const mismatches = Object.entries(testCase.expectedFields).filter(
            ([field, value]) => JSON.stringify(actual[field]) !== JSON.stringify(value),
          )
          return { id: testCase.id, passed: mismatches.length === 0, actual, mismatches }
        }),
      ),
    }),
  )

  registerLocal(
    server,
    dependencies,
    ToolName.SubscribeIntegrationEvents,
    SubscribeIntegrationEventsInputSchema,
    async (input) =>
      await dependencies.integrationStore.subscribe(dependencies.requester, {
        id: input.subscriptionId,
        eventTypes: input.eventTypes,
        endpoint: input.endpoint,
      }),
  )
  registerLocal(
    server,
    dependencies,
    ToolName.EmitIntegrationEvent,
    EmitIntegrationEventInputSchema,
    async (input) => await dependencies.integrationStore.emit(dependencies.requester, input),
  )
  registerLocal(
    server,
    dependencies,
    ToolName.PollIntegrationOutbox,
    PollOutboxInputSchema,
    async (input) => ({
      events: await dependencies.integrationStore.poll(dependencies.requester, input.limit),
      deliveryOwnedByProvider: true,
    }),
  )
  registerLocal(
    server,
    dependencies,
    ToolName.AckIntegrationEvent,
    AckOutboxInputSchema,
    async (input) =>
      await dependencies.integrationStore.acknowledge(
        dependencies.requester,
        input.eventId,
        input.delivered,
      ),
  )
}

const reconciliationTools = [
  [ToolName.ReconcileRecords, "generic"],
  [ToolName.ReconcileOrders, "orders"],
  [ToolName.ReconcileInventory, "inventory"],
  [ToolName.ReconcileReturns, "returns"],
  [ToolName.ReconcilePayments, "payments"],
] as const

function registerShadowTool<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  inputSchema: z.ZodType<T>,
): void {
  registerLocal(server, dependencies, toolName, inputSchema, async (input) => {
    const request = input as z.infer<typeof ReplayPayloadInputSchema>
    if (
      "mode" in request &&
      request.mode === "sandbox" &&
      dependencies.config.netsuite.environment !== "sandbox"
    ) {
      throw new Error("SANDBOX_REPLAY_REQUIRES_SANDBOX_ACCOUNT")
    }
    const preview = await dependencies.netsuite.runRestletAction({
      action: request.action,
      phase: "preview",
      payload: request.payload,
    })
    return { mode: "mode" in request ? request.mode : "shadow", writesDisabled: true, preview }
  })
}

function registerLocal<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  inputSchema: z.ZodType<T>,
  execute: (input: T) => JsonValue | Promise<JsonValue>,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description: "Runs a typed integration analysis or provider-controlled orchestration step.",
      inputSchema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input: T) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input: JSON.parse(JSON.stringify(input)) as JsonObject,
        execute: async () => (await execute(input)) as JsonObject,
      }),
  )
}

function requirePreparedOperation(dependencies: ToolDependencies, operationId: string) {
  return dependencies.operationStore.preview(operationId, {
    accountId: dependencies.config.netsuite.accountId,
    requester: dependencies.requester,
    client: dependencies.client,
  })
}

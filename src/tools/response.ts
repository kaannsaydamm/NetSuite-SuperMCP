import { assertRequestScope, redactForHarness } from "../harness/context"
import { authorizeTool } from "../policy"
import { createRequestId, type ErrorEnvelope, toErrorEnvelope } from "../shared/error-envelope"
import type { JsonObject } from "../shared/json"
import type { ToolName } from "./catalog"
import { toolPolicies } from "./catalog"
import type { ToolDependencies, ToolResponse } from "./types"

export type NetSuiteToolRequest = {
  readonly toolName: ToolName
  readonly dependencies: ToolDependencies
  readonly input: JsonObject
  readonly execute: () => Promise<JsonObject>
}

export async function runNetSuiteTool(request: NetSuiteToolRequest): Promise<ToolResponse> {
  const { toolName, dependencies, input, execute } = request
  const requestId = createRequestId()
  const policy = toolPolicies[toolName]
  authorizeTool(policy)
  if (!dependencies.allowedToolNames.has(toolName)) throw new Error("HARNESS_TOOL_NOT_ALLOWED")
  assertRequestScope(dependencies.harnessContext, input)
  const started = performance.now()

  try {
    await dependencies.harnessBudgetStore.reserve(dependencies.harnessContext, input)
    const result = await execute()
    const responseResult = await withHarnessMetadata(dependencies, { ...result, requestId }, policy)
    await writeAudit({
      dependencies,
      toolName,
      input,
      result: responseResult,
      status: "succeeded",
      requestId,
    })
    return toolText(responseResult)
  } catch (error) {
    const envelope = toErrorEnvelope(error, requestId)
    const auditEnvelope = JSON.parse(JSON.stringify(envelope)) as JsonObject
    await writeAudit({
      dependencies,
      toolName,
      input,
      result: auditEnvelope,
      status: "failed",
      requestId,
    })
    return toolError(envelope)
  } finally {
    await dependencies.harnessBudgetStore.recordRuntime(
      dependencies.harnessContext,
      performance.now() - started,
    )
  }
}

export async function respond(
  toolName: ToolName,
  dependencies: ToolDependencies,
  input: JsonObject,
  result: JsonObject,
): Promise<ToolResponse> {
  const requestId = createRequestId()
  if (!dependencies.allowedToolNames.has(toolName)) throw new Error("HARNESS_TOOL_NOT_ALLOWED")
  assertRequestScope(dependencies.harnessContext, input)
  const started = performance.now()
  await dependencies.harnessBudgetStore.reserve(dependencies.harnessContext, input)
  const responseResult = await withHarnessMetadata(
    dependencies,
    { ...result, requestId },
    toolPolicies[toolName],
  )
  await writeAudit({
    dependencies,
    toolName,
    input,
    result: responseResult,
    status: "succeeded",
    requestId,
  })
  await dependencies.harnessBudgetStore.recordRuntime(
    dependencies.harnessContext,
    performance.now() - started,
  )
  return toolText(responseResult)
}

async function withHarnessMetadata(
  dependencies: ToolDependencies,
  result: JsonObject,
  policy: { readonly risk: string; readonly mutatesNetSuite: boolean },
): Promise<JsonObject> {
  const context = dependencies.harnessContext
  const operationId = typeof result["operationId"] === "string" ? result["operationId"] : undefined
  const decision = context?.approvals.decisions.find((entry) => entry.operationId === operationId)
  const serializable = JSON.parse(
    JSON.stringify({
      ...result,
      harness: {
        profile: context?.profile ?? "operations",
        budget: await dependencies.harnessBudgetStore.status(context),
        sensitivity: context?.sensitivity ?? { piiFields: [], piiMode: "redact" },
        approval: {
          required:
            context?.approvals.requiredForRisks.includes(
              policy.risk as "low" | "medium" | "high" | "critical",
            ) ?? false,
          decision: decision?.decision ?? "not-supplied",
          approverRef: decision?.approverRef ?? null,
          callbackUrl: context?.approvals.callbackUrl ?? null,
          interactionOwner: "provider-or-harness",
        },
      },
    }),
  ) as JsonObject
  return redactForHarness(context, serializable) as JsonObject
}

type AuditWriteRequest = {
  readonly dependencies: ToolDependencies
  readonly toolName: ToolName
  readonly input: JsonObject
  readonly result: JsonObject
  readonly status: "blocked" | "succeeded" | "failed"
  readonly requestId: string
}

async function writeAudit(request: AuditWriteRequest): Promise<void> {
  const policy = toolPolicies[request.toolName]
  await request.dependencies.auditLog.write({
    timestamp: new Date().toISOString(),
    status: request.status,
    toolName: request.toolName,
    risk: policy.risk,
    environment: request.dependencies.config.netsuite.environment,
    requester: request.dependencies.requester,
    client: request.dependencies.client,
    requestId: request.requestId,
    input: request.input,
    result: request.result,
  })
}

function toolText(value: JsonObject): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

function toolError(envelope: ErrorEnvelope): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }], isError: true }
}

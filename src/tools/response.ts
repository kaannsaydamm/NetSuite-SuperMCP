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
  const started = performance.now()

  try {
    const result = await execute()
    const responseResult = { ...result, requestId }
    await writeAudit({
      dependencies,
      toolName,
      input,
      result: responseResult,
      status: "succeeded",
      requestId,
      durationMs: performance.now() - started,
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
      durationMs: performance.now() - started,
    })
    return toolError(envelope)
  }
}

export async function respond(
  toolName: ToolName,
  dependencies: ToolDependencies,
  input: JsonObject,
  result: JsonObject,
): Promise<ToolResponse> {
  const requestId = createRequestId()
  const started = performance.now()
  const responseResult = { ...result, requestId }
  await writeAudit({
    dependencies,
    toolName,
    input,
    result: responseResult,
    status: "succeeded",
    requestId,
    durationMs: performance.now() - started,
  })
  return toolText(responseResult)
}

type AuditWriteRequest = {
  readonly dependencies: ToolDependencies
  readonly toolName: ToolName
  readonly input: JsonObject
  readonly result: JsonObject
  readonly status: "blocked" | "succeeded" | "failed"
  readonly requestId: string
  readonly durationMs: number
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
    durationMs: request.durationMs,
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

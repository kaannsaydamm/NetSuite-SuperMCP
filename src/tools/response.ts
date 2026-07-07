import { authorizeTool } from "../policy"
import type { JsonObject, JsonValue } from "../shared/json"
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
  const policy = toolPolicies[toolName]
  const allowed = authorizeTool(policy, {
    environment: dependencies.config.netsuite.environment,
    productionWritesEnabled: dependencies.config.productionWritesEnabled,
  })

  if (!allowed.ok) {
    await writeAudit({
      dependencies,
      toolName,
      input,
      result: { reason: allowed.error.reason },
      status: "blocked",
    })
    return toolError(allowed.error.message)
  }

  try {
    const result = await execute()
    await writeAudit({ dependencies, toolName, input, result, status: "succeeded" })
    return toolText(result)
  } catch (error) {
    const result = { error: error instanceof Error ? error.message : "Unknown NetSuite error" }
    await writeAudit({ dependencies, toolName, input, result, status: "failed" })
    return toolError(result.error)
  }
}

export async function respond(
  toolName: ToolName,
  dependencies: ToolDependencies,
  input: JsonObject,
  result: JsonObject,
): Promise<ToolResponse> {
  await writeAudit({ dependencies, toolName, input, result, status: "succeeded" })
  return toolText(result)
}

type AuditWriteRequest = {
  readonly dependencies: ToolDependencies
  readonly toolName: ToolName
  readonly input: JsonObject
  readonly result: JsonObject
  readonly status: "blocked" | "succeeded" | "failed"
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
    input: request.input,
    result: request.result,
  })
}

function toolText(value: JsonValue): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }
}

function toolError(message: string): ToolResponse {
  return { content: [{ type: "text", text: message }], isError: true }
}

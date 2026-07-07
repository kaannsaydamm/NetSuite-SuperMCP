import type { NetSuiteEnvironment } from "./config"
import { PolicyError } from "./shared/errors"
import type { Result } from "./shared/result"
import { err, ok } from "./shared/result"

export const ToolRisk = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical",
} as const

export type ToolRisk = (typeof ToolRisk)[keyof typeof ToolRisk]

export type ToolPolicy = {
  readonly toolName: string
  readonly risk: ToolRisk
  readonly mutatesNetSuite: boolean
  readonly requiresPreview: boolean
}

export type PolicyContext = {
  readonly environment: NetSuiteEnvironment
  readonly productionWritesEnabled: boolean
}

export function authorizeTool(
  policy: ToolPolicy,
  context: PolicyContext,
): Result<ToolPolicy, PolicyError> {
  if (
    policy.mutatesNetSuite &&
    context.environment === "production" &&
    !context.productionWritesEnabled
  ) {
    return err(new PolicyError(`${policy.toolName} is blocked: production writes are locked`))
  }

  if (policy.risk === ToolRisk.Critical && !policy.requiresPreview) {
    return err(new PolicyError(`${policy.toolName} is critical and must require preview`))
  }

  return ok(policy)
}

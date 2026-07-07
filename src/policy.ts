import type { Result } from "./shared/result"
import { ok } from "./shared/result"

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
}

export function authorizeTool(policy: ToolPolicy): Result<ToolPolicy, never> {
  return ok(policy)
}

import { describe, expect, it } from "bun:test"
import { authorizeTool, type ToolPolicy, ToolRisk } from "../src/policy"

const mutableHighRiskTool = {
  toolName: "ns_billPurchaseOrder",
  risk: ToolRisk.High,
  mutatesNetSuite: true,
  requiresPreview: true,
} satisfies ToolPolicy

describe("authorizeTool", () => {
  it("allows a sandbox action when the tool policy is valid", () => {
    // Given
    const context = { environment: "sandbox", productionWritesEnabled: false } as const

    // When
    const result = authorizeTool(mutableHighRiskTool, context)

    // Then
    expect(result.ok).toBe(true)
  })

  it("blocks production writes when production writes are locked", () => {
    // Given
    const context = { environment: "production", productionWritesEnabled: false } as const

    // When
    const result = authorizeTool(mutableHighRiskTool, context)

    // Then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toContain("production writes are locked")
    }
  })

  it("blocks critical tools that do not require preview", () => {
    // Given
    const policy = {
      toolName: "ns_deployToProduction",
      risk: ToolRisk.Critical,
      mutatesNetSuite: true,
      requiresPreview: false,
    } satisfies ToolPolicy
    const context = { environment: "sandbox", productionWritesEnabled: true } as const

    // When
    const result = authorizeTool(policy, context)

    // Then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toContain("must require preview")
    }
  })
})

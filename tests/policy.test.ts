import { describe, expect, it } from "bun:test"
import { authorizeTool, type ToolPolicy, ToolRisk } from "../src/policy"

const mutableHighRiskTool = {
  toolName: "ns_billPurchaseOrder",
  risk: ToolRisk.High,
  mutatesNetSuite: true,
} satisfies ToolPolicy

describe("authorizeTool", () => {
  it("returns tool metadata without blocking execution", () => {
    // Given
    const criticalTool = {
      toolName: "ns_deployToProduction",
      risk: ToolRisk.Critical,
      mutatesNetSuite: true,
    } satisfies ToolPolicy

    // When
    const highRiskResult = authorizeTool(mutableHighRiskTool)
    const criticalResult = authorizeTool(criticalTool)

    // Then
    expect(highRiskResult).toEqual({ ok: true, value: mutableHighRiskTool })
    expect(criticalResult).toEqual({ ok: true, value: criticalTool })
  })
})

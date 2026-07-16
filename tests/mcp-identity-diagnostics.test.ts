import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import type { OAuthControl } from "../src/netsuite/oauth"
import type { RestletAction, SuiteQlRequest } from "../src/netsuite/types"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

class IdentityDiagnosticClient extends FakeNetSuiteClient {
  constructor(
    readonly roleName: string,
    readonly visibleCounts: Readonly<Record<string, number>>,
  ) {
    super()
  }

  override async runRestletAction(action: RestletAction): Promise<JsonObject> {
    this.actions.push(action)
    if (action.action === ToolName.CheckAccountPermissions) {
      return {
        accountId: "1234567_SB1",
        currentUser: { id: "7", name: "Example User", role: this.roleName, roleId: "3" },
      }
    }
    if (action.action === "ns_getRoleDiagnosticContext") {
      const names = action.payload["permissions"]
      return {
        permissions: Array.isArray(names)
          ? names.map((name) => ({ name, level: name === "EDIT_CUSTOMER" ? 4 : 2, allowed: true }))
          : [],
      }
    }
    if (action.action === ToolName.GetLoginAuditTrail) {
      return { entries: [{ status: "Success", user: "Example User" }], truncated: false }
    }
    return { action: action.action, phase: action.phase, ok: true }
  }

  override async runSuiteQl(request: SuiteQlRequest): Promise<JsonObject> {
    const family = Object.keys(this.visibleCounts).find((name) =>
      request.query.toLowerCase().includes(`from ${name}`),
    )
    return { count: family === undefined ? 0 : (this.visibleCounts[family] ?? 0) }
  }
}

class FakeOAuthControl implements OAuthControl {
  revoked = false
  hasCachedAccessToken(): boolean {
    return true
  }
  clearCache(): void {}
  async revokeRefreshToken(): Promise<void> {
    this.revoked = true
  }
}

describe("MCP identity diagnostics", () => {
  it("diagnoses the configured OAuth profile without exposing credentials", async () => {
    const client = new IdentityDiagnosticClient("Administrator", { customer: 12 })
    const app = createApp(testConfig(), { netsuite: client })

    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: { name: ToolName.DiagnoseAuthentication, arguments: { profile: "current" } },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    expect(payload).toMatchObject({
      profile: "current",
      accountId: "1234567_SB1",
      configured: true,
      authenticated: true,
      classification: "healthy",
    })
    expect(JSON.stringify(payload)).not.toContain("consumer-key")
    expect(JSON.stringify(payload)).not.toContain("cGVt")
  })

  it("measures effective role visibility with bounded count probes", async () => {
    const client = new IdentityDiagnosticClient("Administrator", { customer: 12, vendor: 4 })
    const app = createApp(testConfig(), { netsuite: client })

    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: {
        name: ToolName.AnalyzeRoleAccess,
        arguments: { profile: "current", recordFamilies: ["customer", "vendor"] },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    expect(payload.identity.role).toBe("Administrator")
    expect(payload.visibility).toEqual([
      { recordFamily: "customer", visibleCount: 12, allowed: true },
      { recordFamily: "vendor", visibleCount: 4, allowed: true },
    ])
  })

  it("compares current and explicitly configured management identities", async () => {
    const current = new IdentityDiagnosticClient("Sales", { customer: 5 })
    const management = new IdentityDiagnosticClient("Administrator", { customer: 12 })
    const app = createApp(testConfig(), { netsuite: current, managementNetsuite: management })

    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 102,
      method: "tools/call",
      params: {
        name: ToolName.CompareRoleVisibility,
        arguments: { recordFamilies: ["customer"] },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    expect(payload.matrix[0]).toEqual({
      recordFamily: "customer",
      currentVisibleCount: 5,
      managementVisibleCount: 12,
      difference: 7,
    })
  })

  it("reads login audit and evaluates caller-supplied segregation-of-duties groups", async () => {
    const client = new IdentityDiagnosticClient("Administrator", { customer: 12 })
    const app = createApp(testConfig(), { netsuite: client })

    const loginResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 103,
      method: "tools/call",
      params: {
        name: ToolName.GetLoginAuditTrail,
        arguments: { profile: "current", status: "success", limit: 10 },
      },
    })
    const login = JSON.parse(
      ToolTextResponseSchema.parse(await loginResponse.json()).result.content[0].text,
    )
    expect(login).toMatchObject({ count: 1, truncated: false })

    const sodResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 104,
      method: "tools/call",
      params: {
        name: ToolName.AnalyzeSegregationOfDuties,
        arguments: {
          profile: "current",
          permissionGroups: [
            {
              name: "Customer create and payment",
              permissions: ["EDIT_CUSTOMER", "CUSTOMER_PAYMENT"],
            },
          ],
        },
      },
    })
    const sod = JSON.parse(
      ToolTextResponseSchema.parse(await sodResponse.json()).result.content[0].text,
    )
    expect(sod.conflicts[0].name).toBe("Customer create and payment")
  })

  it("revokes only the explicitly confirmed OAuth profile", async () => {
    const client = new IdentityDiagnosticClient("Administrator", {})
    const oauth = new FakeOAuthControl()
    const app = createApp(testConfig(), { netsuite: client, oauthControl: oauth })

    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 105,
      method: "tools/call",
      params: {
        name: ToolName.RevokeOAuthAuthorization,
        arguments: {
          profile: "current",
          confirmation: "revoke:current:1234567_SB1",
        },
      },
    })
    const payload = JSON.parse(
      ToolTextResponseSchema.parse(await response.json()).result.content[0].text,
    )
    expect(payload).toMatchObject({ revoked: true, localCacheCleared: true })
    expect(oauth.revoked).toBe(true)
  })
})

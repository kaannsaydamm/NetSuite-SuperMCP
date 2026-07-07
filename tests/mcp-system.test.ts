import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import {
  CapabilitiesPayloadSchema,
  initializeRequest,
  mcpCall,
  ToolTextResponseSchema,
} from "./mcp-support"
import { FakeNetSuiteClient, tempAuditPath, testConfig } from "./test-support"

describe("MCP system tools", () => {
  it("rejects unauthenticated MCP requests", async () => {
    // Given
    const app = createApp(testConfig())

    // When
    const response = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(initializeRequest),
    })

    // Then
    expect(response.status).toBe(401)
  })

  it("lists the MVP tool catalog over MCP", async () => {
    // Given
    const app = createApp(testConfig(), { netsuite: new FakeNetSuiteClient() })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })
    const body = await response.json()

    // Then
    expect(response.status).toBe(200)
    expect(JSON.stringify(body)).toContain(ToolName.GetEnvironment)
    expect(JSON.stringify(body)).toContain(ToolName.GetAuditLog)
    expect(JSON.stringify(body)).toContain(ToolName.ListCapabilities)
    expect(JSON.stringify(body)).toContain(ToolName.BillPurchaseOrder)
  })

  it("returns risk metadata through ns_listCapabilities", async () => {
    // Given
    const app = createApp(testConfig(), { netsuite: new FakeNetSuiteClient() })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: ToolName.ListCapabilities,
        arguments: {},
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = CapabilitiesPayloadSchema.parse(JSON.parse(body.result.content[0].text))
    const billPurchaseOrder = payload.tools.find((tool) => tool.name === ToolName.BillPurchaseOrder)

    // Then
    expect(response.status).toBe(200)
    expect(billPurchaseOrder).toEqual({
      name: ToolName.BillPurchaseOrder,
      risk: "high",
      mutatesNetSuite: true,
      requiresPreview: true,
    })
  })

  it("routes metadata reads through the REST metadata client", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: ToolName.GetRecordMetadata,
        arguments: { type: "salesOrder", mediaType: "application/schema+json" },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.metadataRequests).toEqual([
      { type: "salesOrder", select: [], mediaType: "application/schema+json" },
    ])
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("routes transaction line reads through REST subresources", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: ToolName.GetTransactionLines,
        arguments: { type: "salesOrder", id: "123", sublist: "item" },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.transactionLineRequests).toEqual([
      { type: "salesOrder", id: "123", sublist: "item" },
    ])
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("returns recent audit events through ns_getAuditLog", async () => {
    // Given
    const auditLogPath = await tempAuditPath()
    const app = createApp(testConfig({ auditLogPath }), { netsuite: new FakeNetSuiteClient() })
    await mcpCall(app, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: ToolName.UpdateMapping,
        arguments: { action: "mapping", payload: { token: "secret", mappingId: "1" } },
      },
    })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: ToolName.GetAuditLog,
        arguments: { limit: 5 },
      },
    })
    const body = await response.json()
    const text = JSON.stringify(body)

    // Then
    expect(response.status).toBe(200)
    expect(text).toContain(ToolName.UpdateMapping)
    expect(text).toContain("[REDACTED]")
    expect(text).not.toContain("secret")
  })
})

import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall } from "./mcp-support"
import { FakeNetSuiteClient, tempAuditPath, testConfig } from "./test-support"

describe("MCP NetSuite actions", () => {
  it("routes record creation through the REST record client", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: ToolName.CreateRecord,
        arguments: { type: "customer", values: { companyName: "Acme" } },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.createdRecords).toEqual([
      { type: "customer", values: { companyName: "Acme" } },
    ])
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("routes record updates through the REST record client", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: ToolName.UpdateRecord,
        arguments: { type: "customer", id: "123", values: { email: "buyer@example.com" } },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.updatedRecords).toEqual([
      { type: "customer", id: "123", values: { email: "buyer@example.com" } },
    ])
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("routes submit fields through the REST record client", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: ToolName.SubmitFields,
        arguments: { type: "customer", id: "123", values: { phone: "555-0100" } },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.submittedFields).toEqual([
      { type: "customer", id: "123", values: { phone: "555-0100" } },
    ])
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("routes confirmed record deletes through the REST record client", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: ToolName.DeleteRecord,
        arguments: { type: "customer", id: "123", confirmation: "delete:customer:123" },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.deletedRecords).toEqual([
      { type: "customer", id: "123", confirmation: "delete:customer:123" },
    ])
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("rejects record deletes without matching confirmation", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: ToolName.DeleteRecord,
        arguments: { type: "customer", id: "123", confirmation: "delete:vendor:123" },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(JSON.stringify(await response.json())).toContain("confirmation must match")
    expect(fakeNetSuite.deletedRecords).toHaveLength(0)
  })

  it("blocks production mutating tools before NetSuite execution", async () => {
    // Given
    const auditLogPath = await tempAuditPath()
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(
      testConfig({
        auditLogPath,
        netsuite: {
          ...testConfig().netsuite,
          environment: "production",
        },
      }),
      { netsuite: fakeNetSuite },
    )

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: ToolName.BillPurchaseOrder,
        arguments: { action: "bill", payload: { purchaseOrderId: "123" } },
      },
    })
    const body = await response.json()
    const auditContent = await readFile(auditLogPath, "utf8")

    // Then
    expect(response.status).toBe(200)
    expect(JSON.stringify(body)).toContain("production writes are locked")
    expect(auditContent).toContain('"status":"blocked"')
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("routes high-risk direct action tools to preview", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: ToolName.BillPurchaseOrder,
        arguments: { action: "bill", payload: { purchaseOrderId: "123" } },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: { purchaseOrderId: "123" },
      },
    ])
  })

  it("keeps explicit commit actions as commit requests", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: {
          action: ToolName.BillPurchaseOrder,
          phase: "commit",
          payload: { purchaseOrderId: "123" },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.BillPurchaseOrder,
        phase: "commit",
        payload: { purchaseOrderId: "123" },
      },
    ])
  })

  it("forces prepare action wrappers to prepare phase", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: ToolName.PrepareAction,
        arguments: {
          action: ToolName.BillPurchaseOrder,
          phase: "commit",
          payload: { purchaseOrderId: "123" },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.BillPurchaseOrder,
        phase: "prepare",
        payload: { purchaseOrderId: "123" },
      },
    ])
  })

  it("forces preview action wrappers to preview phase", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: ToolName.PreviewAction,
        arguments: {
          action: ToolName.BillPurchaseOrder,
          phase: "commit",
          payload: { purchaseOrderId: "123" },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: { purchaseOrderId: "123" },
      },
    ])
  })
})

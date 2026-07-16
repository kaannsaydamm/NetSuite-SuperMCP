import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
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

  it("routes production named mutations to prepare without creating a transaction", async () => {
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
    const auditContent = await readFile(auditLogPath, "utf8")

    // Then
    expect(response.status).toBe(200)
    expect(auditContent).toContain('"status":"succeeded"')
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.BillPurchaseOrder,
        phase: "prepare",
        payload: { purchaseOrderId: "123" },
      },
    ])
  })

  it("routes named transaction action tools to prepare", async () => {
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
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    // Then
    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      action: ToolName.BillPurchaseOrder,
      confirmation: expect.stringContaining(`commit:${ToolName.BillPurchaseOrder}:`),
      operationId: expect.any(String),
      phase: "prepare",
      used: false,
    })
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.BillPurchaseOrder,
        phase: "prepare",
        payload: { purchaseOrderId: "123" },
      },
    ])
  })

  it("commits exactly the server-side operation plan", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: ToolName.BillPurchaseOrder,
        arguments: { purchaseOrderId: "123" },
      },
    })
    const prepareBody = ToolTextResponseSchema.parse(await prepareResponse.json())
    const plan = JSON.parse(prepareBody.result.content[0].text)

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: {
          operationId: plan.operationId,
          confirmation: plan.confirmation,
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
      {
        action: ToolName.BillPurchaseOrder,
        phase: "commit",
        payload: { purchaseOrderId: "123" },
      },
    ])
  })

  it("rejects a second commit of the same operation plan", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: ToolName.BillPurchaseOrder,
        arguments: { purchaseOrderId: "123" },
      },
    })
    const prepareBody = ToolTextResponseSchema.parse(await prepareResponse.json())
    const plan = JSON.parse(prepareBody.result.content[0].text)
    const commitRequest = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: {
          operationId: plan.operationId,
          confirmation: plan.confirmation,
        },
      },
    }
    await mcpCall(app, { ...commitRequest, id: 31 })

    // When
    const secondResponse = await mcpCall(app, { ...commitRequest, id: 32 })

    // Then
    expect(JSON.stringify(await secondResponse.json())).toContain("has already been used")
    expect(fakeNetSuite.actions).toHaveLength(2)
  })

  it("rejects committing an operation prepared by another connection", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: ToolName.BillPurchaseOrder,
        arguments: { purchaseOrderId: "123" },
      },
    })
    const prepareBody = ToolTextResponseSchema.parse(await prepareResponse.json())
    const plan = JSON.parse(prepareBody.result.content[0].text)

    // When
    const response = await mcpCall(
      app,
      {
        jsonrpc: "2.0",
        id: 34,
        method: "tools/call",
        params: {
          name: ToolName.CommitAction,
          arguments: {
            operationId: plan.operationId,
            confirmation: plan.confirmation,
          },
        },
      },
      { requester: "other-user", client: "other-client" },
    )

    // Then
    expect(JSON.stringify(await response.json())).toContain("does not belong to this connection")
    expect(fakeNetSuite.actions).toHaveLength(1)
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

    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 24,
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
    const prepareBody = ToolTextResponseSchema.parse(await prepareResponse.json())
    const plan = JSON.parse(prepareBody.result.content[0].text)

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: ToolName.PreviewAction,
        arguments: { operationId: plan.operationId },
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
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: { purchaseOrderId: "123" },
      },
    ])
  })
})

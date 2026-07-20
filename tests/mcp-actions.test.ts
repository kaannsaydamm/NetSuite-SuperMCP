import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { createApp } from "../src/app"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
import { FakeNetSuiteClient, tempAuditPath, testConfig } from "./test-support"

class MutableOperationSnapshotClient extends FakeNetSuiteClient {
  status = "pendingFulfillment"

  override async runRestletAction(action: Parameters<FakeNetSuiteClient["runRestletAction"]>[0]) {
    await super.runRestletAction(action)
    if (action.phase === "preview") {
      return {
        action: action.action,
        phase: action.phase,
        snapshot: {
          status: this.status,
          lines: [{ line: 0, quantityRemaining: this.status === "pendingFulfillment" ? 2 : 0 }],
        },
      }
    }
    return { action: action.action, phase: action.phase, ok: true }
  }
}

class CommittedFulfillmentClient extends FakeNetSuiteClient {
  override async runRestletAction(action: Parameters<FakeNetSuiteClient["runRestletAction"]>[0]) {
    await super.runRestletAction(action)
    if (action.phase === "commit") {
      return {
        action: action.action,
        phase: action.phase,
        record: { type: "itemfulfillment", id: "900" },
      }
    }
    return {
      action: action.action,
      phase: action.phase,
      snapshot: { status: "pendingFulfillment" },
    }
  }
}

describe("MCP NetSuite actions", () => {
  it("rejects an unknown record type before creating an operation plan", async () => {
    const fakeNetSuite = new (class extends FakeNetSuiteClient {
      override async getRecordMetadata(
        request: Parameters<FakeNetSuiteClient["getRecordMetadata"]>[0],
      ) {
        if (request.type === "definitelyNotARealNetSuiteRecord") throw new Error("HTTP 404")
        return super.getRecordMetadata(request)
      }
    })()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: ToolName.CreateRecord,
        arguments: { type: "definitelyNotARealNetSuiteRecord", values: {} },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    expect(body.result.content[0]?.text).toContain("INVALID_RECORD_TYPE")
  })

  it("prepares record creation without calling the REST record client", async () => {
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
    const body = ToolTextResponseSchema.parse(await response.json())
    const plan = JSON.parse(body.result.content[0].text)
    expect(plan).toMatchObject({ action: ToolName.CreateRecord, phase: "prepare", used: false })
    expect(fakeNetSuite.createdRecords).toHaveLength(0)
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("prepares record updates from a source snapshot", async () => {
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
    const body = ToolTextResponseSchema.parse(await response.json())
    const plan = JSON.parse(body.result.content[0].text)
    expect(plan).toMatchObject({ action: ToolName.UpdateRecord, phase: "prepare", used: false })
    expect(fakeNetSuite.updatedRecords).toHaveLength(0)
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("prepares submit-fields updates from a source snapshot", async () => {
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
    const body = ToolTextResponseSchema.parse(await response.json())
    const plan = JSON.parse(body.result.content[0].text)
    expect(plan).toMatchObject({ action: ToolName.SubmitFields, phase: "prepare", used: false })
    expect(fakeNetSuite.submittedFields).toHaveLength(0)
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("prepares record deletion without deleting the record", async () => {
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
        arguments: { type: "customer", id: "123" },
      },
    })

    // Then
    expect(response.status).toBe(200)
    const body = ToolTextResponseSchema.parse(await response.json())
    const plan = JSON.parse(body.result.content[0].text)
    expect(plan).toMatchObject({ action: ToolName.DeleteRecord, phase: "prepare", used: false })
    expect(fakeNetSuite.deletedRecords).toHaveLength(0)
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("commits a prepared record deletion with the server-created confirmation", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: ToolName.DeleteRecord,
        arguments: { type: "customer", id: "123" },
      },
    })
    const prepareBody = ToolTextResponseSchema.parse(await prepareResponse.json())
    const plan = JSON.parse(prepareBody.result.content[0].text)

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: { operationId: plan.operationId, confirmation: plan.confirmation },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.deletedRecords).toEqual([
      { type: "customer", id: "123", confirmation: "delete:customer:123" },
    ])
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
        arguments: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
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
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
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
        arguments: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
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
      source: { type: "purchaseorder", id: "123", targetType: "vendorbill" },
      selection: { mode: "allOpen" },
      impact: {
        summary:
          "Prepare vendorbill from purchaseorder 123 using all open lines. No record was saved.",
      },
    })
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.BillPurchaseOrder,
        phase: "prepare",
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
    ])
  })

  it("rejects transaction preparation without explicit line selection", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 71,
      method: "tools/call",
      params: {
        name: ToolName.BillPurchaseOrder,
        arguments: { purchaseOrderId: "123" },
      },
    })

    // Then
    expect(JSON.stringify(await response.json())).toContain("selection")
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("assigns a stable idempotency key to a prepared transaction transform", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 75,
      method: "tools/call",
      params: {
        name: ToolName.FulfillSalesOrder,
        arguments: { salesOrderId: "321", selection: { mode: "allOpen" } },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const plan = JSON.parse(body.result.content[0].text)
    await mcpCall(app, {
      jsonrpc: "2.0",
      id: 76,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: { operationId: plan.operationId, confirmation: plan.confirmation },
      },
    })

    // Then
    expect(plan.payload.idempotencyKey).toMatch(/^supermcp-ns_fulfillSalesOrder-[a-f0-9-]{36}$/)
    expect(fakeNetSuite.actions[0]?.payload["idempotencyKey"]).toBeUndefined()
    expect(fakeNetSuite.actions[1]?.payload["idempotencyKey"]).toBeUndefined()
    expect(fakeNetSuite.actions[2]?.payload["idempotencyKey"]).toBe(plan.payload.idempotencyKey)
    expect(fakeNetSuite.actions[3]?.payload["idempotencyKey"]).toBe(plan.payload.idempotencyKey)
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
        arguments: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
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
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: {
          purchaseOrderId: "123",
          selection: { mode: "allOpen" },
          idempotencyKey: plan.payload.idempotencyKey,
        },
      },
      {
        action: ToolName.BillPurchaseOrder,
        phase: "commit",
        payload: {
          purchaseOrderId: "123",
          selection: { mode: "allOpen" },
          idempotencyKey: plan.payload.idempotencyKey,
        },
      },
    ])
  })

  it("returns the original result for a second commit of the same operation plan", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: ToolName.BillPurchaseOrder,
        arguments: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
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
    const secondBody = ToolTextResponseSchema.parse(await secondResponse.json())
    const secondResult = JSON.parse(secondBody.result.content[0].text)
    expect(secondResult).toMatchObject({
      idempotent: true,
      operationId: plan.operationId,
      used: true,
    })
    expect(fakeNetSuite.actions).toHaveLength(4)
  })

  it("prepares a non-atomic compensation plan for a committed fulfillment", async () => {
    // Given
    const fakeNetSuite = new CommittedFulfillmentClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 77,
      method: "tools/call",
      params: {
        name: ToolName.FulfillSalesOrder,
        arguments: { salesOrderId: "321", selection: { mode: "allOpen" } },
      },
    })
    const prepareBody = ToolTextResponseSchema.parse(await prepareResponse.json())
    const plan = JSON.parse(prepareBody.result.content[0].text)
    await mcpCall(app, {
      jsonrpc: "2.0",
      id: 78,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: { operationId: plan.operationId, confirmation: plan.confirmation },
      },
    })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 79,
      method: "tools/call",
      params: {
        name: ToolName.PrepareCompensation,
        arguments: { operationId: plan.operationId },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const compensation = JSON.parse(body.result.content[0].text)

    // Then
    expect(compensation).toMatchObject({
      operationId: plan.operationId,
      strategy: "delete",
      atomic: false,
      target: { type: "itemfulfillment", id: "900" },
    })
  })

  it("rejects commit when the source transaction changed after preparation", async () => {
    // Given
    const fakeNetSuite = new MutableOperationSnapshotClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })
    const prepareResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 73,
      method: "tools/call",
      params: {
        name: ToolName.FulfillSalesOrder,
        arguments: { salesOrderId: "321", selection: { mode: "allOpen" } },
      },
    })
    const prepareBody = ToolTextResponseSchema.parse(await prepareResponse.json())
    const plan = JSON.parse(prepareBody.result.content[0].text)
    fakeNetSuite.status = "closed"

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 74,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: { operationId: plan.operationId, confirmation: plan.confirmation },
      },
    })

    // Then
    const responseBody = ToolTextResponseSchema.parse(await response.json())
    const errorEnvelope = JSON.parse(responseBody.result.content[0].text)
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "OPERATION_SOURCE_CHANGED",
        retryable: false,
        requestId: expect.any(String),
      },
    })
    expect(fakeNetSuite.actions.map(({ phase }) => phase)).toEqual([
      "prepare",
      "preview",
      "preview",
    ])
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
        arguments: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
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
    expect(fakeNetSuite.actions).toHaveLength(2)
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
          payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.BillPurchaseOrder,
        phase: "prepare",
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
    ])
  })

  it("rejects generic transform preparation without explicit line selection", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 72,
      method: "tools/call",
      params: {
        name: ToolName.PrepareAction,
        arguments: {
          action: ToolName.BillPurchaseOrder,
          payload: { purchaseOrderId: "123" },
        },
      },
    })

    // Then
    expect(JSON.stringify(await response.json())).toContain("selection")
    expect(fakeNetSuite.actions).toHaveLength(0)
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
          payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
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
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: { purchaseOrderId: "123", selection: { mode: "allOpen" } },
      },
      {
        action: ToolName.BillPurchaseOrder,
        phase: "preview",
        payload: {
          purchaseOrderId: "123",
          selection: { mode: "allOpen" },
          idempotencyKey: plan.payload.idempotencyKey,
        },
      },
    ])
  })
})

import { describe, expect, it } from "bun:test"
import { z } from "zod"
import { createApp } from "../src/app"
import { getToolContract } from "../src/contracts/tool-registry"
import { ToolName } from "../src/tools/catalog"
import {
  CapabilitiesPayloadSchema,
  initializeRequest,
  mcpCall,
  ToolTextResponseSchema,
} from "./mcp-support"
import { FakeNetSuiteClient, tempAuditPath, testConfig } from "./test-support"

describe("MCP system tools", () => {
  it("provides one passing and one rejected example for every public tool", () => {
    for (const name of Object.values(ToolName)) {
      const contract = getToolContract(name)
      expect(contract.inputSchema.safeParse(contract.examples.valid).success, name).toBe(true)
      expect(contract.inputSchema.safeParse(contract.examples.invalid).success, name).toBe(false)
    }
  })

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

  it("lists the tool catalog over MCP", async () => {
    // Given
    const app = createApp(testConfig(), { netsuite: new FakeNetSuiteClient() })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })
    const body = z.object({ result: z.object({ tools: z.unknown() }) }).parse(await response.json())

    // Then
    expect(response.status).toBe(200)
    expect(JSON.stringify(body)).toContain(ToolName.GetEnvironment)
    expect(JSON.stringify(body)).toContain(ToolName.GetSuperMcpVersion)
    expect(JSON.stringify(body)).toContain(ToolName.GetAuditLog)
    expect(JSON.stringify(body)).toContain(ToolName.ListCapabilities)
    expect(JSON.stringify(body)).toContain(ToolName.BillPurchaseOrder)
    const tools = z
      .array(z.object({ name: z.string(), outputSchema: z.object({ type: z.literal("object") }) }))
      .parse(body.result.tools)
    expect(tools).toHaveLength(Object.keys(ToolName).length)
  })

  it("returns MCP and deployed RESTlet version details", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig({ serverVersion: "local-dev" }), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: ToolName.GetSuperMcpVersion,
        arguments: {},
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    // Then
    expect(response.status).toBe(200)
    expect(body.result.structuredContent).toEqual(payload)
    expect(payload.server).toMatchObject({
      name: "NetSuite SuperMCP",
      configuredVersion: "local-dev",
      packageVersion: "0.1.39",
      toolCount: Object.keys(ToolName).length,
    })
    expect(payload.netsuite).toMatchObject({
      accountId: "1234567_SB1",
      environment: "sandbox",
    })
    expect(payload.restlet).toMatchObject({
      reachable: true,
      action: ToolName.GetSuperMcpVersion,
      phase: "preview",
      ok: true,
    })
    expect(fakeNetSuite.actions).toEqual([
      {
        action: ToolName.GetSuperMcpVersion,
        phase: "preview",
        payload: {},
      },
    ])
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
    expect(body.result.structuredContent).toEqual(payload)
    expect(billPurchaseOrder).toEqual({
      name: ToolName.BillPurchaseOrder,
      risk: "high",
      mutatesNetSuite: true,
      effects: ["May change NetSuite only during an explicit commit phase."],
      requiredPermissions: ["Record-specific create or edit permission"],
      phaseSupport: ["prepare", "preview", "commit"],
    })
  })

  it("describes, examples, and locally validates a typed transaction tool", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const describeResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 61,
      method: "tools/call",
      params: {
        name: ToolName.DescribeTool,
        arguments: { name: ToolName.FulfillSalesOrder },
      },
    })
    const exampleResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 62,
      method: "tools/call",
      params: {
        name: ToolName.GetToolExample,
        arguments: { name: ToolName.FulfillSalesOrder },
      },
    })
    const validationResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 63,
      method: "tools/call",
      params: {
        name: ToolName.ValidateToolRequest,
        arguments: {
          name: ToolName.FulfillSalesOrder,
          payload: { salesOrderId: "321" },
        },
      },
    })
    const describe = JSON.parse(
      ToolTextResponseSchema.parse(await describeResponse.json()).result.content[0].text,
    )
    const example = JSON.parse(
      ToolTextResponseSchema.parse(await exampleResponse.json()).result.content[0].text,
    )
    const validation = JSON.parse(
      ToolTextResponseSchema.parse(await validationResponse.json()).result.content[0].text,
    )

    // Then
    expect(describe).toMatchObject({
      name: ToolName.FulfillSalesOrder,
      risk: "high",
      phaseSupport: ["prepare", "preview", "commit"],
    })
    expect(JSON.stringify(describe.inputSchema)).toContain("selection")
    expect(example.valid).toMatchObject({ selection: { mode: "allOpen" } })
    expect(validation).toMatchObject({ valid: false })
    expect(JSON.stringify(validation.issues)).toContain("selection")
    expect(fakeNetSuite.actions).toHaveLength(0)
  })

  it("checks configured NetSuite account permissions with safe probes", async () => {
    // Given
    const fakeNetSuite = new FakeNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: ToolName.CheckAccountPermissions,
        arguments: { recordTypes: ["customer"], includeRestlet: true },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    // Then
    expect(response.status).toBe(200)
    expect(payload.accountId).toBe("1234567_SB1")
    expect(payload.checks).toContainEqual({ name: "rest_metadata_catalog", allowed: true })
    expect(payload.checks).toContainEqual({ name: "suiteql", allowed: true })
    expect(payload.checks).toContainEqual({ name: "record_metadata:customer", allowed: true })
    expect(payload.checks).toContainEqual({ name: "restlet_preview", allowed: true })
    expect(fakeNetSuite.metadataRequests).toEqual([
      { select: [], mediaType: "application/schema+json" },
      { type: "customer", select: [], mediaType: "application/schema+json" },
    ])
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
        arguments: {
          recordType: "customrecord_mapping",
          recordId: "1",
          values: { token: "secret" },
        },
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

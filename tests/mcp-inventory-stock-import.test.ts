import { describe, expect, it } from "bun:test"
import { createApp } from "../src/app"
import type { SuiteQlRequest } from "../src/netsuite/types"
import type { JsonObject } from "../src/shared/json"
import { ToolName } from "../src/tools/catalog"
import { mcpCall, ToolTextResponseSchema } from "./mcp-support"
import { FakeNetSuiteClient, testConfig } from "./test-support"

class InventoryImportNetSuiteClient extends FakeNetSuiteClient {
  async runSuiteQl(request: SuiteQlRequest): Promise<JsonObject> {
    if (request.query.includes("FROM account")) {
      return {
        count: 3,
        items: [
          {
            id: "410",
            acctnumber: "153.01",
            fullname: "153 Ticari Mallar",
            accttype: "Other Current Asset",
            isinactive: "F",
          },
          {
            id: "901",
            acctnumber: "689.01",
            fullname: "Inventory Adjustment Expense",
            accttype: "Expense",
            isinactive: "F",
          },
          {
            id: "999",
            acctnumber: "153.99",
            fullname: "Inactive Stock Account",
            accttype: "Other Current Asset",
            isinactive: "T",
          },
        ],
      }
    }
    if (request.query.includes("FROM item")) {
      return {
        count: 2,
        items: [
          { id: "7779", itemid: "DD10880 BLACK 36", itemkey: "8680503521824" },
          { id: "7780", itemid: "DD10880 BLACK 38", itemkey: "8680503521831" },
        ],
      }
    }
    if (request.query.includes("FROM inventorybalance")) {
      return {
        count: 2,
        items: [
          { item: "7779", quantity: "1" },
          { item: "7780", quantity: "4" },
        ],
      }
    }
    return super.runSuiteQl(request)
  }
}

describe("MCP inventory stock import", () => {
  it("finds inventory adjustment account candidates without mutating NetSuite", async () => {
    // Given
    const fakeNetSuite = new InventoryImportNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: ToolName.FindInventoryAdjustmentAccounts,
        arguments: {
          search: "ticari mallar",
          preferredAccountNumberPrefix: "153",
        },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    // Then
    expect(response.status).toBe(200)
    expect(payload.candidates[0]).toMatchObject({
      id: "410",
      accountNumber: "153.01",
      fullName: "153 Ticari Mallar",
    })
    expect(payload.candidates.some((candidate: { id: string }) => candidate.id === "999")).toBe(
      false,
    )
    expect(fakeNetSuite.createdRecords).toHaveLength(0)
  })

  it("prepares inventory adjustment deltas without creating records", async () => {
    // Given
    const fakeNetSuite = new InventoryImportNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: ToolName.PrepareInventoryStockImport,
        arguments: {
          locationId: "2",
          adjustmentAccountId: "123",
          rows: [
            { itemKey: "8680503521824", targetQuantity: 3, sourceLine: 2 },
            { itemKey: "8680503521831", targetQuantity: 4, sourceLine: 3 },
            { itemKey: "missing", targetQuantity: 1, sourceLine: 4 },
          ],
        },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    // Then
    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      action: ToolName.CommitInventoryStockImport,
      executor: "inventory",
      phase: "prepare",
      used: false,
    })
    expect(payload.preview.confirmation).toBe("commitInventoryStockImport:1:2")
    expect(payload.preview.lines[0].delta).toBe(2)
    expect(payload.preview.rejectedLines[0].reason).toBe("missing-item")
    expect(fakeNetSuite.createdRecords).toHaveLength(0)
  })

  it("turns the legacy commit helper into a prepare-only operation plan", async () => {
    // Given
    const fakeNetSuite = new InventoryImportNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: ToolName.CommitInventoryStockImport,
        arguments: {
          locationId: "2",
          adjustmentAccountId: "123",
          rows: [{ itemKey: "8680503521824", targetQuantity: 3 }],
        },
      },
    })
    const body = ToolTextResponseSchema.parse(await response.json())
    const payload = JSON.parse(body.result.content[0].text)

    // Then
    expect(response.status).toBe(200)
    expect(payload.action).toBe(ToolName.CommitInventoryStockImport)
    expect(payload.confirmation).toStartWith(`commit:${ToolName.CommitInventoryStockImport}:`)
    expect(fakeNetSuite.actions).toHaveLength(0)
    expect(fakeNetSuite.createdRecords).toHaveLength(0)
  })

  it("commits calculated stock deltas through the permanent inventory RESTlet action", async () => {
    // Given
    const fakeNetSuite = new InventoryImportNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const preparedResponse = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: ToolName.CommitInventoryStockImport,
        arguments: {
          locationId: "2",
          adjustmentAccountId: "123",
          subsidiaryId: "1",
          inventoryStatusId: "1",
          tranDate: "2026-07-09",
          memo: "Paris stock import",
          externalId: "paris-stock-2026-07-08",
          rows: [
            { itemKey: "8680503521824", targetQuantity: 3 },
            { itemKey: "8680503521831", targetQuantity: 4 },
          ],
        },
      },
    })
    const preparedBody = ToolTextResponseSchema.parse(await preparedResponse.json())
    const plan = JSON.parse(preparedBody.result.content[0].text)

    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: {
        name: ToolName.CommitAction,
        arguments: { operationId: plan.operationId, confirmation: plan.confirmation },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.createdRecords).toHaveLength(0)
    expect(fakeNetSuite.actions).toEqual([
      {
        action: "ns_applyInventoryStockImport",
        phase: "commit",
        payload: {
          adjustmentAccountId: "123",
          locationId: "2",
          inventoryStatusId: "1",
          subsidiaryId: "1",
          tranDate: "2026-07-09",
          memo: "Paris stock import",
          externalId: "paris-stock-2026-07-08",
          lines: [
            {
              itemId: "7779",
              itemKey: "8680503521824",
              currentQuantity: 1,
              targetQuantity: 3,
              delta: 2,
            },
          ],
        },
      },
    ])
  })
})

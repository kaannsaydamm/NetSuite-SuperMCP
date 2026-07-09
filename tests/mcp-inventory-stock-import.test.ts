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
    expect(payload.confirmation).toBe("commitInventoryStockImport:1:2")
    expect(payload.lines[0].delta).toBe(2)
    expect(payload.rejectedLines[0].reason).toBe("missing-item")
    expect(fakeNetSuite.createdRecords).toHaveLength(0)
  })

  it("rejects commit when confirmation does not match recomputed deltas", async () => {
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
          confirmation: "wrong",
          rows: [{ itemKey: "8680503521824", targetQuantity: 3 }],
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(JSON.stringify(await response.json())).toContain(
      "confirmation must match commitInventoryStockImport:1:2",
    )
    expect(fakeNetSuite.createdRecords).toHaveLength(0)
  })

  it("commits one inventoryAdjustment record with calculated adjustQtyBy values", async () => {
    // Given
    const fakeNetSuite = new InventoryImportNetSuiteClient()
    const app = createApp(testConfig(), { netsuite: fakeNetSuite })

    // When
    const response = await mcpCall(app, {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: ToolName.CommitInventoryStockImport,
        arguments: {
          locationId: "2",
          adjustmentAccountId: "123",
          subsidiaryId: "1",
          tranDate: "2026-07-09",
          memo: "Paris stock import",
          externalId: "paris-stock-2026-07-08",
          confirmation: "commitInventoryStockImport:1:2",
          rows: [
            { itemKey: "8680503521824", targetQuantity: 3 },
            { itemKey: "8680503521831", targetQuantity: 4 },
          ],
        },
      },
    })

    // Then
    expect(response.status).toBe(200)
    expect(fakeNetSuite.createdRecords).toEqual([
      {
        type: "inventoryAdjustment",
        values: {
          account: { id: "123" },
          adjLocation: { id: "2" },
          subsidiary: { id: "1" },
          tranDate: "2026-07-09",
          externalId: "paris-stock-2026-07-08",
          memo: "Paris stock import",
          inventory: {
            items: [
              {
                item: { id: "7779" },
                location: { id: "2" },
                adjustQtyBy: 2,
                memo: "Stock import 8680503521824: 1 -> 3",
              },
            ],
          },
        },
      },
    ])
  })
})

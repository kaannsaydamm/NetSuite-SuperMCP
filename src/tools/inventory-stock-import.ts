import type { NetSuiteClient } from "../netsuite/client"
import type {
  InventoryStockImportCommitRequest,
  InventoryStockImportPrepareRequest,
  InventoryStockImportRow,
  RecordCreateRequest,
} from "../netsuite/types"
import type { JsonObject, JsonValue } from "../shared/json"

type ItemMatch = {
  readonly itemId: string
  readonly itemName: string
  readonly itemKey: string
}

type PreparedLine = {
  readonly currentQuantity: number
  readonly delta: number
  readonly itemId: string
  readonly itemKey: string
  readonly itemName: string
  readonly sourceLine?: number
  readonly targetQuantity: number
}

type RejectedLine = {
  readonly itemKey: string
  readonly reason: "blank-item-key" | "duplicate-item-key" | "missing-item" | "ambiguous-item"
  readonly sourceLine?: number
  readonly targetQuantity: number
}

type PreparedImport = {
  readonly adjustmentRecord?: RecordCreateRequest
  readonly confirmation: string
  readonly counts: {
    readonly adjustmentLines: number
    readonly ambiguousItems: number
    readonly duplicateInputKeys: number
    readonly missingItems: number
    readonly noChangeLines: number
    readonly rejectedLines: number
    readonly totalInputRows: number
  }
  readonly lines: readonly PreparedLine[]
  readonly noChangeLines: readonly PreparedLine[]
  readonly rejectedLines: readonly RejectedLine[]
  readonly totals: {
    readonly absoluteDelta: number
    readonly targetQuantity: number
    readonly signedDelta: number
  }
}

export async function prepareInventoryStockImport(
  client: NetSuiteClient,
  request: InventoryStockImportPrepareRequest,
): Promise<JsonObject> {
  return prepareInventoryStockImportInternal(client, request, false)
}

export async function commitInventoryStockImport(
  client: NetSuiteClient,
  request: InventoryStockImportCommitRequest,
): Promise<JsonObject> {
  const prepared = await prepareInventoryStockImportInternal(client, request, true)
  if (request.confirmation !== prepared.confirmation) {
    throw new Error(`confirmation must match ${prepared.confirmation}`)
  }
  if (prepared.rejectedLines.length > 0) {
    throw new Error("cannot commit inventory import while rejected lines exist")
  }
  if (prepared.adjustmentRecord === undefined) {
    return {
      committed: false,
      reason: "no inventory deltas to commit",
      confirmation: prepared.confirmation,
      counts: prepared.counts,
      totals: prepared.totals,
    }
  }

  const result = await client.createRecord(prepared.adjustmentRecord)
  return {
    committed: true,
    record: result,
    confirmation: prepared.confirmation,
    counts: prepared.counts,
    totals: prepared.totals,
  }
}

async function prepareInventoryStockImportInternal(
  client: NetSuiteClient,
  request: InventoryStockImportPrepareRequest,
  includeRecord: boolean,
): Promise<PreparedImport> {
  const normalizedRows = request.rows.map(normalizeRow)
  const duplicates = duplicateKeys(normalizedRows)
  const itemKeys = [
    ...new Set(
      normalizedRows
        .map((row) => row.itemKey)
        .filter((itemKey) => itemKey.length > 0 && !duplicates.has(itemKey)),
    ),
  ]
  const itemMatches = await loadItemMatches(client, request.itemMatchField, itemKeys)
  const currentStock = await loadCurrentStock(
    client,
    request.locationId,
    request.stockField,
    itemMatches.unique.map((match) => match.itemId),
  )

  const lines: PreparedLine[] = []
  const noChangeLines: PreparedLine[] = []
  const rejectedLines: RejectedLine[] = []

  for (const row of normalizedRows) {
    if (row.itemKey.length === 0) {
      rejectedLines.push(reject(row, "blank-item-key"))
      continue
    }
    if (duplicates.has(row.itemKey)) {
      rejectedLines.push(reject(row, "duplicate-item-key"))
      continue
    }
    if (itemMatches.ambiguous.has(row.itemKey)) {
      rejectedLines.push(reject(row, "ambiguous-item"))
      continue
    }
    const match = itemMatches.byKey.get(row.itemKey)
    if (match === undefined) {
      rejectedLines.push(reject(row, "missing-item"))
      continue
    }
    const currentQuantity = currentStock.get(match.itemId) ?? 0
    if (!request.zeroMissingCurrentStock && !currentStock.has(match.itemId)) {
      rejectedLines.push(reject(row, "missing-item"))
      continue
    }
    const line = {
      itemKey: row.itemKey,
      itemId: match.itemId,
      itemName: match.itemName,
      currentQuantity,
      targetQuantity: row.targetQuantity,
      delta: roundQuantity(row.targetQuantity - currentQuantity),
      ...(row.sourceLine === undefined ? {} : { sourceLine: row.sourceLine }),
    }
    if (line.delta === 0) {
      noChangeLines.push(line)
    } else {
      lines.push(line)
    }
  }

  const totals = {
    targetQuantity: roundQuantity(
      sum([...lines, ...noChangeLines].map((line) => line.targetQuantity)),
    ),
    signedDelta: roundQuantity(sum(lines.map((line) => line.delta))),
    absoluteDelta: roundQuantity(sum(lines.map((line) => Math.abs(line.delta)))),
  }
  const confirmation = `commitInventoryStockImport:${lines.length}:${totals.signedDelta}`
  const prepared = {
    lines,
    noChangeLines,
    rejectedLines,
    confirmation,
    counts: {
      totalInputRows: request.rows.length,
      adjustmentLines: lines.length,
      noChangeLines: noChangeLines.length,
      rejectedLines: rejectedLines.length,
      duplicateInputKeys: duplicates.size,
      missingItems: rejectedLines.filter((line) => line.reason === "missing-item").length,
      ambiguousItems: rejectedLines.filter((line) => line.reason === "ambiguous-item").length,
    },
    totals,
    ...(includeRecord && lines.length > 0
      ? { adjustmentRecord: inventoryAdjustmentRecord(request, lines) }
      : {}),
  }
  return prepared
}

function inventoryAdjustmentRecord(
  request: InventoryStockImportPrepareRequest,
  lines: readonly PreparedLine[],
): RecordCreateRequest {
  return {
    type: "inventoryAdjustment",
    values: {
      account: { id: request.adjustmentAccountId },
      adjLocation: { id: request.locationId },
      ...(request.subsidiaryId === undefined ? {} : { subsidiary: { id: request.subsidiaryId } }),
      ...(request.tranDate === undefined ? {} : { tranDate: request.tranDate }),
      ...(request.externalId === undefined ? {} : { externalId: request.externalId }),
      memo: request.memo ?? "NetSuite SuperMCP inventory stock import",
      inventory: {
        items: lines.map((line) => ({
          item: { id: line.itemId },
          location: { id: request.locationId },
          adjustQtyBy: line.delta,
          memo: `Stock import ${line.itemKey}: ${line.currentQuantity} -> ${line.targetQuantity}`,
        })),
      },
    },
  }
}

function normalizeRow(row: InventoryStockImportRow): InventoryStockImportRow {
  return {
    ...row,
    itemKey: row.itemKey.trim(),
    targetQuantity: roundQuantity(row.targetQuantity),
  }
}

function duplicateKeys(rows: readonly InventoryStockImportRow[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    if (row.itemKey.length === 0) {
      continue
    }
    if (seen.has(row.itemKey)) {
      duplicates.add(row.itemKey)
    }
    seen.add(row.itemKey)
  }
  return duplicates
}

async function loadItemMatches(
  client: NetSuiteClient,
  itemMatchField: "externalid" | "itemid" | "upccode",
  itemKeys: readonly string[],
): Promise<{
  readonly ambiguous: Set<string>
  readonly byKey: Map<string, ItemMatch>
  readonly unique: readonly ItemMatch[]
}> {
  const byKey = new Map<string, ItemMatch>()
  const ambiguous = new Set<string>()
  for (const chunk of chunks(itemKeys, 50)) {
    if (chunk.length === 0) {
      continue
    }
    const query = `SELECT id, itemid, ${itemMatchField} AS itemkey FROM item WHERE ${itemMatchField} IN (${sqlList(chunk)})`
    const response = await client.runSuiteQl({ query, params: [], limit: 1000 })
    for (const row of suiteQlItems(response)) {
      const itemKey = String(row["itemkey"] ?? "").trim()
      if (itemKey.length === 0) {
        continue
      }
      const match = {
        itemKey,
        itemId: String(row["id"] ?? ""),
        itemName: String(row["itemid"] ?? ""),
      }
      if (byKey.has(itemKey)) {
        ambiguous.add(itemKey)
        byKey.delete(itemKey)
      } else if (!ambiguous.has(itemKey)) {
        byKey.set(itemKey, match)
      }
    }
  }
  return { byKey, ambiguous, unique: [...byKey.values()] }
}

async function loadCurrentStock(
  client: NetSuiteClient,
  locationId: string,
  stockField: "quantityavailable" | "quantityonhand",
  itemIds: readonly string[],
): Promise<Map<string, number>> {
  const stock = new Map<string, number>()
  for (const chunk of chunks(itemIds, 50)) {
    if (chunk.length === 0) {
      continue
    }
    const query = `SELECT item, ${stockField} AS quantity FROM inventorybalance WHERE location = ${sqlString(locationId)} AND item IN (${sqlList(chunk)})`
    const response = await client.runSuiteQl({ query, params: [], limit: 1000 })
    for (const row of suiteQlItems(response)) {
      stock.set(String(row["item"]), Number(row["quantity"] ?? 0))
    }
  }
  return stock
}

function suiteQlItems(response: JsonObject): readonly JsonObject[] {
  const items = response["items"]
  return Array.isArray(items) ? items.filter(isJsonObject) : []
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function reject(row: InventoryStockImportRow, reason: RejectedLine["reason"]): RejectedLine {
  return {
    itemKey: row.itemKey,
    targetQuantity: row.targetQuantity,
    reason,
    ...(row.sourceLine === undefined ? {} : { sourceLine: row.sourceLine }),
  }
}

function chunks<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function sqlList(values: readonly string[]): string {
  return values.map(sqlString).join(",")
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

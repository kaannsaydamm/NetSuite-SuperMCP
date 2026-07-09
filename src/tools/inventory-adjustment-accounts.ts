import type { NetSuiteClient } from "../netsuite/client"
import type { InventoryAdjustmentAccountSearchRequest } from "../netsuite/types"
import type { JsonObject, JsonValue } from "../shared/json"

type AccountCandidate = {
  readonly accountNumber: string
  readonly accountType: string
  readonly fullName: string
  readonly id: string
  readonly inactive: boolean
  readonly score: number
}

export async function findInventoryAdjustmentAccounts(
  client: NetSuiteClient,
  request: InventoryAdjustmentAccountSearchRequest,
): Promise<JsonObject> {
  const query = accountSearchQuery(request)
  const response = await client.runSuiteQl({ query, params: [], limit: request.limit })
  const candidates = suiteQlItems(response)
    .map((row) => accountCandidate(row, request.preferredAccountNumberPrefix))
    .filter((candidate) => request.includeInactive || !candidate.inactive)
    .sort((left, right) => right.score - left.score || left.fullName.localeCompare(right.fullName))
    .slice(0, request.limit)

  return {
    ...(request.search === undefined ? {} : { search: request.search }),
    ...(request.preferredAccountNumberPrefix === undefined
      ? {}
      : { preferredAccountNumberPrefix: request.preferredAccountNumberPrefix }),
    candidates,
    count: candidates.length,
    usage:
      "Use the chosen candidate id as adjustmentAccountId for ns_prepareInventoryStockImport and ns_commitInventoryStockImport.",
  }
}

function accountSearchQuery(request: InventoryAdjustmentAccountSearchRequest): string {
  const terms = searchTerms(request)
  const searchConditions = [
    request.preferredAccountNumberPrefix !== undefined
      ? `acctnumber LIKE ${sqlString(`${request.preferredAccountNumberPrefix}%`)}`
      : undefined,
    ...terms.flatMap((term) => [
      `LOWER(fullname) LIKE ${sqlString(`%${term.toLowerCase()}%`)}`,
      `LOWER(acctnumber) LIKE ${sqlString(`%${term.toLowerCase()}%`)}`,
    ]),
  ].filter((condition): condition is string => condition !== undefined)
  const conditions = [
    request.includeInactive ? undefined : "NVL(isinactive, 'F') = 'F'",
    searchConditions.length === 0 ? undefined : `(${searchConditions.join(" OR ")})`,
  ].filter((condition): condition is string => condition !== undefined)

  const whereClause = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`
  return `SELECT id, acctnumber, fullname, accttype, isinactive FROM account ${whereClause} ORDER BY acctnumber, fullname`
}

function searchTerms(request: InventoryAdjustmentAccountSearchRequest): readonly string[] {
  const search = request.search ?? "inventory stock adjustment shrinkage variance"
  const terms = search
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
  return [...new Set(terms)]
}

function accountCandidate(
  row: JsonObject,
  preferredAccountNumberPrefix: string | undefined,
): AccountCandidate {
  const accountNumber = String(row["acctnumber"] ?? "").trim()
  const fullName = String(row["fullname"] ?? "").trim()
  const accountType = String(row["accttype"] ?? "").trim()
  const inactive = String(row["isinactive"] ?? "F").toUpperCase() === "T"
  return {
    id: String(row["id"] ?? "").trim(),
    accountNumber,
    fullName,
    accountType,
    inactive,
    score: scoreAccount(accountNumber, fullName, accountType, preferredAccountNumberPrefix),
  }
}

function scoreAccount(
  accountNumber: string,
  fullName: string,
  accountType: string,
  preferredAccountNumberPrefix: string | undefined,
): number {
  const haystack = `${accountNumber} ${fullName} ${accountType}`.toLowerCase()
  let score = 0
  if (
    preferredAccountNumberPrefix !== undefined &&
    accountNumber.startsWith(preferredAccountNumberPrefix)
  ) {
    score += 100
  }
  for (const term of ["ticari", "mallar", "inventory", "stock", "adjust", "adjustment"]) {
    if (haystack.includes(term)) {
      score += 10
    }
  }
  return score
}

function suiteQlItems(response: JsonObject): readonly JsonObject[] {
  const items = response["items"]
  return Array.isArray(items) ? items.filter(isJsonObject) : []
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

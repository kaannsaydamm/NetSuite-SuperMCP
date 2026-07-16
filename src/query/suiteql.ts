import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { NetSuiteClient } from "../netsuite/client"
import type { JsonObject, JsonValue } from "../shared/json"

type TokenKind = "word" | "quotedIdentifier" | "string" | "number" | "parameter" | "symbol"
type Token = { readonly kind: TokenKind; readonly value: string; readonly depth: number }

const FORBIDDEN_STATEMENTS = new Set([
  "ALTER",
  "BEGIN",
  "CALL",
  "CREATE",
  "DECLARE",
  "DELETE",
  "DROP",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "INSERT",
  "MERGE",
  "REVOKE",
  "TRUNCATE",
  "UPDATE",
])

const SENSITIVE_FIELD =
  /email|phone|mobile|ssn|tax.?id|password|token|secret|bank|iban|credit.?card/i

export type SuiteQlAnalysis = {
  readonly valid: boolean
  readonly statementType: "select" | "unknown"
  readonly queryFingerprint: string
  readonly tables: readonly string[]
  readonly fields: readonly string[]
  readonly warnings: readonly string[]
  readonly errors: readonly string[]
  readonly sensitiveFields: readonly string[]
  readonly estimatedCost: "low" | "medium" | "high"
  readonly timeoutEstimateMs: number
  readonly hasTopLevelOrderBy: boolean
}

export function analyzeSuiteQl(query: string): SuiteQlAnalysis {
  const errors: string[] = []
  let tokens: readonly Token[] = []
  try {
    tokens = tokenize(query)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  const words = tokens.filter((token) => token.kind === "word")
  const topWords = words
    .filter((token) => token.depth === 0)
    .map((token) => token.value.toUpperCase())
  const first = topWords[0]
  const statementType =
    first === "SELECT" || (first === "WITH" && topWords.includes("SELECT")) ? "select" : "unknown"
  if (statementType !== "select") errors.push("ONLY_SELECT: SuiteQL must be a SELECT statement")
  const forbidden = words.find((token) => FORBIDDEN_STATEMENTS.has(token.value.toUpperCase()))
  if (forbidden) errors.push(`FORBIDDEN_STATEMENT: ${forbidden.value.toUpperCase()} is not allowed`)
  if (tokens.some((token) => token.kind === "symbol" && token.value === ";")) {
    errors.push("MULTIPLE_STATEMENTS: semicolons are not allowed")
  }
  const tables = extractFollowingWords(tokens, "FROM")
  const fields = extractSelectFields(tokens)
  const sensitiveFields = fields.filter((field) => SENSITIVE_FIELD.test(field))
  const warnings: string[] = []
  const upperWords = words.map((token) => token.value.toUpperCase())
  const joinCount = upperWords.filter((word) => word === "JOIN").length
  if (!upperWords.includes("WHERE")) warnings.push("UNFILTERED_QUERY")
  if (fields.includes("*")) warnings.push("SELECT_STAR")
  if (joinCount >= 3) warnings.push("MANY_JOINS")
  if (upperWords.includes("BUILTIN")) warnings.push("BUILTIN_FUNCTION_COST")
  if (sensitiveFields.length > 0) warnings.push("SENSITIVE_FIELDS")
  const estimatedCost =
    joinCount >= 3 || warnings.includes("UNFILTERED_QUERY")
      ? "high"
      : joinCount > 0
        ? "medium"
        : "low"
  return {
    valid: errors.length === 0,
    statementType,
    queryFingerprint: queryFingerprint(query),
    tables,
    fields,
    warnings,
    errors,
    sensitiveFields,
    estimatedCost,
    timeoutEstimateMs:
      estimatedCost === "high" ? 30_000 : estimatedCost === "medium" ? 10_000 : 3_000,
    hasTopLevelOrderBy: hasTopLevelSequence(tokens, "ORDER", "BY"),
  }
}

export function buildSuiteQl(input: {
  readonly table: string
  readonly fields: readonly string[]
  readonly filters: readonly {
    field: string
    operator: string
    value?: JsonValue | undefined
    values?: readonly JsonValue[] | undefined
  }[]
  readonly joins: readonly {
    table: string
    alias: string
    leftField: string
    rightField: string
    kind: "inner" | "left"
  }[]
}): { query: string; params: JsonValue[]; analysis: SuiteQlAnalysis } {
  identifier(input.table)
  input.fields.forEach(qualifiedIdentifier)
  const params: JsonValue[] = []
  const joins = input.joins.map((join) => {
    identifier(join.table)
    identifier(join.alias)
    qualifiedIdentifier(join.leftField)
    qualifiedIdentifier(join.rightField)
    return `${join.kind === "left" ? "LEFT" : "INNER"} JOIN ${join.table} ${join.alias} ON ${join.leftField} = ${join.rightField}`
  })
  const filters = input.filters.map((filter) => {
    qualifiedIdentifier(filter.field)
    const operator = filter.operator.toUpperCase()
    if (["IS NULL", "IS NOT NULL"].includes(operator)) return `${filter.field} ${operator}`
    if (operator === "IN") {
      const values = filter.values ?? []
      if (values.length === 0 || values.length > 200)
        throw new Error("INVALID_FILTER: IN requires 1-200 values")
      params.push(...values)
      return `${filter.field} IN (${values.map(() => "?").join(", ")})`
    }
    if (!["=", "!=", "<>", ">", ">=", "<", "<=", "LIKE"].includes(operator)) {
      throw new Error(`INVALID_OPERATOR: ${operator}`)
    }
    if (filter.value === undefined)
      throw new Error(`INVALID_FILTER: ${filter.field} requires value`)
    params.push(filter.value)
    return `${filter.field} ${operator} ?`
  })
  const query = [
    `SELECT ${input.fields.join(", ")}`,
    `FROM ${input.table}`,
    joins.join(" "),
    filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ")
  return { query, params, analysis: analyzeSuiteQl(query) }
}

export class CursorCodec {
  constructor(private readonly secret: Buffer = randomBytes(32)) {}

  encode(payload: JsonObject): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
    const signature = createHmac("sha256", this.secret).update(body).digest("base64url")
    return `${body}.${signature}`
  }

  decode(cursor: string): JsonObject {
    const [body, signature, extra] = cursor.split(".")
    if (!body || !signature || extra !== undefined)
      throw new Error("INVALID_CURSOR: malformed cursor")
    const expected = createHmac("sha256", this.secret).update(body).digest()
    const actual = Buffer.from(signature, "base64url")
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("INVALID_CURSOR: signature mismatch")
    }
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    if (!isObject(value)) throw new Error("INVALID_CURSOR: payload must be an object")
    return value
  }
}

export async function runSuiteQlPage(
  client: NetSuiteClient,
  codec: CursorCodec,
  input: {
    readonly query: string
    readonly params: readonly JsonValue[]
    readonly keyField: string
    readonly keyIsUnique: true
    readonly cursor?: string
    readonly pageSize: number
    readonly rowBudget: number
  },
) {
  qualifiedIdentifier(input.keyField)
  const analysis = analyzeSuiteQl(input.query)
  if (!analysis.valid) throw new Error(analysis.errors.join("; "))
  if (analysis.hasTopLevelOrderBy) {
    throw new Error(
      "KEYSET_ORDER_CONFLICT: remove top-level ORDER BY; keyField defines paging order",
    )
  }
  const state = input.cursor ? codec.decode(input.cursor) : undefined
  if (state && state["queryFingerprint"] !== analysis.queryFingerprint) {
    throw new Error("CURSOR_QUERY_MISMATCH: cursor belongs to another query")
  }
  if (state && state["keyField"] !== input.keyField) {
    throw new Error("CURSOR_KEY_MISMATCH: cursor belongs to another key field")
  }
  const consumed = numberValue(state?.["consumed"], 0)
  const remaining = input.rowBudget - consumed
  if (remaining <= 0) {
    return { items: [], count: 0, hasMore: false, truncated: true, nextCursor: null, consumed }
  }
  const fetchSize = Math.min(input.pageSize, remaining)
  const lastKey = state?.["lastKey"]
  const wrappedQuery =
    lastKey === undefined
      ? `SELECT * FROM (${input.query}) supermcp_q ORDER BY supermcp_q.${input.keyField} ASC`
      : `SELECT * FROM (${input.query}) supermcp_q WHERE supermcp_q.${input.keyField} > ? ORDER BY supermcp_q.${input.keyField} ASC`
  const response = await client.runSuiteQl({
    query: wrappedQuery,
    params: [...input.params, ...(lastKey === undefined ? [] : [lastKey])],
    limit: fetchSize,
  })
  const rawItems = Array.isArray(response["items"]) ? response["items"] : []
  const hasMore = response["hasMore"] === true
  const items = rawItems.slice(0, fetchSize)
  const nextLastKey =
    items.length === 0 ? undefined : caseInsensitiveField(items.at(-1), input.keyField)
  if (items.length > 0 && nextLastKey === undefined) {
    throw new Error(`KEY_FIELD_MISSING: result does not project ${input.keyField}`)
  }
  const nextConsumed = consumed + items.length
  const truncated = nextConsumed >= input.rowBudget && hasMore
  const nextCursor =
    hasMore && !truncated
      ? codec.encode({
          queryFingerprint: analysis.queryFingerprint,
          keyField: input.keyField,
          lastKey: nextLastKey as JsonValue,
          consumed: nextConsumed,
        })
      : null
  return {
    items,
    count: items.length,
    hasMore: hasMore && !truncated,
    truncated,
    nextCursor,
    consumed: nextConsumed,
    rowBudget: input.rowBudget,
    analysis,
  }
}

export function queryFingerprint(query: string): string {
  return createHash("sha256").update(query.trim()).digest("hex")
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  let depth = 0
  while (index < query.length) {
    const char = query[index] as string
    const next = query[index + 1]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === "-" && next === "-") {
      index = consumeLineComment(query, index + 2)
      continue
    }
    if (char === "/" && next === "*") {
      index = consumeBlockComment(query, index + 2)
      continue
    }
    if (char === "'") {
      const consumed = consumeQuoted(query, index, "'")
      tokens.push({ kind: "string", value: consumed.value, depth })
      index = consumed.next
      continue
    }
    if (char === '"') {
      const consumed = consumeQuoted(query, index, '"')
      tokens.push({ kind: "quotedIdentifier", value: consumed.value, depth })
      index = consumed.next
      continue
    }
    if (char === "(") {
      tokens.push({ kind: "symbol", value: char, depth })
      depth += 1
      index += 1
      continue
    }
    if (char === ")") {
      depth -= 1
      if (depth < 0) throw new Error("INVALID_QUERY: unmatched closing parenthesis")
      tokens.push({ kind: "symbol", value: char, depth })
      index += 1
      continue
    }
    if (char === "?") {
      tokens.push({ kind: "parameter", value: char, depth })
      index += 1
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      const end = consumeWhile(query, index + 1, /[A-Za-z0-9_$#]/)
      tokens.push({ kind: "word", value: query.slice(index, end), depth })
      index = end
      continue
    }
    if (/[0-9]/.test(char)) {
      const end = consumeWhile(query, index + 1, /[0-9.]/)
      tokens.push({ kind: "number", value: query.slice(index, end), depth })
      index = end
      continue
    }
    tokens.push({ kind: "symbol", value: char, depth })
    index += 1
  }
  if (depth !== 0) throw new Error("INVALID_QUERY: unclosed parenthesis")
  return tokens
}

function extractFollowingWords(tokens: readonly Token[], keyword: string): string[] {
  const result: string[] = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    const next = tokens[index + 1]
    if (token?.kind === "word" && token.value.toUpperCase() === keyword && next?.kind === "word") {
      result.push(next.value)
    }
  }
  return [...new Set(result)]
}

function extractSelectFields(tokens: readonly Token[]): string[] {
  const selectIndex = tokens.findIndex(
    (token) => token.kind === "word" && token.value.toUpperCase() === "SELECT",
  )
  if (selectIndex < 0) return []
  const fields: string[] = []
  for (let index = selectIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token?.depth === 0 && token.kind === "word" && token.value.toUpperCase() === "FROM") break
    if (token?.kind === "word" || token?.kind === "quotedIdentifier" || token?.value === "*")
      fields.push(token.value)
  }
  return [...new Set(fields)]
}

function hasTopLevelSequence(tokens: readonly Token[], first: string, second: string): boolean {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index]
    const right = tokens[index + 1]
    if (
      left?.depth === 0 &&
      right?.depth === 0 &&
      left.value.toUpperCase() === first &&
      right.value.toUpperCase() === second
    )
      return true
  }
  return false
}

function identifier(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_$#]*$/.test(value)) throw new Error(`INVALID_IDENTIFIER: ${value}`)
  return value
}

function qualifiedIdentifier(value: string): string {
  value.split(".").forEach(identifier)
  return value
}

function consumeWhile(value: string, start: number, pattern: RegExp): number {
  let index = start
  while (index < value.length && pattern.test(value[index] as string)) index += 1
  return index
}

function consumeQuoted(query: string, start: number, quote: string) {
  let index = start + 1
  let value = ""
  while (index < query.length) {
    const char = query[index] as string
    if (char === quote && query[index + 1] === quote) {
      value += quote
      index += 2
      continue
    }
    if (char === quote) return { value, next: index + 1 }
    value += char
    index += 1
  }
  throw new Error("INVALID_QUERY: unterminated quoted value")
}

function consumeLineComment(query: string, start: number): number {
  const end = query.indexOf("\n", start)
  return end < 0 ? query.length : end + 1
}

function consumeBlockComment(query: string, start: number): number {
  const end = query.indexOf("*/", start)
  if (end < 0) throw new Error("INVALID_QUERY: unterminated block comment")
  return end + 2
}

function caseInsensitiveField(value: JsonValue | undefined, field: string): JsonValue | undefined {
  if (!isObject(value)) return undefined
  const match = Object.keys(value).find((key) => key.toLowerCase() === field.toLowerCase())
  return match === undefined ? undefined : value[match]
}

function numberValue(value: JsonValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

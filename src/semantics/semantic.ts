import { createHash } from "node:crypto"
import type {
  BusinessTermDefinition,
  MetricDefinition,
  PlanBusinessQueryInput,
} from "../contracts/semantic-schemas"
import { analyzeSuiteQl } from "../query/suiteql"
import type { JsonObject, JsonValue } from "../shared/json"

const AMBIGUOUS_TERMS = [
  "sales",
  "stock",
  "inventory",
  "margin",
  "return",
  "returns",
  "active item",
  "active items",
]
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_$#]*$/

export type SemanticPlan = ReturnType<typeof compileMetricPlan>

export function compileMetricPlan(metric: MetricDefinition, input: PlanBusinessQueryInput) {
  assertIdentifier(metric.table)
  const requested =
    input.dimensions.length === 0
      ? metric.dimensions
      : input.dimensions.map((alias) => {
          const dimension = metric.dimensions.find((candidate) => candidate.alias === alias)
          if (!dimension) throw new Error(`UNKNOWN_METRIC_DIMENSION: ${alias}`)
          return dimension
        })
  const dimensions = [...requested].sort((left, right) => compareText(left.alias, right.alias))
  const measure =
    metric.aggregation === "count"
      ? "COUNT(*)"
      : `${aggregation(metric.aggregation)}(${metric.aggregation === "countDistinct" ? "DISTINCT " : ""}${identifier(metric.measureField)})`
  const selected = [
    ...dimensions.map(
      (dimension) => `${identifier(dimension.field)} AS ${identifier(dimension.alias)}`,
    ),
    `${measure} AS metric_value`,
  ]
  const params: JsonValue[] = []
  const predicates = [...metric.filters]
    .sort((left, right) => compareText(canonical(left), canonical(right)))
    .map((filter) => compileFilter(filter, params))
  const exclusions = [...metric.exclusions]
    .sort((left, right) => compareText(canonical(left), canonical(right)))
    .map((filter) => `NOT (${compileFilter(filter, params)})`)
  const query = [
    `SELECT ${selected.join(", ")}`,
    `FROM ${identifier(metric.table)}`,
    predicates.length + exclusions.length > 0
      ? `WHERE ${[...predicates, ...exclusions].join(" AND ")}`
      : "",
    dimensions.length > 0
      ? `GROUP BY ${dimensions.map((dimension) => identifier(dimension.field)).join(", ")}`
      : "",
    dimensions.length > 0
      ? `ORDER BY ${dimensions.map((dimension) => identifier(dimension.field)).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
  const analysis = analyzeSuiteQl(query)
  if (!analysis.valid) throw new Error(analysis.errors.join("; "))
  const formula = `${metric.aggregation}(${metric.measureField ?? "rows"})`
  const lineage = {
    metric: { id: metric.id, version: metric.version },
    table: metric.table,
    fields: [
      ...new Set(
        [
          metric.measureField,
          ...dimensions.map((entry) => entry.field),
          ...predicatesFields(metric),
        ].filter((value): value is string => value !== undefined),
      ),
    ].sort(),
    terms: [
      ...(metric.measureTermId === undefined
        ? []
        : [{ id: metric.measureTermId, version: metric.measureTermVersion as string }]),
      ...dimensions
        .filter((entry) => entry.termId !== undefined)
        .map((entry) => ({ id: entry.termId as string, version: entry.termVersion as string })),
    ],
    sourceRefs: [...metric.sourceRefs].sort(),
  }
  return {
    metric: { id: metric.id, version: metric.version, label: metric.label },
    query,
    params,
    limit: input.limit,
    formula,
    exclusions: metric.exclusions,
    lineage,
    analysis,
    planFingerprint: createHash("sha256")
      .update(canonical({ query, params, metric: lineage.metric }))
      .digest("hex"),
  }
}

export function assertBusinessQueryIsExplicit(query: string, metric: MetricDefinition): void {
  const normalized = query.toLowerCase()
  const matched = AMBIGUOUS_TERMS.filter((term) => containsTerm(normalized, term))
  const declared = new Set(metric.businessTerms.map((term) => term.toLowerCase()))
  const undeclared = matched.filter((term) => !declared.has(term))
  if (undeclared.length > 0) {
    throw new Error(
      `AMBIGUOUS_BUSINESS_TERM: ${undeclared.join(", ")} is not defined by ${metric.id}@${metric.version}`,
    )
  }
}

export function compareMetrics(before: MetricDefinition, after: MetricDefinition) {
  const left = canonical(before)
  const right = canonical(after)
  return {
    before: { id: before.id, version: before.version },
    after: { id: after.id, version: after.version },
    changed: left !== right,
    definitionFingerprintBefore: fingerprint(left),
    definitionFingerprintAfter: fingerprint(right),
    changedSections: [
      "table",
      "aggregation",
      "measureField",
      "measureTermId",
      "measureTermVersion",
      "businessTerms",
      "dimensions",
      "filters",
      "exclusions",
      "currency",
      "sourceRefs",
    ].filter(
      (key) =>
        canonical((before as unknown as JsonObject)[key]) !==
        canonical((after as unknown as JsonObject)[key]),
    ),
  }
}

export function definitionFingerprint(value: BusinessTermDefinition | MetricDefinition): string {
  return fingerprint(canonical(value))
}

function compileFilter(filter: MetricDefinition["filters"][number], params: JsonValue[]): string {
  const field = identifier(filter.field)
  const operator = filter.operator
  if (operator === "IS NULL" || operator === "IS NOT NULL") return `${field} ${operator}`
  if (operator === "IN") {
    if (filter.values === undefined) throw new Error(`INVALID_FILTER: ${field} IN requires values`)
    params.push(...filter.values)
    return `${field} IN (${filter.values.map(() => "?").join(", ")})`
  }
  if (filter.value === undefined) throw new Error(`INVALID_FILTER: ${field} requires value`)
  params.push(filter.value)
  return `${field} ${operator} ?`
}

function predicatesFields(metric: MetricDefinition): string[] {
  return [...metric.filters, ...metric.exclusions].map((entry) => entry.field)
}

function aggregation(value: MetricDefinition["aggregation"]): string {
  return value === "countDistinct" ? "COUNT" : value.toUpperCase()
}

function identifier(value: string | undefined): string {
  if (value === undefined || !IDENTIFIER.test(value))
    throw new Error(`INVALID_IDENTIFIER: ${String(value)}`)
  return value
}

function assertIdentifier(value: string): void {
  identifier(value)
}
function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value))
}
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compareText(a, b))
        .map(([key, entry]) => [key, sortValue(entry)]),
    )
  return value
}
function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function containsTerm(value: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(value)
}

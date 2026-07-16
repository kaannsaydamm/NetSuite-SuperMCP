import type { z } from "zod"
import type {
  DiscoverProcessInputSchema,
  DiscoverRulesInputSchema,
  EvaluateInvariantsInputSchema,
  EvaluatePolicyFactsInputSchema,
  FieldWriteConflictInputSchema,
  PreviewGlImpactInputSchema,
  ProfileDataQualityInputSchema,
  RankRootCausesInputSchema,
  SimulateChannelAllocationInputSchema,
  SimulateDownstreamImpactInputSchema,
  SimulateInventoryStateInputSchema,
} from "../contracts/assurance-schemas"
import type { JsonObject, JsonValue } from "../shared/json"

type ProcessInput = z.infer<typeof DiscoverProcessInputSchema>
type QualityInput = z.infer<typeof ProfileDataQualityInputSchema>

export function discoverProcess(input: ProcessInput) {
  const variants = new Map<string, { count: number; cases: string[] }>()
  const edges = new Map<
    string,
    {
      from: string
      to: string
      count: number
      evidence: ProcessInput["traces"][number]["steps"][number]["evidence"]
    }
  >()
  const durations = new Map<string, number[]>()
  const gaps: Array<Record<string, unknown>> = []
  for (const trace of input.traces) {
    const variant = trace.steps.map((step) => step.node).join(" -> ")
    const current = variants.get(variant) ?? { count: 0, cases: [] }
    variants.set(variant, { count: current.count + 1, cases: [...current.cases, trace.caseId] })
    for (const [index, step] of trace.steps.entries()) {
      if (step.durationMs !== undefined)
        durations.set(step.node, [...(durations.get(step.node) ?? []), step.durationMs])
      const next = trace.steps[index + 1]
      if (next !== undefined) {
        const key = `${step.node}\u0000${next.node}`
        const edge = edges.get(key) ?? { from: step.node, to: next.node, count: 0, evidence: [] }
        edges.set(key, {
          ...edge,
          count: edge.count + 1,
          evidence: [...edge.evidence, ...step.evidence],
        })
      }
    }
    gaps.push(...trace.gaps.map((gap) => ({ caseId: trace.caseId, ...gap, status: "unknown" })))
  }
  return {
    variants: [...variants.entries()]
      .map(([path, value]) => ({ path, ...value }))
      .sort((a, b) => b.count - a.count || compare(a.path, b.path)),
    edges: [...edges.values()].sort((a, b) => compare(`${a.from}:${a.to}`, `${b.from}:${b.to}`)),
    bottlenecks: [...durations.entries()]
      .map(([node, values]) => ({
        node,
        averageDurationMs: values.reduce((sum, value) => sum + value, 0) / values.length,
        evidenceCount: values.length,
      }))
      .sort((a, b) => b.averageDurationMs - a.averageDurationMs),
    gaps,
    incomplete: gaps.length > 0,
  }
}

export function discoverRules(input: z.infer<typeof DiscoverRulesInputSchema>) {
  const rules = input.artifacts.flatMap((artifact) =>
    artifact.rules.map((rule) => ({
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      ...rule,
    })),
  )
  return { rules, count: rules.length, classifications: countBy(rules, "classification") }
}

export function fieldWriteConflicts(input: z.infer<typeof FieldWriteConflictInputSchema>) {
  const groups = new Map<string, typeof input.writers>()
  for (const writer of input.writers) {
    const key = `${writer.recordType}.${writer.field}`
    groups.set(key, [...(groups.get(key) ?? []), writer])
  }
  const conflicts = [...groups.entries()]
    .filter(([, writers]) => new Set(writers.map((writer) => writer.writerId)).size > 1)
    .map(([field, writers]) => ({
      field,
      writers: [...writers].sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
          compare(a.writerId, b.writerId),
      ),
      ordering: writers.every((writer) => writer.order !== undefined) ? "observed" : "unknown",
      evidence: writers.flatMap((writer) => writer.evidence),
    }))
  return { conflicts, count: conflicts.length }
}

export function profileDataQuality(input: QualityInput) {
  const violations: Array<Record<string, unknown>> = []
  const frequencies: Record<string, Record<string, number>> = {}
  for (const rule of input.rules) {
    const seen = new Map<string, string[]>()
    for (const record of input.records) {
      const value = record.fields[rule.field]
      const failed = qualityFailure(rule, value)
      if (failed !== undefined)
        violations.push({
          recordKey: record.key,
          ruleId: rule.id,
          field: rule.field,
          severity: rule.severity,
          reason: failed,
          remediation: rule.remediation,
          evidence: record.evidence,
        })
      if (rule.rule === "unique" && value !== undefined) {
        const key = JSON.stringify(value)
        seen.set(key, [...(seen.get(key) ?? []), record.key])
      }
      const valueKey = JSON.stringify(value ?? null)
      const frequency = frequencies[rule.field] ?? {}
      frequency[valueKey] = (frequency[valueKey] ?? 0) + 1
      frequencies[rule.field] = frequency
    }
    if (rule.rule === "unique")
      for (const [value, keys] of seen)
        if (keys.length > 1)
          violations.push({
            ruleId: rule.id,
            field: rule.field,
            severity: rule.severity,
            reason: "duplicate",
            value: JSON.parse(value),
            recordKeys: keys,
            remediation: rule.remediation,
          })
  }
  return {
    valid: violations.length === 0,
    recordCount: input.records.length,
    violations,
    summary: countBy(violations, "severity"),
    frequencies,
  }
}

export function evaluateInvariants(input: z.infer<typeof EvaluateInvariantsInputSchema>) {
  const results = input.invariants.flatMap((invariant) =>
    input.records.map((record) => ({
      invariantId: invariant.id,
      recordKey: record.key,
      phase: input.phase,
      passed: predicate(record.fields, invariant.predicate),
      severity: invariant.severity,
      message: invariant.message,
      remediation: invariant.remediation,
      evidence: record.evidence,
    })),
  )
  return {
    phase: input.phase,
    passed: results.every((result) => result.passed),
    results,
    failures: results.filter((result) => !result.passed),
  }
}

export function evaluatePolicyFacts(input: z.infer<typeof EvaluatePolicyFactsInputSchema>) {
  const evaluations = input.policies.map((policy) => ({
    policyId: policy.id,
    matched: predicate(input.facts, policy.predicate),
    effect: policy.effect,
    metadata: policy.metadata,
  }))
  return { facts: input.facts, evaluations, enforced: false, enforcementOwner: "provider-harness" }
}

export function simulateDownstream(input: z.infer<typeof SimulateDownstreamImpactInputSchema>) {
  const impacts = input.changes.flatMap((change) =>
    input.dependencies
      .filter(
        (dependency) =>
          dependency.fromRecordType === change.recordType && dependency.field === change.field,
      )
      .map((dependency) => ({
        change,
        target: dependency.target,
        effect: dependency.effect,
        evidence: dependency.evidence,
        classification: "simulated",
      })),
  )
  return { scenarioId: input.scenarioId, impacts, count: impacts.length, mutatesNetSuite: false }
}

export function previewGl(
  input: z.infer<typeof PreviewGlImpactInputSchema>,
  operationImpact?: JsonObject,
) {
  const lines = input.netSuiteProvidedLines ?? input.estimatedLines ?? []
  const source = input.netSuiteProvidedLines
    ? "netsuite-provided"
    : input.estimatedLines
      ? "caller-estimate"
      : "operation-plan-impact"
  return {
    source,
    estimated: source !== "netsuite-provided",
    lines,
    operationImpact: operationImpact ?? null,
    totals: {
      debit: lines.reduce((sum, line) => sum + line.debit, 0),
      credit: lines.reduce((sum, line) => sum + line.credit, 0),
    },
    balanced:
      lines.length > 0
        ? lines.reduce((sum, line) => sum + line.debit - line.credit, 0) === 0
        : null,
    mutatesNetSuite: false,
  }
}

export function simulateInventory(input: z.infer<typeof SimulateInventoryStateInputSchema>) {
  assertUniqueInventory(input.initial)
  const state = new Map(input.initial.map((entry) => [inventoryKey(entry), { ...entry }]))
  const gaps: Array<Record<string, unknown>> = []
  for (const adjustment of input.adjustments) {
    const key = inventoryKey(adjustment)
    const current = state.get(key)
    if (current === undefined) {
      gaps.push({
        key,
        reason: "initial state missing",
        status: "unknown",
        evidence: adjustment.evidence,
      })
      continue
    }
    state.set(key, { ...current, quantity: current.quantity + adjustment.quantityDelta })
  }
  return {
    state: [...state.values()].sort((a, b) => compare(inventoryKey(a), inventoryKey(b))),
    gaps,
    mutatesNetSuite: false,
  }
}

export function simulateAllocation(input: z.infer<typeof SimulateChannelAllocationInputSchema>) {
  assertUniqueInventory(input.inventory)
  const available = new Map(input.inventory.map((entry) => [inventoryKey(entry), entry.quantity]))
  const allocations = [...input.channels]
    .sort((a, b) => a.priority - b.priority || compare(a.channelId, b.channelId))
    .map((channel) => {
      const key = inventoryKey(channel)
      const current = available.get(key)
      if (current === undefined)
        return {
          channelId: channel.channelId,
          itemId: channel.itemId,
          allocated: 0,
          unmet: channel.demand,
          status: "unknown",
          evidence: channel.evidence,
        }
      const allocated = Math.max(0, Math.min(current, channel.demand, channel.cap))
      available.set(key, current - allocated)
      return {
        channelId: channel.channelId,
        itemId: channel.itemId,
        allocated,
        unmet: channel.demand - allocated,
        status: "simulated",
        evidence: channel.evidence,
      }
    })
  return { allocations, remaining: Object.fromEntries(available), mutatesNetSuite: false }
}

export function rankRootCauses(input: z.infer<typeof RankRootCausesInputSchema>) {
  return {
    scoring: {
      formula:
        "clamp(priorConfidence + supportingEvidenceCount*0.05 - contradictingEvidenceCount*0.10)",
      estimated: true,
    },
    hypotheses: input.hypotheses
      .map((hypothesis) => ({
        ...hypothesis,
        confidence: Math.max(
          0,
          Math.min(
            1,
            hypothesis.priorConfidence +
              hypothesis.supportingEvidence.length * 0.05 -
              hypothesis.contradictingEvidence.length * 0.1,
          ),
        ),
        uncertainty:
          hypothesis.contradictingEvidence.length > 0
            ? "contradicted"
            : hypothesis.supportingEvidence.length === 0
              ? "unsupported"
              : "supported",
      }))
      .sort((a, b) => b.confidence - a.confidence || compare(a.id, b.id)),
  }
}

function qualityFailure(
  rule: QualityInput["rules"][number],
  value: JsonValue | undefined,
): string | undefined {
  if (rule.rule === "required")
    return value === undefined || value === null || value === "" ? "required" : undefined
  if (value === undefined) return undefined
  if (rule.rule === "type" && valueType(value) !== rule.expectedType)
    return `expected ${rule.expectedType}`
  if (
    rule.rule === "pattern" &&
    (typeof value !== "string" || rule.pattern === undefined || !wildcardMatch(value, rule.pattern))
  )
    return "pattern mismatch"
  if (
    rule.rule === "range" &&
    (typeof value !== "number" ||
      (rule.min !== undefined && value < rule.min) ||
      (rule.max !== undefined && value > rule.max))
  )
    return "outside range"
  if (
    rule.rule === "enum" &&
    !rule.allowed?.some((allowed) => JSON.stringify(allowed) === JSON.stringify(value))
  )
    return "not allowed"
  if (
    rule.rule === "reference" &&
    !rule.references?.some((reference) => JSON.stringify(reference) === JSON.stringify(value))
  )
    return "reference missing"
  return undefined
}

function predicate(
  facts: Record<string, JsonValue>,
  condition: {
    field: string
    operator: string
    value?: JsonValue | undefined
    values?: JsonValue[] | undefined
  },
): boolean {
  const actual = facts[condition.field]
  if (condition.operator === "exists") return actual !== undefined && actual !== null
  if (condition.operator === "equals") return equal(actual, condition.value)
  if (condition.operator === "notEquals") return !equal(actual, condition.value)
  if (condition.operator === "in")
    return condition.values?.some((value) => equal(actual, value)) ?? false
  if (condition.operator === "gte")
    return (
      typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value
    )
  if (condition.operator === "lte")
    return (
      typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value
    )
  return false
}
function inventoryKey(value: {
  itemId: string
  locationId: string
  statusId?: string | undefined
}) {
  return `${value.itemId}\u0000${value.locationId}\u0000${value.statusId ?? ""}`
}
function valueType(value: JsonValue) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value
}
function equal(left: JsonValue | undefined, right: JsonValue | undefined) {
  return JSON.stringify(left) === JSON.stringify(right)
}
function countBy(entries: readonly Record<string, unknown>[], field: string): JsonObject {
  const result: Record<string, JsonValue> = {}
  for (const entry of entries) {
    const key = String(entry[field] ?? "unknown")
    result[key] = Number(result[key] ?? 0) + 1
  }
  return result
}
function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertUniqueInventory(
  values: ReadonlyArray<{
    itemId: string
    locationId: string
    statusId?: string | undefined
  }>,
): void {
  const keys = values.map(inventoryKey)
  if (new Set(keys).size !== keys.length) throw new Error("DUPLICATE_INVENTORY_STATE")
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")
  return new RegExp(`^${escaped}$`, "u").test(value)
}

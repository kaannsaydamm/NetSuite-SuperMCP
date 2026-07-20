import { randomUUID } from "node:crypto"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  CompareMetricDefinitionsInputSchema,
  DefineBusinessTermInputSchema,
  DefineMetricInputSchema,
  DeleteBusinessTermInputSchema,
  DeleteMetricInputSchema,
  ExportMetricResultInputSchema,
  GenerateMetricReportInputSchema,
  type MetricDefinition,
  MetricRefInputSchema,
  type PlanBusinessQueryInput,
  PlanBusinessQueryInputSchema,
  RunMetricInputSchema,
  TraceMetricLineageInputSchema,
  ValidateMetricPlanInputSchema,
} from "../contracts/semantic-schemas"
import {
  assertBusinessQueryIsExplicit,
  compareMetrics,
  compileMetricPlan,
} from "../semantics/semantic"
import type { JsonObject } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerSemanticTools(server: McpServer, dependencies: ToolDependencies): void {
  register(
    server,
    dependencies,
    ToolName.DefineBusinessTerm,
    DefineBusinessTermInputSchema,
    async (input) => await dependencies.semanticStore.defineTerm(dependencies.requester, input),
  )
  register(server, dependencies, ToolName.DefineMetric, DefineMetricInputSchema, async (input) => {
    await validateTermReferences(dependencies, input)
    return await dependencies.semanticStore.defineMetric(dependencies.requester, input)
  })
  register(
    server,
    dependencies,
    ToolName.DeleteBusinessTerm,
    DeleteBusinessTermInputSchema,
    async (input) =>
      await dependencies.semanticStore.deleteTerm(dependencies.requester, input.id, input.version),
  )
  register(server, dependencies, ToolName.DeleteMetric, DeleteMetricInputSchema, async (input) =>
    dependencies.semanticStore.deleteMetric(dependencies.requester, input.id, input.version),
  )
  register(
    server,
    dependencies,
    ToolName.GetMetricDefinition,
    MetricRefInputSchema,
    async (input) => ({
      definition: await dependencies.semanticStore.getMetric(
        dependencies.requester,
        input.metricId,
        input.metricVersion,
      ),
    }),
  )
  register(
    server,
    dependencies,
    ToolName.PlanBusinessQuery,
    PlanBusinessQueryInputSchema,
    async (input) => await plan(dependencies, input),
  )
  register(
    server,
    dependencies,
    ToolName.ValidateMetricPlan,
    ValidateMetricPlanInputSchema,
    async (input) => {
      const result = await plan(dependencies, input)
      return { valid: result.analysis.valid, plan: result }
    },
  )
  register(
    server,
    dependencies,
    ToolName.RunMetric,
    RunMetricInputSchema,
    async (input) => await runMetric(dependencies, input),
  )
  register(
    server,
    dependencies,
    ToolName.CompareMetricDefinitions,
    CompareMetricDefinitionsInputSchema,
    async (input) => {
      const before = await dependencies.semanticStore.getMetric(
        dependencies.requester,
        input.before.metricId,
        input.before.metricVersion,
      )
      const after = await dependencies.semanticStore.getMetric(
        dependencies.requester,
        input.after.metricId,
        input.after.metricVersion,
      )
      return compareMetrics(before, after)
    },
  )
  register(
    server,
    dependencies,
    ToolName.TraceMetricLineage,
    TraceMetricLineageInputSchema,
    async (input) => {
      const metric = await dependencies.semanticStore.getMetric(
        dependencies.requester,
        input.metricId,
        input.metricVersion,
      )
      const semanticPlan = compileMetricPlan(metric, {
        ...input,
        query: metric.label,
        dimensions: [],
        limit: 1,
      })
      return {
        metric: semanticPlan.metric,
        formula: semanticPlan.formula,
        lineage: semanticPlan.lineage,
        planFingerprint: semanticPlan.planFingerprint,
      }
    },
  )
  register(
    server,
    dependencies,
    ToolName.GenerateMetricReport,
    GenerateMetricReportInputSchema,
    async (input) => {
      const result = await runMetric(dependencies, input)
      return {
        title: input.title,
        definition: result.definition,
        plan: result.plan,
        rows: result.rows,
        evidenceBacked: true,
      }
    },
  )
  register(
    server,
    dependencies,
    ToolName.ExportMetricResult,
    ExportMetricResultInputSchema,
    async (input) => {
      const result = await runMetric(dependencies, input)
      const resourceId = randomUUID()
      await dependencies.exportStore.writeChunk(resourceId, 0, result.rows, input.format)
      const resource = await dependencies.exportStore.finalize(
        resourceId,
        input.format,
        input.compression,
        1,
      )
      return {
        definition: result.definition,
        plan: result.plan,
        count: result.count,
        resource,
        evidenceIncluded: true,
      }
    },
  )
}

async function plan(dependencies: ToolDependencies, input: PlanBusinessQueryInput) {
  const metric = await dependencies.semanticStore.getMetric(
    dependencies.requester,
    input.metricId,
    input.metricVersion,
  )
  assertBusinessQueryIsExplicit(input.query, metric)
  return compileMetricPlan(metric, input)
}

async function runMetric(dependencies: ToolDependencies, input: PlanBusinessQueryInput) {
  const semanticPlan = await plan(dependencies, input)
  const definition = await dependencies.semanticStore.getMetric(
    dependencies.requester,
    input.metricId,
    input.metricVersion,
  )
  const response = await dependencies.netsuite.runSuiteQl({
    query: semanticPlan.query,
    params: semanticPlan.params,
    limit: input.limit,
  })
  const rawRows = Array.isArray(response["items"]) ? response["items"] : []
  const evidence = {
    formula: semanticPlan.formula,
    queryFingerprint: semanticPlan.analysis.queryFingerprint,
    planFingerprint: semanticPlan.planFingerprint,
    lineage: semanticPlan.lineage,
  }
  return {
    definition: { id: definition.id, version: definition.version, label: definition.label },
    plan: semanticPlan,
    rows: rawRows.map((values) => ({ values, evidence })),
    count: rawRows.length,
    truncated: response["hasMore"] === true,
  }
}

async function validateTermReferences(
  dependencies: ToolDependencies,
  metric: MetricDefinition,
): Promise<void> {
  if (metric.measureTermId !== undefined && metric.measureTermVersion !== undefined) {
    const term = await dependencies.semanticStore.getTerm(
      dependencies.requester,
      metric.measureTermId,
      metric.measureTermVersion,
    )
    if (term.table !== metric.table || term.field !== metric.measureField)
      throw new Error(`TERM_FIELD_MISMATCH: ${term.id}@${term.version}`)
  }
  for (const dimension of metric.dimensions) {
    if (dimension.termId === undefined || dimension.termVersion === undefined) continue
    const term = await dependencies.semanticStore.getTerm(
      dependencies.requester,
      dimension.termId,
      dimension.termVersion,
    )
    if (term.table !== metric.table || term.field !== dimension.field)
      throw new Error(`TERM_FIELD_MISMATCH: ${term.id}@${term.version}`)
  }
}

function register<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  inputSchema: z.ZodType<T>,
  execute: (input: T) => unknown | Promise<unknown>,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description:
        "Defines, plans, validates, executes, or traces versioned NetSuite business metrics without account-specific assumptions.",
      inputSchema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input: T) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input: jsonObject(input),
        execute: async () => jsonObject(await execute(input)),
      }),
  )
}

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

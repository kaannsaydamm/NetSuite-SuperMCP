import { z } from "zod"

const IdSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/)
const VersionSchema = z.string().regex(/^[1-9][0-9]*(?:\.[0-9]+){0,2}$/)
const IdentifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_$#]*$/)
const SuiteQlParamSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const BusinessTermDefinitionSchema = z.object({
  id: IdSchema,
  version: VersionSchema,
  label: z.string().min(1).max(160),
  description: z.string().min(1).max(2000),
  table: IdentifierSchema,
  field: IdentifierSchema,
  valueType: z.enum(["string", "number", "boolean", "currency", "identifier"]),
  owner: z.string().min(1).max(160).optional(),
  sourceRefs: z.array(z.string().min(1).max(500)).max(50).default([]),
})

const MetricFilterSchema = z
  .object({
    field: IdentifierSchema,
    operator: z.enum([
      "=",
      "!=",
      "<>",
      ">",
      ">=",
      "<",
      "<=",
      "LIKE",
      "IN",
      "IS NULL",
      "IS NOT NULL",
    ]),
    value: SuiteQlParamSchema.optional(),
    values: z.array(SuiteQlParamSchema).min(1).max(200).optional(),
  })
  .superRefine((filter, context) => {
    if (filter.operator === "IN" && filter.values === undefined)
      context.addIssue({ code: "custom", path: ["values"], message: "values are required for IN" })
    if (!["IN", "IS NULL", "IS NOT NULL"].includes(filter.operator) && filter.value === undefined)
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "value is required for this operator",
      })
  })

const MetricDimensionSchema = z
  .object({
    field: IdentifierSchema,
    alias: IdentifierSchema,
    termId: IdSchema.optional(),
    termVersion: VersionSchema.optional(),
  })
  .refine((value) => (value.termId === undefined) === (value.termVersion === undefined), {
    message: "termId and termVersion must be provided together",
  })

export const MetricDefinitionSchema = z
  .object({
    id: IdSchema,
    version: VersionSchema,
    label: z.string().min(1).max(160),
    description: z.string().min(1).max(2000),
    table: IdentifierSchema,
    aggregation: z.enum(["count", "countDistinct", "sum", "avg", "min", "max"]),
    measureField: IdentifierSchema.optional(),
    measureTermId: IdSchema.optional(),
    measureTermVersion: VersionSchema.optional(),
    businessTerms: z.array(z.string().min(1).max(80)).max(50).default([]),
    dimensions: z.array(MetricDimensionSchema).max(20).default([]),
    filters: z.array(MetricFilterSchema).max(100).default([]),
    exclusions: z.array(MetricFilterSchema).max(100).default([]),
    currency: z
      .object({ code: z.string().min(3).max(16), field: IdentifierSchema.optional() })
      .optional(),
    owner: z.string().min(1).max(160).optional(),
    sourceRefs: z.array(z.string().min(1).max(500)).max(100).default([]),
  })
  .superRefine((value, context) => {
    if (value.aggregation !== "count" && value.measureField === undefined) {
      context.addIssue({
        code: "custom",
        path: ["measureField"],
        message: "measureField is required for this aggregation",
      })
    }
    if ((value.measureTermId === undefined) !== (value.measureTermVersion === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["measureTermId"],
        message: "measureTermId and measureTermVersion must be provided together",
      })
    }
    if (value.aggregation === "count" && value.measureTermId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["measureTermId"],
        message: "row-count metrics cannot reference a measure field term",
      })
    }
    const aliases = value.dimensions.map((dimension) => dimension.alias)
    if (new Set(aliases).size !== aliases.length) {
      context.addIssue({
        code: "custom",
        path: ["dimensions"],
        message: "dimension aliases must be unique",
      })
    }
  })

export const DefineBusinessTermInputSchema = BusinessTermDefinitionSchema
export const DefineMetricInputSchema = MetricDefinitionSchema
export const MetricRefInputSchema = z.object({ metricId: IdSchema, metricVersion: VersionSchema })
export const PlanBusinessQueryInputSchema = MetricRefInputSchema.extend({
  query: z.string().min(1).max(4000),
  dimensions: z.array(IdentifierSchema).max(20).default([]),
  limit: z.number().int().min(1).max(1000).default(100),
})
export const ValidateMetricPlanInputSchema = PlanBusinessQueryInputSchema
export const RunMetricInputSchema = PlanBusinessQueryInputSchema
export const CompareMetricDefinitionsInputSchema = z.object({
  before: MetricRefInputSchema,
  after: MetricRefInputSchema,
})
export const TraceMetricLineageInputSchema = MetricRefInputSchema
export const GenerateMetricReportInputSchema = RunMetricInputSchema.extend({
  title: z.string().min(1).max(200),
})
export const ExportMetricResultInputSchema = RunMetricInputSchema.extend({
  format: z.enum(["jsonl", "csv"]).default("jsonl"),
  compression: z.enum(["none", "gzip"]).default("gzip"),
})

export const SemanticOutputSchema = z.object({}).loose()

export type BusinessTermDefinition = z.infer<typeof BusinessTermDefinitionSchema>
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>
export type PlanBusinessQueryInput = z.infer<typeof PlanBusinessQueryInputSchema>

import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

const EvidenceSchema = z.object({
  source: z.string().min(1),
  reference: z.string().min(1),
  detail: JsonValueSchema.optional(),
})
const RecordSchema = z.object({
  key: z.string().min(1),
  fields: z.record(z.string(), JsonValueSchema),
  evidence: z.array(EvidenceSchema).max(20).default([]),
})

export const DiscoverProcessInputSchema = z.object({
  traces: z
    .array(
      z.object({
        caseId: z.string().min(1),
        steps: z
          .array(
            z.object({
              node: z.string().min(1),
              durationMs: z.number().nonnegative().optional(),
              evidence: z.array(EvidenceSchema).max(20).default([]),
            }),
          )
          .min(1)
          .max(500),
        gaps: z
          .array(
            z.object({
              afterNode: z.string().min(1).optional(),
              reason: z.string().min(1),
              evidence: z.array(EvidenceSchema).max(20).default([]),
            }),
          )
          .max(100)
          .default([]),
      }),
    )
    .min(1)
    .max(1000),
})

export const DiscoverRulesInputSchema = z.object({
  artifacts: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(["script", "workflow", "form", "savedSearch", "fieldConfiguration"]),
        rules: z
          .array(
            z.object({
              condition: z.string().min(1),
              action: z.string().min(1),
              classification: z.enum(["observed", "inferred", "configured"]),
              confidence: z.number().min(0).max(1),
              sourceLocation: z.string().min(1),
              evidence: z.array(EvidenceSchema).min(1).max(20),
            }),
          )
          .max(500),
      }),
    )
    .max(500),
})

export const FieldWriteConflictInputSchema = z.object({
  writers: z
    .array(
      z.object({
        recordType: z.string().min(1),
        field: z.string().min(1),
        writerId: z.string().min(1),
        context: z.string().min(1),
        order: z.number().int().optional(),
        evidence: z.array(EvidenceSchema).min(1).max(20),
      }),
    )
    .max(5000),
})

const QualityRuleSchema = z
  .object({
    id: z.string().min(1),
    field: z.string().min(1),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    rule: z.enum(["required", "type", "pattern", "range", "enum", "unique", "reference"]),
    expectedType: z.enum(["string", "number", "boolean", "object", "array", "null"]).optional(),
    pattern: z.string().max(128).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    allowed: z.array(JsonValueSchema).max(500).optional(),
    references: z.array(JsonValueSchema).max(10000).optional(),
    remediation: z.string().min(1).max(1000),
  })
  .superRefine((rule, context) => {
    if (rule.rule === "type" && rule.expectedType === undefined)
      context.addIssue({
        code: "custom",
        path: ["expectedType"],
        message: "expectedType is required for type rules",
      })
    if (rule.rule === "pattern" && rule.pattern === undefined)
      context.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "a literal '*' wildcard pattern is required",
      })
    if (rule.rule === "range" && rule.min === undefined && rule.max === undefined)
      context.addIssue({
        code: "custom",
        path: ["min"],
        message: "min or max is required for range rules",
      })
    if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max)
      context.addIssue({ code: "custom", path: ["min"], message: "min cannot exceed max" })
    if (rule.rule === "enum" && rule.allowed === undefined)
      context.addIssue({
        code: "custom",
        path: ["allowed"],
        message: "allowed is required for enum rules",
      })
    if (rule.rule === "reference" && rule.references === undefined)
      context.addIssue({
        code: "custom",
        path: ["references"],
        message: "references are required for reference rules",
      })
  })
export const ProfileDataQualityInputSchema = z.object({
  records: z.array(RecordSchema).max(10000),
  rules: z.array(QualityRuleSchema).max(500),
})
export const ValidateMasterDataInputSchema = ProfileDataQualityInputSchema

const PredicateSchema = z
  .object({
    field: z.string().min(1),
    operator: z.enum(["exists", "equals", "notEquals", "in", "gte", "lte"]),
    value: JsonValueSchema.optional(),
    values: z.array(JsonValueSchema).min(1).max(500).optional(),
  })
  .superRefine((predicate, context) => {
    if (
      ["equals", "notEquals", "gte", "lte"].includes(predicate.operator) &&
      predicate.value === undefined
    )
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "value is required for this operator",
      })
    if (predicate.operator === "in" && predicate.values === undefined)
      context.addIssue({ code: "custom", path: ["values"], message: "values are required for in" })
  })
export const EvaluateInvariantsInputSchema = z.object({
  phase: z.enum(["pre", "post"]),
  records: z.array(RecordSchema).max(10000),
  invariants: z
    .array(
      z.object({
        id: z.string().min(1),
        severity: z.enum(["low", "medium", "high", "critical"]),
        predicate: PredicateSchema,
        message: z.string().min(1),
        remediation: z.string().min(1),
      }),
    )
    .max(500),
})
export const EvaluatePolicyFactsInputSchema = z.object({
  facts: z.record(z.string(), JsonValueSchema),
  policies: z
    .array(
      z.object({
        id: z.string().min(1),
        predicate: PredicateSchema,
        effect: z.enum(["allow", "deny", "review"]),
        metadata: z.record(z.string(), JsonValueSchema).default({}),
      }),
    )
    .max(500),
})

export const SimulateDownstreamImpactInputSchema = z.object({
  scenarioId: z.string().min(1),
  changes: z
    .array(
      z.object({
        recordType: z.string().min(1),
        recordId: z.string().min(1),
        field: z.string().min(1),
        before: JsonValueSchema,
        after: JsonValueSchema,
      }),
    )
    .min(1)
    .max(1000),
  dependencies: z
    .array(
      z.object({
        fromRecordType: z.string().min(1),
        field: z.string().min(1),
        target: z.string().min(1),
        effect: z.string().min(1),
        evidence: z.array(EvidenceSchema).max(20).default([]),
      }),
    )
    .max(5000),
})

const GlLineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.number().nonnegative(),
  credit: z.number().nonnegative(),
  memo: z.string().optional(),
  evidence: z.array(EvidenceSchema).max(20).default([]),
})
export const PreviewGlImpactInputSchema = z
  .object({
    operationId: z.string().uuid().optional(),
    netSuiteProvidedLines: z.array(GlLineSchema).max(5000).optional(),
    estimatedLines: z.array(GlLineSchema).max(5000).optional(),
  })
  .refine(
    (value) =>
      [value.operationId, value.netSuiteProvidedLines, value.estimatedLines].filter(
        (entry) => entry !== undefined,
      ).length === 1,
    { message: "provide exactly one GL impact source" },
  )

const InventoryStateSchema = z.object({
  itemId: z.string().min(1),
  locationId: z.string().min(1),
  statusId: z.string().min(1).optional(),
  quantity: z.number(),
})
export const SimulateInventoryStateInputSchema = z.object({
  initial: z.array(InventoryStateSchema).max(10000),
  adjustments: z
    .array(
      z.object({
        itemId: z.string().min(1),
        locationId: z.string().min(1),
        statusId: z.string().min(1).optional(),
        quantityDelta: z.number(),
        evidence: z.array(EvidenceSchema).max(20).default([]),
      }),
    )
    .max(10000),
})
export const SimulateChannelAllocationInputSchema = z.object({
  inventory: z.array(InventoryStateSchema).max(10000),
  channels: z
    .array(
      z.object({
        channelId: z.string().min(1),
        itemId: z.string().min(1),
        locationId: z.string().min(1),
        statusId: z.string().min(1).optional(),
        demand: z.number().nonnegative(),
        cap: z.number().nonnegative(),
        priority: z.number().int(),
        evidence: z.array(EvidenceSchema).max(20).default([]),
      }),
    )
    .max(10000),
})

export const RankRootCausesInputSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        id: z.string().min(1),
        explanation: z.string().min(1),
        supportingEvidence: z.array(EvidenceSchema).max(100),
        contradictingEvidence: z.array(EvidenceSchema).max(100),
        priorConfidence: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(500),
})
export const AssuranceOutputSchema = z.object({}).loose()

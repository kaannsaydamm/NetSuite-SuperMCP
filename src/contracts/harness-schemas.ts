import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

const ToolProfileSchema = z.enum(["read", "preview", "operations"])
const BudgetLimitsSchema = z.object({
  calls: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  records: z.number().int().positive().optional(),
  governanceUnits: z.number().int().positive().optional(),
  runtimeMs: z.number().int().positive().optional(),
})

export const HarnessContextSchema = z.object({
  version: z.literal(1),
  scopeId: z.string().regex(/^[a-zA-Z0-9_.:-]{3,200}$/),
  provider: z.string().min(1).max(200),
  subject: z.string().min(1).max(200),
  profile: ToolProfileSchema,
  allowedTools: z.array(z.string().min(1)).max(500).default([]),
  allowedRecordTypes: z.array(z.string().min(1)).max(500).default([]),
  budgets: BudgetLimitsSchema.default({}),
  sensitivity: z
    .object({
      piiFields: z.array(z.string().min(1)).max(500).default([]),
      piiMode: z.enum(["redact", "show"]).default("redact"),
    })
    .default({ piiFields: [], piiMode: "redact" }),
  approvals: z
    .object({
      callbackUrl: z.string().url().optional(),
      requiredForRisks: z
        .array(z.enum(["low", "medium", "high", "critical"]))
        .default(["high", "critical"]),
      decisions: z
        .array(
          z.object({
            operationId: z.string().uuid(),
            decision: z.enum(["approved", "denied"]),
            approverRef: z.string().min(1),
          }),
        )
        .max(1000)
        .default([]),
    })
    .default({ requiredForRisks: ["high", "critical"], decisions: [] }),
})

const CompositeInputSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  required: z.boolean().default(true),
  example: JsonValueSchema,
  sensitivity: z.enum(["public", "internal", "pii", "secret"]).default("internal"),
})
const InputTemplateSchema = JsonValueSchema
const CompositeStepSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    kind: z.literal("tool"),
    toolName: z.string().min(1),
    inputTemplate: InputTemplateSchema,
  }),
  z.object({
    id: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    kind: z.literal("runbook"),
    runbookId: z.string().min(1),
    runbookVersion: z.string().min(1),
  }),
  z.object({
    id: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    kind: z.literal("composite"),
    compositeId: z.string().min(1),
    compositeVersion: z.string().min(1),
  }),
])

export const CompositeDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    version: z.string().regex(/^[1-9][0-9]*(?:\.[0-9]+){0,2}$/),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    inputs: z.array(CompositeInputSchema).max(100),
    steps: z.array(CompositeStepSchema).min(1).max(100),
  })
  .superRefine((definition, context) => {
    for (const [path, values] of [
      ["inputs", definition.inputs.map((input) => input.name)],
      ["steps", definition.steps.map((step) => step.id)],
    ] as const) {
      if (new Set(values).size !== values.length)
        context.addIssue({ code: "custom", path: [path], message: `${path} must be unique` })
    }
  })

export const GetCompositeToolInputSchema = z.object({
  compositeId: z.string().min(1),
  compositeVersion: z.string().min(1),
})
export const HarnessOutputSchema = z.object({}).loose()

export type HarnessContext = z.infer<typeof HarnessContextSchema>
export type CompositeDefinition = z.infer<typeof CompositeDefinitionSchema>

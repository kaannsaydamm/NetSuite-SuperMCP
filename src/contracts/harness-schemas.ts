import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

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
export const CompositeOutputSchema = z.object({}).loose()

export type CompositeDefinition = z.infer<typeof CompositeDefinitionSchema>

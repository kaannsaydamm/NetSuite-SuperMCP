import { z } from "zod"

const IdSchema = z.union([z.string().min(1), z.number().int().positive()])

export const ScriptSelectorSchema = z
  .object({
    scriptId: IdSchema.optional(),
    deploymentId: IdSchema.optional(),
    maxScripts: z.number().int().min(1).max(100).default(25),
  })
  .refine((value) => value.scriptId !== undefined || value.deploymentId !== undefined, {
    message: "scriptId or deploymentId is required",
  })

export const ScriptObservabilityInputSchema = z.object({
  scriptId: IdSchema.optional(),
  deploymentId: IdSchema.optional(),
  maxExecutions: z.number().int().min(1).max(1000).default(100),
})

export const ScriptGraphInputSchema = z.object({
  scriptIds: z.array(IdSchema).min(1).max(100).optional(),
  maxScripts: z.number().int().min(1).max(100).default(25),
})

export const RecordUsageInputSchema = ScriptGraphInputSchema.extend({
  recordType: z.string().min(1),
})

export const FieldUsageInputSchema = ScriptGraphInputSchema.extend({
  fieldId: z.string().min(1),
  recordType: z.string().min(1).optional(),
})

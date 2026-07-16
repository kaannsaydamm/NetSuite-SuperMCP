import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

export const PrepareOperationRequestSchema = z.object({
  action: z.string().min(1),
  payload: z.record(z.string(), JsonValueSchema).default({}),
})

export const PreviewOperationRequestSchema = z.object({
  operationId: z.string().uuid(),
})

export const CommitOperationRequestSchema = PreviewOperationRequestSchema.extend({
  confirmation: z.string().min(1),
})

export type PrepareOperationRequest = z.infer<typeof PrepareOperationRequestSchema>
export type PreviewOperationRequest = z.infer<typeof PreviewOperationRequestSchema>
export type CommitOperationRequest = z.infer<typeof CommitOperationRequestSchema>

import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

export const RecordRefSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
})

export type RecordRef = z.infer<typeof RecordRefSchema>

export const RecordCreateRequestSchema = z.object({
  type: z.string().min(1),
  values: z.record(z.string(), JsonValueSchema),
})

export type RecordCreateRequest = z.infer<typeof RecordCreateRequestSchema>

export const RecordUpdateRequestSchema = RecordRefSchema.extend({
  values: z.record(z.string(), JsonValueSchema),
})

export type RecordUpdateRequest = z.infer<typeof RecordUpdateRequestSchema>

export const RecordDeleteRequestSchema = RecordRefSchema.extend({
  confirmation: z.string().min(1),
}).refine((request) => request.confirmation === `delete:${request.type}:${request.id}`, {
  message: "confirmation must match delete:{type}:{id}",
})

export type RecordDeleteRequest = z.infer<typeof RecordDeleteRequestSchema>

export const RecordMetadataRequestSchema = z
  .object({
    type: z.string().min(1).optional(),
    select: z.array(z.string().min(1)).max(50).default([]),
    mediaType: z
      .enum(["application/json", "application/swagger+json", "application/schema+json"])
      .default("application/json"),
  })
  .refine((request) => request.type === undefined || request.select.length === 0, {
    message: "type and select cannot be combined",
  })

export type RecordMetadataRequest = z.infer<typeof RecordMetadataRequestSchema>

export const TransactionLinesRequestSchema = RecordRefSchema.extend({
  sublist: z.string().min(1).default("item"),
})

export type TransactionLinesRequest = z.infer<typeof TransactionLinesRequestSchema>

export const SuiteQlRequestSchema = z.object({
  query: z.string().min(1),
  params: z.array(JsonValueSchema).default([]),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
})

export type SuiteQlRequest = z.infer<typeof SuiteQlRequestSchema>

export const RestletActionSchema = z.object({
  action: z.string().min(1),
  phase: z.enum(["prepare", "preview", "commit"]),
  payload: z.record(z.string(), JsonValueSchema),
})

export type RestletAction = z.infer<typeof RestletActionSchema>

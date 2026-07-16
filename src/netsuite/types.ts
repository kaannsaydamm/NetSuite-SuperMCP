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

export const InventoryStockImportRowSchema = z.object({
  itemKey: z.string().min(1),
  targetQuantity: z.number().finite(),
  barcode: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  sourceLine: z.number().int().min(1).optional(),
})

export type InventoryStockImportRow = z.infer<typeof InventoryStockImportRowSchema>

const InventoryStockImportBaseSchema = z.object({
  rows: z.array(InventoryStockImportRowSchema).min(1).max(1000),
  locationId: z.string().min(1),
  adjustmentAccountId: z.string().min(1),
  inventoryStatusId: z.string().min(1).optional(),
  subsidiaryId: z.string().min(1).optional(),
  tranDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  memo: z.string().min(1).max(999).optional(),
  externalId: z.string().min(1).max(255).optional(),
  itemMatchField: z.enum(["upccode", "itemid", "externalid"]).default("upccode"),
  stockField: z.enum(["quantityonhand", "quantityavailable"]).default("quantityonhand"),
  zeroMissingCurrentStock: z.boolean().default(true),
})

export const InventoryStockImportPrepareRequestSchema = InventoryStockImportBaseSchema

export type InventoryStockImportPrepareRequest = z.infer<
  typeof InventoryStockImportPrepareRequestSchema
>

export const InventoryStockImportCommitRequestSchema = InventoryStockImportBaseSchema.extend({
  confirmation: z.string().min(1),
})

export type InventoryStockImportCommitRequest = z.infer<
  typeof InventoryStockImportCommitRequestSchema
>

export const InventoryAdjustmentAccountSearchRequestSchema = z.object({
  search: z.string().min(1).max(100).optional(),
  preferredAccountNumberPrefix: z.string().min(1).max(20).optional(),
  includeInactive: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(25),
})

export type InventoryAdjustmentAccountSearchRequest = z.infer<
  typeof InventoryAdjustmentAccountSearchRequestSchema
>

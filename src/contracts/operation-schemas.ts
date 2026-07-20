import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

const ActionIdSchema = z.union([z.string().min(1), z.number().int().positive()])
const ActionValuesSchema = z
  .record(z.string(), JsonValueSchema)
  .refine((value) => Object.keys(value).length <= 200, "values supports at most 200 fields")

export const OperationLineSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("allOpen") }),
  z.object({
    mode: z.literal("selected"),
    lines: z
      .array(
        z.object({
          line: z.number().int().min(0),
          quantity: z.number().positive().optional(),
          locationId: z.string().min(1).optional(),
          inventoryDetail: z.record(z.string(), JsonValueSchema).optional(),
        }),
      )
      .min(1),
  }),
])

const SalesOrderOperationPayloadSchema = z.object({
  salesOrderId: z.string().regex(/^[1-9]\d*$/),
  selection: OperationLineSelectionSchema,
  values: z.record(z.string(), JsonValueSchema).optional(),
})

const PurchaseOrderOperationPayloadSchema = z.object({
  purchaseOrderId: z.string().regex(/^[1-9]\d*$/),
  selection: OperationLineSelectionSchema,
  values: z.record(z.string(), JsonValueSchema).optional(),
})

const GenericTransformOperationPayloadSchema = z.object({
  fromType: z.string().min(1),
  fromId: z.string().regex(/^[1-9]\d*$/),
  toType: z.string().min(1),
  selection: OperationLineSelectionSchema,
  values: z.record(z.string(), JsonValueSchema).optional(),
})

function directOperationInput<T extends z.ZodRawShape>(payload: z.ZodObject<T>) {
  return payload
}

export const SalesOrderOperationInputSchema = directOperationInput(SalesOrderOperationPayloadSchema)
export const PurchaseOrderOperationInputSchema = directOperationInput(
  PurchaseOrderOperationPayloadSchema,
)
export const GenericTransformOperationInputSchema = directOperationInput(
  GenericTransformOperationPayloadSchema,
)

export const CreateSavedSearchPayloadSchema = z.object({
  recordType: z.string().min(1),
  title: z.string().min(1),
  searchId: z.string().min(1).optional(),
  filters: z.array(JsonValueSchema).max(100).optional(),
  columns: z.array(JsonValueSchema).max(100).optional(),
  isPublic: z.boolean().optional(),
})
export const UpdateSavedSearchPayloadSchema = z.object({
  searchId: z.string().min(1),
  values: ActionValuesSchema,
})
export const DeleteSavedSearchPayloadSchema = z.object({
  searchId: z.string().min(1),
  confirmation: z.string().min(1).optional(),
})
export const WriteFilePayloadSchema = z.object({
  fileId: ActionIdSchema.optional(),
  path: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  folderId: ActionIdSchema.optional(),
  contents: z.string(),
  fileType: z.string().min(1).optional(),
  encoding: z.string().min(1).optional(),
  description: z.string().optional(),
  isOnline: z.boolean().optional(),
  confirmation: z.string().min(1).optional(),
})
export const CreateFolderPayloadSchema = z.object({
  name: z.string().min(1),
  parent: ActionIdSchema.nullable().optional(),
})
export const UpdateFolderPayloadSchema = z.object({
  folderId: ActionIdSchema,
  name: z.string().min(1).optional(),
  parent: ActionIdSchema.nullable().optional(),
})
export const DeleteFolderPayloadSchema = z.object({
  folderId: ActionIdSchema,
  confirmation: z.string().min(1).optional(),
})
export const CopyFilePayloadSchema = z.object({
  fileId: ActionIdSchema,
  targetFolderId: ActionIdSchema,
  name: z.string().min(1).optional(),
  confirmation: z.string().min(1).optional(),
})
export const MoveFilePayloadSchema = z.object({
  fileId: ActionIdSchema,
  targetFolderId: ActionIdSchema,
  confirmation: z.string().min(1).optional(),
})
export const DeleteFilePayloadSchema = z.object({
  fileId: ActionIdSchema,
  confirmation: z.string().min(1).optional(),
})
export const RetryIntegrationJobPayloadSchema = z.object({
  recordType: z.string().min(1),
  recordId: ActionIdSchema,
  values: ActionValuesSchema,
  confirmation: z.string().min(1).optional(),
})
export const UpdateMappingPayloadSchema = z.object({
  recordType: z.string().min(1),
  recordId: ActionIdSchema,
  values: ActionValuesSchema,
  confirmation: z.string().min(1).optional(),
})

export const PrepareOperationRequestSchema = z.union([
  z.object({
    action: z.literal("ns_transformRecord"),
    payload: GenericTransformOperationPayloadSchema,
  }),
  z.object({
    action: z.literal("ns_fulfillSalesOrder"),
    payload: SalesOrderOperationPayloadSchema,
  }),
  z.object({
    action: z.literal("ns_invoiceSalesOrder"),
    payload: SalesOrderOperationPayloadSchema,
  }),
  z.object({
    action: z.literal("ns_receivePurchaseOrder"),
    payload: PurchaseOrderOperationPayloadSchema,
  }),
  z.object({
    action: z.literal("ns_billPurchaseOrder"),
    payload: PurchaseOrderOperationPayloadSchema,
  }),
  z.object({ action: z.literal("ns_createSavedSearch"), payload: CreateSavedSearchPayloadSchema }),
  z.object({ action: z.literal("ns_updateSavedSearch"), payload: UpdateSavedSearchPayloadSchema }),
  z.object({ action: z.literal("ns_deleteSavedSearch"), payload: DeleteSavedSearchPayloadSchema }),
  z.object({ action: z.literal("ns_writeFile"), payload: WriteFilePayloadSchema }),
  z.object({ action: z.literal("ns_createFolder"), payload: CreateFolderPayloadSchema }),
  z.object({ action: z.literal("ns_updateFolder"), payload: UpdateFolderPayloadSchema }),
  z.object({ action: z.literal("ns_deleteFolder"), payload: DeleteFolderPayloadSchema }),
  z.object({ action: z.literal("ns_copyFile"), payload: CopyFilePayloadSchema }),
  z.object({ action: z.literal("ns_moveFile"), payload: MoveFilePayloadSchema }),
  z.object({ action: z.literal("ns_deleteFile"), payload: DeleteFilePayloadSchema }),
  z.object({
    action: z.literal("ns_retryIntegrationJob"),
    payload: RetryIntegrationJobPayloadSchema,
  }),
  z.object({ action: z.literal("ns_updateMapping"), payload: UpdateMappingPayloadSchema }),
])

export const PreviewOperationRequestSchema = z.object({
  operationId: z.string().uuid(),
})

export const CommitOperationRequestSchema = PreviewOperationRequestSchema.extend({
  confirmation: z.string().min(1),
})

export const PrepareCompensationRequestSchema = PreviewOperationRequestSchema

export type PrepareOperationRequest = z.infer<typeof PrepareOperationRequestSchema>
export type PreviewOperationRequest = z.infer<typeof PreviewOperationRequestSchema>
export type CommitOperationRequest = z.infer<typeof CommitOperationRequestSchema>

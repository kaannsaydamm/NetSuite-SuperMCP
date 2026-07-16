import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

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
  return z.union([
    payload.extend({ action: z.string().min(1).optional() }),
    z.object({ action: z.string().min(1).optional(), payload }),
  ])
}

export const SalesOrderOperationInputSchema = directOperationInput(SalesOrderOperationPayloadSchema)
export const PurchaseOrderOperationInputSchema = directOperationInput(
  PurchaseOrderOperationPayloadSchema,
)
export const GenericTransformOperationInputSchema = directOperationInput(
  GenericTransformOperationPayloadSchema,
)

const OtherMutationActionSchema = z.enum([
  "ns_createSavedSearch",
  "ns_updateSavedSearch",
  "ns_deleteSavedSearch",
  "ns_writeFile",
  "ns_createFolder",
  "ns_updateFolder",
  "ns_deleteFolder",
  "ns_copyFile",
  "ns_moveFile",
  "ns_deleteFile",
  "ns_retryIntegrationJob",
  "ns_updateMapping",
])

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
  z.object({
    action: OtherMutationActionSchema,
    payload: z.record(z.string(), JsonValueSchema),
  }),
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

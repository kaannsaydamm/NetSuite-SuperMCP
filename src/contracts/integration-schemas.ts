import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

export const IntegrationDomainSchema = z.enum([
  "generic",
  "orders",
  "inventory",
  "returns",
  "payments",
])

const CanonicalRecordSchema = z.object({
  matchKey: z.string().min(1),
  fields: z.record(z.string(), JsonValueSchema),
  evidence: z.array(JsonValueSchema).max(20).default([]),
})

const FieldContractSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object", "array", "null"]),
  required: z.boolean().default(false),
  semantic: z
    .enum(["identity", "amount", "status", "quantity", "processing", "value"])
    .default("value"),
})

export const IntegrationContractSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  domain: IntegrationDomainSchema,
  keyFields: z.array(z.string().min(1)).min(1).max(10),
  fields: z.record(z.string(), FieldContractSchema),
  mappings: z.record(z.string(), z.string().min(1)).default({}),
  invariants: z
    .array(
      z.object({
        rule: z.enum(["nonnegative", "required", "unique"]),
        field: z.string().min(1),
      }),
    )
    .max(100)
    .default([]),
})

export const DefineIntegrationContractInputSchema = IntegrationContractSchema

export const ValidateIntegrationContractInputSchema = z.object({
  contract: IntegrationContractSchema,
  records: z.array(CanonicalRecordSchema).max(10000),
})

export const ReconcileRecordsInputSchema = z.object({
  domain: IntegrationDomainSchema.default("generic"),
  contract: IntegrationContractSchema,
  sourceName: z.string().min(1),
  targetName: z.string().min(1).default("NetSuite"),
  sourceRecords: z.array(CanonicalRecordSchema).max(10000),
  targetRecords: z.array(CanonicalRecordSchema).max(10000),
})

export const IntegrationHealthInputSchema = z.object({
  integrationId: z.string().min(1),
  processed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  outputState: z.enum(["fresh", "stale", "unknown"]),
  errors: z
    .array(
      z.object({
        executionId: z.string().optional(),
        scriptId: z.string().optional(),
        recordId: z.string().optional(),
        code: z.string().min(1),
        message: z.string().min(1),
        evidence: z.array(JsonValueSchema).max(20).default([]),
      }),
    )
    .max(1000)
    .default([]),
})

export const ShadowPayloadInputSchema = z.object({
  action: z.string().min(1),
  payload: z.record(z.string(), JsonValueSchema),
})

export const ReplayPayloadInputSchema = ShadowPayloadInputSchema.extend({
  mode: z.enum(["simulation", "sandbox"]),
})

export const CanaryPrepareInputSchema = z.object({
  name: z.string().min(1),
  predicate: z.object({
    field: z.string().min(1),
    operator: z.enum(["equals", "in"]),
    value: JsonValueSchema,
  }),
  maxRecords: z.number().int().min(1).max(100),
  operationIds: z.array(z.string().uuid()).min(1).max(100),
})

export const CanaryInputSchema = z.object({ canaryId: z.string().uuid() })

export const CanaryMonitorInputSchema = CanaryInputSchema.extend({
  observations: z
    .array(
      z.object({
        operationId: z.string().uuid(),
        outcome: z.enum(["pass", "fail", "unknown"]),
        evidence: z.array(JsonValueSchema).max(20).default([]),
      }),
    )
    .max(100),
})

export const SyntheticTransactionsInputSchema = z.object({
  count: z.number().int().min(1).max(1000),
  seed: z.string().min(1),
  template: z.record(z.string(), JsonValueSchema),
  sequenceFields: z.array(z.string().min(1)).max(20).default([]),
})

export const AnonymizePayloadInputSchema = z.object({
  records: z.array(z.record(z.string(), JsonValueSchema)).max(10000),
  fields: z.array(z.string().min(1)).min(1).max(100),
  salt: z.string().min(8),
})

export const RegressionSuiteInputSchema = z.object({
  name: z.string().min(1),
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        action: z.string().min(1),
        payload: z.record(z.string(), JsonValueSchema),
        expectedFields: z.record(z.string(), JsonValueSchema).default({}),
      }),
    )
    .min(1)
    .max(100),
})

export const SubscribeIntegrationEventsInputSchema = z.object({
  subscriptionId: z.string().min(1),
  eventTypes: z.array(z.string().min(1)).min(1).max(100),
  endpoint: z
    .string()
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
})

export const EmitIntegrationEventInputSchema = z.object({
  subscriptionId: z.string().min(1),
  eventType: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), JsonValueSchema),
})

export const PollOutboxInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
})
export const AckOutboxInputSchema = z.object({ eventId: z.string().uuid(), delivered: z.boolean() })

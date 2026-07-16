import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

const RecordTypeSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)
const FieldIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)
const RecordRefSchema = z.object({ type: RecordTypeSchema, id: z.string().min(1).max(255) })

export const ListRecordTypesInputSchema = z.object({
  search: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(250).default(100),
})

export const DescribeRecordTypeInputSchema = z.object({ type: RecordTypeSchema })

export const ListRecordFieldsInputSchema = DescribeRecordTypeInputSchema.extend({
  search: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(500).default(200),
})

export const DescribeFieldInputSchema = DescribeRecordTypeInputSchema.extend({
  fieldId: FieldIdSchema,
})

export const FindFieldByLabelInputSchema = DescribeRecordTypeInputSchema.extend({
  label: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(20),
})

export const FindRecordByExternalIdInputSchema = z.object({
  type: RecordTypeSchema,
  externalId: z.string().min(1).max(255),
  limit: z.number().int().min(1).max(20).default(5),
})

export const BatchResolveInternalIdsInputSchema = z.object({
  type: RecordTypeSchema,
  matchField: FieldIdSchema,
  values: z.array(z.string().min(1).max(255)).min(1).max(200),
})

export const BatchGetRecordsInputSchema = z.object({
  records: z.array(RecordRefSchema).min(1).max(100),
})

export const GetRecordWithSublistsInputSchema = RecordRefSchema.extend({
  sublists: z.array(FieldIdSchema).min(1).max(20),
  lineLimit: z.number().int().min(1).max(1000).default(250),
})

export const TransactionChainInputSchema = z.object({
  type: RecordTypeSchema,
  id: z.string().min(1).max(255),
  maxNodes: z.number().int().min(1).max(250).default(100),
  integrationReferences: z
    .array(z.object({ recordType: RecordTypeSchema, transactionField: FieldIdSchema }))
    .max(10)
    .default([]),
})

export const SystemNotesInputSchema = RecordRefSchema.extend({
  limit: z.number().int().min(1).max(1000).default(250),
})

export const DiagnoseTransactionInputSchema = TransactionChainInputSchema.extend({
  includeSystemNotes: z.boolean().default(true),
})

export const RecordSnapshotInputSchema = RecordRefSchema.extend({
  sublists: z.array(FieldIdSchema).max(20).default([]),
  lineLimit: z.number().int().min(1).max(1000).default(250),
})

export const RecordSnapshotSchema = z.object({
  ref: RecordRefSchema,
  fingerprint: z.string().min(1),
  record: JsonValueSchema,
  sublists: z.record(z.string(), JsonValueSchema),
})

export const DiffRecordSnapshotsInputSchema = z.object({
  before: RecordSnapshotSchema,
  after: RecordSnapshotSchema,
})

export const EvidenceItemSchema = z.object({
  kind: z.enum(["record", "search", "scriptLog", "file", "audit", "query", "note"]),
  source: z.string().min(1).max(500),
  payload: JsonValueSchema,
})

export const CreateEvidenceBundleInputSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z0-9._-]+$/)
    .max(100),
  items: z.array(EvidenceItemSchema).min(1).max(250),
})

export const RecordExplorerOutputSchema = z
  .object({
    count: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
    partial: z.boolean().optional(),
    results: z.array(JsonValueSchema).optional(),
    gaps: z.array(JsonValueSchema).optional(),
    record: JsonValueSchema.optional(),
    fields: z.array(JsonValueSchema).optional(),
    nodes: z.array(JsonValueSchema).optional(),
    edges: z.array(JsonValueSchema).optional(),
    events: z.array(JsonValueSchema).optional(),
    hypotheses: z.array(JsonValueSchema).optional(),
    snapshot: RecordSnapshotSchema.optional(),
    changes: z.array(JsonValueSchema).optional(),
    manifest: JsonValueSchema.optional(),
    files: z.array(JsonValueSchema).optional(),
  })
  .loose()

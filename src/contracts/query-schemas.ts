import { z } from "zod"
import { ReadJobSpecSchema } from "../jobs/job-store"
import { JsonValueSchema } from "../shared/json"

const IdentifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_$#]*$/)
const QualifiedIdentifierSchema = z
  .string()
  .refine((value) => value.split(".").every((part) => /^[A-Za-z][A-Za-z0-9_$#]*$/.test(part)), {
    message: "must be a dot-qualified SuiteQL identifier",
  })

export const BuildSuiteQlInputSchema = z.object({
  table: IdentifierSchema,
  fields: z.array(QualifiedIdentifierSchema).min(1).max(100),
  filters: z
    .array(
      z.object({
        field: QualifiedIdentifierSchema,
        operator: z.enum([
          "=",
          "!=",
          "<>",
          ">",
          ">=",
          "<",
          "<=",
          "LIKE",
          "IN",
          "IS NULL",
          "IS NOT NULL",
        ]),
        value: JsonValueSchema.optional(),
        values: z.array(JsonValueSchema).min(1).max(200).optional(),
      }),
    )
    .max(100)
    .default([]),
  joins: z
    .array(
      z.object({
        table: IdentifierSchema,
        alias: IdentifierSchema,
        leftField: QualifiedIdentifierSchema,
        rightField: QualifiedIdentifierSchema,
        kind: z.enum(["inner", "left"]),
      }),
    )
    .max(20)
    .default([]),
})

export const AnalyzeSuiteQlInputSchema = z.object({
  query: z.string().min(1).max(100000),
  params: z.array(JsonValueSchema).max(1000).default([]),
  validateRemotely: z.boolean().default(false),
})

export const RunSuiteQlPagedInputSchema = AnalyzeSuiteQlInputSchema.omit({
  validateRemotely: true,
}).extend({
  keyField: QualifiedIdentifierSchema,
  keyIsUnique: z.literal(true),
  cursor: z.string().min(1).optional(),
  pageSize: z.number().int().min(1).max(1000).default(250),
  rowBudget: z.number().int().min(1).max(100000).default(10000),
})

export const CreateReadJobInputSchema = ReadJobSpecSchema

export const JobInputSchema = z.object({ jobId: z.string().uuid() })
export const ResumeJobInputSchema = JobInputSchema.extend({
  recoverRunning: z.boolean().default(false),
})

export const RunJobStepInputSchema = JobInputSchema.extend({
  maxChunks: z.number().int().min(1).max(5).default(1),
})

export const ExportSuiteQlInputSchema = z.object({
  kind: z.literal("suiteql").default("suiteql"),
  query: z.string().min(1).max(100000),
  params: z.array(JsonValueSchema).max(1000).default([]),
  keyField: QualifiedIdentifierSchema,
  keyIsUnique: z.literal(true),
  pageSize: z.number().int().min(1).max(1000).default(500),
  rowBudget: z.number().int().min(1).max(100000).default(10000),
  format: z.enum(["jsonl", "csv"]).default("jsonl"),
  compression: z.enum(["none", "gzip"]).default("gzip"),
})

export const ExportSavedSearchInputSchema = z.object({
  kind: z.literal("savedSearch").default("savedSearch"),
  savedSearchId: z.string().min(1).max(255),
  pageSize: z.number().int().min(1).max(1000).default(500),
  rowBudget: z.number().int().min(1).max(100000).default(10000),
  format: z.enum(["jsonl", "csv"]).default("jsonl"),
  compression: z.enum(["none", "gzip"]).default("gzip"),
})

export const IncrementalExportInputSchema = RunSuiteQlPagedInputSchema

export const SavedSearchDefinitionInputSchema = z.object({
  savedSearchId: z.string().min(1).max(255),
})

export const SavedSearchDefinitionSchema = z.object({
  id: z.string().min(1),
  searchType: z.string().min(1),
  title: z.string(),
  isPublic: z.boolean().nullable(),
  filters: z.array(JsonValueSchema),
  columns: z.array(JsonValueSchema),
})

export const DiffSavedSearchDefinitionsInputSchema = z.object({
  before: SavedSearchDefinitionSchema,
  after: SavedSearchDefinitionSchema,
})

export const PreviewCloneSavedSearchInputSchema = z.object({
  sourceSearchId: z.string().min(1).max(255),
  targetTitle: z.string().min(1).max(255),
  targetSearchId: z.string().min(1).max(255).optional(),
  isPublic: z.boolean().optional(),
})

export const QueryOutputSchema = z
  .object({
    valid: z.boolean().optional(),
    query: z.string().optional(),
    params: z.array(JsonValueSchema).optional(),
    analysis: JsonValueSchema.optional(),
    items: z.array(JsonValueSchema).optional(),
    count: z.number().int().nonnegative().optional(),
    hasMore: z.boolean().optional(),
    truncated: z.boolean().optional(),
    nextCursor: z.string().nullable().optional(),
    checkpoint: z.string().nullable().optional(),
    job: JsonValueSchema.optional(),
    resource: JsonValueSchema.optional(),
    definition: SavedSearchDefinitionSchema.optional(),
    changes: z.array(JsonValueSchema).optional(),
    clonePreview: JsonValueSchema.optional(),
  })
  .loose()

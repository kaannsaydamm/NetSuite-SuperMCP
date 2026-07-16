import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

const IdSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/)
const VersionSchema = z.string().regex(/^[1-9][0-9]*(?:\.[0-9]+){0,2}$/)
const EvidenceSchema = z.object({
  source: z.string().min(1),
  reference: z.string().min(1),
  payload: JsonValueSchema.optional(),
})

export const RunbookDefinitionSchema = z
  .object({
    id: IdSchema,
    version: VersionSchema,
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    steps: z
      .array(
        z.object({
          id: IdSchema,
          title: z.string().min(1),
          toolName: z.string().min(1),
          input: z.record(z.string(), JsonValueSchema),
          mutatesNetSuite: z.boolean(),
          repairClass: z
            .enum([
              "none",
              "localMetadataRefresh",
              "readJobRecovery",
              "exportRebuild",
              "financial",
              "destructive",
              "other",
            ])
            .default("none"),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((runbook, context) => {
    const ids = runbook.steps.map((step) => step.id)
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", path: ["steps"], message: "step IDs must be unique" })
  })

export const DefineRunbookInputSchema = RunbookDefinitionSchema
export const RunbookRefInputSchema = z.object({
  runbookId: IdSchema,
  runbookVersion: VersionSchema,
})
export const StartRunbookInputSchema = RunbookRefInputSchema.extend({
  evidence: z.array(EvidenceSchema).max(100),
})
export const RunbookExecutionInputSchema = z.object({ executionId: z.string().uuid() })
export const RecordRunbookStepInputSchema = RunbookExecutionInputSchema.extend({
  stepId: IdSchema,
  observedEvidence: z.array(EvidenceSchema).max(100),
  result: JsonValueSchema,
  operationId: z.string().uuid().optional(),
  previewOutput: JsonValueSchema.optional(),
  expectedPreviewFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  succeeded: z.boolean(),
})

export const RepairProposalInputSchema = z.object({
  repairClass: z.enum([
    "localMetadataRefresh",
    "readJobRecovery",
    "exportRebuild",
    "financial",
    "destructive",
    "other",
  ]),
  target: z.record(z.string(), JsonValueSchema),
  toolName: z.string().min(1),
  payload: z.record(z.string(), JsonValueSchema),
  financial: z.boolean(),
  destructive: z.boolean(),
  evidence: z.array(EvidenceSchema).max(100),
  operationId: z.string().uuid().optional(),
})
export const PrepareBoundedRepairInputSchema = RepairProposalInputSchema

export const CorrelateIncidentsInputSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string().min(1),
        executionId: z.string().optional(),
        scriptId: z.string().optional(),
        integrationId: z.string().optional(),
        recordRef: z.string().optional(),
        jobId: z.string().optional(),
        fileId: z.string().optional(),
        alertCode: z.string().optional(),
        message: z.string().min(1),
        evidence: z.array(EvidenceSchema).max(100),
      }),
    )
    .max(10000),
  similarityThreshold: z.number().min(0.5).max(1).default(0.8),
})
export const MeasureSlaInputSchema = z.object({
  measurements: z
    .array(
      z.object({
        id: z.string().min(1),
        targetDurationMs: z.number().nonnegative(),
        actualDurationMs: z.number().nonnegative(),
        evidence: z.array(EvidenceSchema).max(20),
      }),
    )
    .max(10000),
})
export const BuildSupportEvidenceInputSchema = z.object({
  name: IdSchema,
  claims: z
    .array(
      z.object({
        claim: z.string().min(1),
        confidence: z.number().min(0).max(1),
        evidence: z.array(EvidenceSchema).min(1).max(100),
      }),
    )
    .max(1000),
  reproducibleQueries: z
    .array(
      z.object({
        query: z.string().min(1),
        params: z.array(JsonValueSchema).max(1000),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(100),
})
export const GenerateLiveDocumentationInputSchema = z.object({
  title: z.string().min(1),
  sources: z
    .array(
      z.object({
        kind: z.enum([
          "architecture",
          "script",
          "field",
          "role",
          "savedSearch",
          "mapping",
          "transactionFlow",
          "runbook",
        ]),
        id: z.string().min(1),
        definition: JsonValueSchema,
        evidence: z.array(EvidenceSchema).max(20),
      }),
    )
    .max(10000),
})

export const RecordEvidenceClaimInputSchema = z.object({
  claimId: IdSchema,
  statement: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1).max(100),
  supersedesVersion: z.number().int().positive().optional(),
})
export const EvidenceMemoryInputSchema = z.object({ claimId: IdSchema.optional() })
export const RunbookOutputSchema = z.object({}).loose()

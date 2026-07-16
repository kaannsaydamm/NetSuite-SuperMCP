import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

export const CustomizationTypeSchema = z.enum([
  "customRecord",
  "customField",
  "customList",
  "script",
  "scriptDeployment",
  "workflow",
  "form",
  "savedSearch",
  "role",
  "integration",
  "bundle",
  "suiteApp",
  "file",
])

export const CustomizationSchema = z.object({
  type: CustomizationTypeSchema,
  scriptId: z.string().min(1),
  internalId: z.string().optional(),
  name: z.string().min(1),
  definition: z.record(z.string(), JsonValueSchema),
  deploymentState: z.string().optional(),
  permissions: z.array(z.string().min(1)).max(1000).default([]),
  dependencies: z.array(z.string().min(1)).max(1000).default([]),
  checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  metadata: z
    .object({
      owner: z.string().min(1).optional(),
      businessOwner: z.string().min(1).optional(),
      technicalOwner: z.string().min(1).optional(),
      criticality: z.enum(["low", "medium", "high", "critical"]).optional(),
      provenance: z.array(JsonValueSchema).max(100).default([]),
    })
    .default({ provenance: [] }),
})

export const CustomizationInventoryInputSchema = z.object({
  categories: z.array(CustomizationTypeSchema).min(1).max(13),
  query: z.string().optional(),
  maxPerCategory: z.number().int().min(1).max(1000).default(100),
})

export const CustomizationDiffInputSchema = z.object({
  sourceEnvironment: z.string().min(1),
  targetEnvironment: z.string().min(1),
  source: z.array(CustomizationSchema).max(10000),
  target: z.array(CustomizationSchema).max(10000),
})

const ProjectFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((value) => !value.includes("..") && !value.startsWith("/") && !value.startsWith("\\")),
  content: z.string(),
  expectedChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  previousContent: z.string().optional(),
})

export const GenerateCustomizationProjectInputSchema = z.object({
  name: z.string().min(1),
  customizations: z.array(CustomizationSchema).min(1).max(1000),
  files: z.array(ProjectFileSchema).max(1000),
})

export const ProjectInputSchema = z.object({ projectId: z.string().uuid() })

export const PrepareCustomizationDeploymentInputSchema = ProjectInputSchema.extend({
  changedScriptIds: z.array(z.string().min(1)).min(1).max(1000),
  expectedLiveVersion: z.string().min(1).optional(),
})

export const DeploymentInputSchema = z.object({ deploymentId: z.string().uuid() })

export const RecordDeploymentResultInputSchema = DeploymentInputSchema.extend({
  confirmation: z.string().min(1),
  succeeded: z.boolean(),
  uploadedFiles: z.array(z.string().min(1)).max(1000),
  changedObjects: z.array(z.string().min(1)).max(1000),
  validationWarnings: z.array(z.string()).max(1000).default([]),
  providerEvidence: z.array(JsonValueSchema).min(1).max(100),
})

export const MigrationPlanInputSchema = z.object({
  sourceAccount: z.string().min(1),
  targetAccount: z.string().min(1),
  customizations: z.array(CustomizationSchema).min(1).max(10000),
  targetScriptIds: z.array(z.string().min(1)).max(10000),
})

export const CleanupPlanInputSchema = z.object({
  customizations: z.array(CustomizationSchema).max(10000),
  usageEvidence: z
    .array(
      z.object({
        scriptId: z.string().min(1),
        references: z.number().int().nonnegative(),
        evidence: z.array(JsonValueSchema).max(100),
      }),
    )
    .max(10000),
})

export const GenerateCustomizationDocsInputSchema = z.object({
  title: z.string().min(1),
  customizations: z.array(CustomizationSchema).max(10000),
})

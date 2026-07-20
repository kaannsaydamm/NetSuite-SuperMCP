import { z } from "zod"
import { JsonValueSchema } from "../shared/json"
import { ToolName } from "../tools/catalog"
import {
  CopyFilePayloadSchema,
  CreateFolderPayloadSchema,
  CreateSavedSearchPayloadSchema,
  DeleteFilePayloadSchema,
  DeleteFolderPayloadSchema,
  DeleteSavedSearchPayloadSchema,
  MoveFilePayloadSchema,
  RetryIntegrationJobPayloadSchema,
  UpdateFolderPayloadSchema,
  UpdateMappingPayloadSchema,
  UpdateSavedSearchPayloadSchema,
  WriteFilePayloadSchema,
} from "./operation-schemas"

const IdSchema = z.union([z.string().min(1), z.number().int().positive()])
const ValuesSchema = z.record(z.string(), JsonValueSchema)
const FiltersSchema = z.array(JsonValueSchema).max(100).optional()
const ColumnsSchema = z
  .array(z.union([z.string().min(1), ValuesSchema]))
  .max(100)
  .optional()
const PagingShape = {
  pageSize: z.number().int().min(1).max(1000).optional(),
  pageIndex: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
}

function direct<T extends z.ZodTypeAny>(payload: T) {
  return payload
}

const schemaByTool: Partial<Record<ToolName, z.ZodTypeAny>> = {
  [ToolName.RunSavedSearch]: direct(
    z.object({ savedSearchId: z.string().min(1), filters: FiltersSchema, ...PagingShape }),
  ),
  [ToolName.RunReport]: direct(
    z.object({ reportId: z.string().min(1), filters: FiltersSchema, ...PagingShape }),
  ),
  [ToolName.ListPlatformObjects]: direct(
    z
      .object({
        category: z.string().min(1).optional(),
        recordType: z.string().min(1).optional(),
        query: z.string().optional(),
        ...PagingShape,
      })
      .refine((value) => value.category !== undefined || value.recordType !== undefined, {
        message: "category or recordType is required",
      }),
  ),
  [ToolName.GetPlatformObject]: direct(
    z.object({
      recordType: z.string().min(1),
      recordId: IdSchema,
      fields: z.array(z.string().min(1)).max(100).optional(),
    }),
  ),
  [ToolName.SearchRecords]: direct(
    z.object({
      recordType: z.string().min(1),
      query: z.string().optional(),
      filters: FiltersSchema,
      columns: ColumnsSchema,
      ...PagingShape,
    }),
  ),
  [ToolName.ListReportTypes]: direct(z.object({})),
  [ToolName.ListReports]: direct(
    z.object({ query: z.string().optional(), recordType: z.string().optional(), ...PagingShape }),
  ),
  [ToolName.RunSearch]: direct(
    z.object({
      recordType: z.string().min(1),
      filters: FiltersSchema,
      columns: ColumnsSchema,
      ...PagingShape,
    }),
  ),
  [ToolName.CreateSavedSearch]: direct(CreateSavedSearchPayloadSchema),
  [ToolName.UpdateSavedSearch]: direct(UpdateSavedSearchPayloadSchema),
  [ToolName.DeleteSavedSearch]: direct(DeleteSavedSearchPayloadSchema),
  [ToolName.ListFileCabinet]: direct(
    z
      .object({
        folderId: z
          .union([
            z.string().regex(/^-?[1-9]\d*$/),
            z
              .number()
              .int()
              .refine((v) => v !== 0),
          ])
          .optional(),
        path: z.string().min(1).optional(),
        includeUrls: z.boolean().optional(),
        ...PagingShape,
      })
      .refine((value) => (value.folderId === undefined) !== (value.path === undefined), {
        message: "Provide exactly one of folderId or path",
      }),
  ),
  [ToolName.GetFile]: direct(
    z.object({
      fileId: IdSchema.optional(),
      path: z.string().optional(),
      maxBytes: z.number().int().min(1).max(10_485_760).optional(),
    }),
  ),
  [ToolName.WriteFile]: direct(WriteFilePayloadSchema),
  [ToolName.CreateFolder]: direct(CreateFolderPayloadSchema),
  [ToolName.UpdateFolder]: direct(UpdateFolderPayloadSchema),
  [ToolName.DeleteFolder]: direct(DeleteFolderPayloadSchema),
  [ToolName.CopyFile]: direct(CopyFilePayloadSchema),
  [ToolName.MoveFile]: direct(MoveFilePayloadSchema),
  [ToolName.DeleteFile]: direct(DeleteFilePayloadSchema),
  [ToolName.GetIntegrationLogs]: direct(
    z.object({
      savedSearchId: z.string().min(1).optional(),
      recordType: z.string().optional(),
      recordId: IdSchema.optional(),
      ...PagingShape,
    }),
  ),
  [ToolName.GetScriptLogs]: direct(
    z.object({
      savedSearchId: z.string().min(1).optional(),
      scriptId: IdSchema.optional(),
      deploymentId: IdSchema.optional(),
      ...PagingShape,
    }),
  ),
  [ToolName.FindScriptErrors]: direct(
    z.object({
      savedSearchId: z.string().min(1).optional(),
      scriptId: IdSchema.optional(),
      deploymentId: IdSchema.optional(),
      ...PagingShape,
    }),
  ),
  [ToolName.ListScripts]: direct(
    z.object({
      savedSearchId: z.string().min(1).optional(),
      query: z.string().optional(),
      ...PagingShape,
    }),
  ),
  [ToolName.ListScriptDeployments]: direct(
    z.object({
      savedSearchId: z.string().min(1).optional(),
      scriptId: IdSchema.optional(),
      query: z.string().optional(),
      ...PagingShape,
    }),
  ),
  [ToolName.GetFailedIntegrationJobs]: direct(
    z.object({
      savedSearchId: z.string().min(1).optional(),
      recordType: z.string().optional(),
      ...PagingShape,
    }),
  ),
  [ToolName.ExplainIntegrationError]: direct(
    z.object({
      recordType: z.string().min(1),
      recordId: IdSchema,
      fields: z.array(z.string().min(1)).max(100).optional(),
    }),
  ),
  [ToolName.RetryIntegrationJob]: direct(RetryIntegrationJobPayloadSchema),
  [ToolName.GetMapping]: direct(
    z.object({
      recordType: z.string().min(1),
      recordId: IdSchema,
      fields: z.array(z.string().min(1)).max(100).optional(),
    }),
  ),
  [ToolName.UpdateMapping]: direct(UpdateMappingPayloadSchema),
}

export function actionInputSchemaFor(toolName: ToolName): z.ZodTypeAny {
  const schema = schemaByTool[toolName]
  if (schema === undefined) {
    throw new Error(`MISSING_TOOL_SCHEMA: ${toolName} has no typed action input schema`)
  }
  return schema
}

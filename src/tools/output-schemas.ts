import { z } from "zod"
import { JsonValueSchema } from "../shared/json"
import { ToolName } from "./catalog"

const LooseJsonObjectOutputSchema = z.object({}).loose()
const NetSuiteRecordOutputSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional(),
    recordType: z.string().optional(),
  })
  .loose()

const RestletActionOutputSchema = z
  .object({
    action: z.string().optional(),
    phase: z.enum(["prepare", "preview", "commit"]).optional(),
    ok: z.boolean().optional(),
    confirmation: z.string().optional(),
  })
  .loose()

const OperationPlanOutputSchema = z
  .object({
    action: z.string(),
    confirmation: z.string(),
    environment: z.enum(["sandbox", "production"]),
    operationId: z.string().uuid(),
    payload: z.record(z.string(), JsonValueSchema),
    phase: z.literal("prepare"),
    preview: z.record(z.string(), JsonValueSchema),
    used: z.literal(false),
  })
  .loose()

const FileCabinetOutputSchema = z
  .object({
    action: z.string().optional(),
    phase: z.enum(["prepare", "preview", "commit"]).optional(),
    files: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    folders: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    file: z.record(z.string(), JsonValueSchema).optional(),
    folder: z.union([z.record(z.string(), JsonValueSchema), z.null()]).optional(),
    confirmation: z.string().optional(),
  })
  .loose()

const SearchActionOutputSchema = z
  .object({
    action: z.string().optional(),
    phase: z.enum(["prepare", "preview", "commit"]).optional(),
    pageSize: z.number().optional(),
    pageIndex: z.number().optional(),
    totalCount: z.number().optional(),
    results: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    reports: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    reportTypes: z.array(z.record(z.string(), JsonValueSchema)).optional(),
  })
  .loose()

const SuiteQlOutputSchema = z
  .object({
    count: z.number().optional(),
    hasMore: z.boolean().optional(),
    items: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    links: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    offset: z.number().optional(),
    totalResults: z.number().optional(),
  })
  .loose()

const InventoryAdjustmentAccountOutputSchema = z
  .object({
    candidates: z.array(
      z
        .object({
          id: z.string(),
          accountNumber: z.string(),
          fullName: z.string(),
          accountType: z.string(),
          inactive: z.boolean(),
          score: z.number(),
        })
        .loose(),
    ),
    count: z.number(),
    usage: z.string(),
  })
  .loose()

const InventoryStockImportOutputSchema = z
  .object({
    confirmation: z.string(),
    counts: z.record(z.string(), z.number()),
    lines: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    noChangeLines: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    rejectedLines: z.array(z.record(z.string(), JsonValueSchema)).optional(),
    totals: z.record(z.string(), z.number()),
  })
  .loose()

const InventoryStockCommitOutputSchema = z
  .object({
    committed: z.boolean(),
    confirmation: z.string(),
    counts: z.record(z.string(), z.number()),
    totals: z.record(z.string(), z.number()),
    record: z.record(z.string(), JsonValueSchema).optional(),
    reason: z.string().optional(),
  })
  .loose()

const AccountPermissionOutputSchema = z
  .object({
    accountId: z.string(),
    environment: z.enum(["sandbox", "production"]),
    checks: z.array(
      z
        .object({
          name: z.string(),
          allowed: z.boolean(),
          error: z.string().optional(),
        })
        .loose(),
    ),
  })
  .loose()

const CapabilitiesOutputSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      risk: z.enum(["low", "medium", "high"]),
      mutatesNetSuite: z.boolean(),
    }),
  ),
})

const SuperMcpVersionOutputSchema = z
  .object({
    server: z.object({
      name: z.string(),
      configuredVersion: z.string(),
      packageVersion: z.string(),
      toolCount: z.number(),
    }),
    netsuite: z.object({
      accountId: z.string(),
      environment: z.enum(["sandbox", "production"]),
      baseUrl: z.string(),
      restletUrl: z.string(),
    }),
    restlet: z
      .object({
        reachable: z.boolean(),
        version: z.string().optional(),
        actionMapVersion: z.string().optional(),
        toolCount: z.number().optional(),
        error: z.string().optional(),
      })
      .loose(),
  })
  .loose()

export function outputSchemaFor(toolName: ToolName): z.ZodTypeAny {
  switch (toolName) {
    case ToolName.GetEnvironment:
      return z.object({
        accountId: z.string(),
        environment: z.enum(["sandbox", "production"]),
      })
    case ToolName.GetSuperMcpVersion:
      return SuperMcpVersionOutputSchema
    case ToolName.CheckAccountPermissions:
      return AccountPermissionOutputSchema
    case ToolName.ListCapabilities:
      return CapabilitiesOutputSchema
    case ToolName.GetAuditLog:
      return z
        .object({
          events: z.array(z.record(z.string(), JsonValueSchema)),
        })
        .loose()
    case ToolName.RunSuiteQl:
      return SuiteQlOutputSchema
    case ToolName.GetRecord:
    case ToolName.CreateRecord:
    case ToolName.UpdateRecord:
    case ToolName.SubmitFields:
    case ToolName.DeleteRecord:
    case ToolName.GetRecordMetadata:
    case ToolName.GetTransactionLines:
      return NetSuiteRecordOutputSchema
    case ToolName.FindInventoryAdjustmentAccounts:
      return InventoryAdjustmentAccountOutputSchema
    case ToolName.PrepareInventoryStockImport:
      return InventoryStockImportOutputSchema
    case ToolName.CommitInventoryStockImport:
      return InventoryStockCommitOutputSchema
    case ToolName.RunSavedSearch:
    case ToolName.RunReport:
    case ToolName.ListPlatformObjects:
    case ToolName.GetPlatformObject:
    case ToolName.SearchRecords:
    case ToolName.ListReportTypes:
    case ToolName.ListReports:
    case ToolName.RunSearch:
      return SearchActionOutputSchema
    case ToolName.CreateSavedSearch:
    case ToolName.UpdateSavedSearch:
    case ToolName.DeleteSavedSearch:
      return OperationPlanOutputSchema
    case ToolName.ListFileCabinet:
    case ToolName.GetFile:
      return FileCabinetOutputSchema
    case ToolName.WriteFile:
    case ToolName.CreateFolder:
    case ToolName.UpdateFolder:
    case ToolName.DeleteFolder:
    case ToolName.CopyFile:
    case ToolName.MoveFile:
    case ToolName.DeleteFile:
      return OperationPlanOutputSchema
    case ToolName.GetIntegrationLogs:
    case ToolName.GetScriptLogs:
    case ToolName.FindScriptErrors:
    case ToolName.ListScripts:
    case ToolName.ListScriptDeployments:
      return RestletActionOutputSchema
    case ToolName.TransformRecord:
    case ToolName.FulfillSalesOrder:
    case ToolName.InvoiceSalesOrder:
    case ToolName.ReceivePurchaseOrder:
    case ToolName.BillPurchaseOrder:
    case ToolName.GetFailedIntegrationJobs:
    case ToolName.ExplainIntegrationError:
    case ToolName.RetryIntegrationJob:
    case ToolName.UpdateMapping:
    case ToolName.PrepareAction:
      return OperationPlanOutputSchema
    case ToolName.GetMapping:
    case ToolName.PreviewAction:
    case ToolName.CommitAction:
      return RestletActionOutputSchema
    default:
      return LooseJsonObjectOutputSchema
  }
}

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

const FileWriteOutputSchema = z
  .object({
    action: z.string(),
    phase: z.enum(["prepare", "preview", "commit"]),
    file: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        fileType: z.string().optional(),
        folder: z.union([z.string(), z.number()]).optional(),
        size: z.number().optional(),
      })
      .loose(),
    contentLength: z.number().optional(),
    confirmation: z.string().optional(),
    saved: z.boolean().optional(),
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

export function outputSchemaFor(toolName: ToolName): z.ZodTypeAny {
  switch (toolName) {
    case ToolName.GetEnvironment:
      return z.object({
        accountId: z.string(),
        environment: z.enum(["sandbox", "production"]),
      })
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
    case ToolName.GetFile:
    case ToolName.WriteFile:
      return toolName === ToolName.WriteFile ? FileWriteOutputSchema : RestletActionOutputSchema
    case ToolName.GetIntegrationLogs:
    case ToolName.GetScriptLogs:
    case ToolName.FindScriptErrors:
    case ToolName.ListScripts:
    case ToolName.ListScriptDeployments:
    case ToolName.TransformRecord:
    case ToolName.FulfillSalesOrder:
    case ToolName.InvoiceSalesOrder:
    case ToolName.ReceivePurchaseOrder:
    case ToolName.BillPurchaseOrder:
    case ToolName.GetFailedIntegrationJobs:
    case ToolName.ExplainIntegrationError:
    case ToolName.RetryIntegrationJob:
    case ToolName.GetMapping:
    case ToolName.UpdateMapping:
    case ToolName.PrepareAction:
    case ToolName.PreviewAction:
    case ToolName.CommitAction:
      return RestletActionOutputSchema
    default:
      return LooseJsonObjectOutputSchema
  }
}

import { z } from "zod"
import {
  InventoryStockImportCommitRequestSchema,
  InventoryStockImportPrepareRequestSchema,
  RecordCreateRequestSchema,
  RecordDeleteRequestSchema,
  RecordMetadataRequestSchema,
  RecordRefSchema,
  RecordUpdateRequestSchema,
  RestletActionSchema,
  SuiteQlRequestSchema,
  TransactionLinesRequestSchema,
} from "../netsuite/types"
import { type ToolPolicy, ToolRisk } from "../policy"
import { JsonValueSchema } from "../shared/json"

export const ToolName = {
  GetEnvironment: "ns_getEnvironment",
  CheckAccountPermissions: "ns_checkAccountPermissions",
  GetRecord: "ns_getRecord",
  RunSuiteQl: "ns_runSuiteQL",
  RunSavedSearch: "ns_runSavedSearch",
  RunReport: "ns_runReport",
  GetRecordMetadata: "ns_getRecordMetadata",
  GetTransactionLines: "ns_getTransactionLines",
  GetFile: "ns_getFile",
  GetIntegrationLogs: "ns_getIntegrationLogs",
  GetScriptLogs: "ns_getScriptLogs",
  FindScriptErrors: "ns_findScriptErrors",
  ListScripts: "ns_listScripts",
  ListScriptDeployments: "ns_listScriptDeployments",
  CreateRecord: "ns_createRecord",
  UpdateRecord: "ns_updateRecord",
  SubmitFields: "ns_submitFields",
  DeleteRecord: "ns_deleteRecord",
  TransformRecord: "ns_transformRecord",
  FulfillSalesOrder: "ns_fulfillSalesOrder",
  InvoiceSalesOrder: "ns_invoiceSalesOrder",
  ReceivePurchaseOrder: "ns_receivePurchaseOrder",
  BillPurchaseOrder: "ns_billPurchaseOrder",
  GetFailedIntegrationJobs: "ns_getFailedIntegrationJobs",
  ExplainIntegrationError: "ns_explainIntegrationError",
  RetryIntegrationJob: "ns_retryIntegrationJob",
  GetMapping: "ns_getMapping",
  UpdateMapping: "ns_updateMapping",
  PrepareInventoryStockImport: "ns_prepareInventoryStockImport",
  CommitInventoryStockImport: "ns_commitInventoryStockImport",
  PrepareAction: "ns_prepareAction",
  PreviewAction: "ns_previewAction",
  CommitAction: "ns_commitAction",
  GetAuditLog: "ns_getAuditLog",
  ListCapabilities: "ns_listCapabilities",
} as const

export type ToolName = (typeof ToolName)[keyof typeof ToolName]

export const toolPolicies = {
  [ToolName.GetEnvironment]: low(ToolName.GetEnvironment),
  [ToolName.CheckAccountPermissions]: low(ToolName.CheckAccountPermissions),
  [ToolName.GetRecord]: low(ToolName.GetRecord),
  [ToolName.RunSuiteQl]: low(ToolName.RunSuiteQl),
  [ToolName.RunSavedSearch]: low(ToolName.RunSavedSearch),
  [ToolName.RunReport]: low(ToolName.RunReport),
  [ToolName.GetRecordMetadata]: low(ToolName.GetRecordMetadata),
  [ToolName.GetTransactionLines]: low(ToolName.GetTransactionLines),
  [ToolName.GetFile]: low(ToolName.GetFile),
  [ToolName.GetIntegrationLogs]: low(ToolName.GetIntegrationLogs),
  [ToolName.GetScriptLogs]: low(ToolName.GetScriptLogs),
  [ToolName.FindScriptErrors]: low(ToolName.FindScriptErrors),
  [ToolName.ListScripts]: low(ToolName.ListScripts),
  [ToolName.ListScriptDeployments]: low(ToolName.ListScriptDeployments),
  [ToolName.GetFailedIntegrationJobs]: low(ToolName.GetFailedIntegrationJobs),
  [ToolName.ExplainIntegrationError]: low(ToolName.ExplainIntegrationError),
  [ToolName.GetMapping]: low(ToolName.GetMapping),
  [ToolName.GetAuditLog]: low(ToolName.GetAuditLog),
  [ToolName.ListCapabilities]: low(ToolName.ListCapabilities),
  [ToolName.CreateRecord]: medium(ToolName.CreateRecord),
  [ToolName.UpdateRecord]: medium(ToolName.UpdateRecord),
  [ToolName.SubmitFields]: medium(ToolName.SubmitFields),
  [ToolName.DeleteRecord]: high(ToolName.DeleteRecord),
  [ToolName.UpdateMapping]: medium(ToolName.UpdateMapping),
  [ToolName.PrepareInventoryStockImport]: low(ToolName.PrepareInventoryStockImport),
  [ToolName.CommitInventoryStockImport]: high(ToolName.CommitInventoryStockImport),
  [ToolName.TransformRecord]: high(ToolName.TransformRecord),
  [ToolName.FulfillSalesOrder]: high(ToolName.FulfillSalesOrder),
  [ToolName.InvoiceSalesOrder]: high(ToolName.InvoiceSalesOrder),
  [ToolName.ReceivePurchaseOrder]: high(ToolName.ReceivePurchaseOrder),
  [ToolName.BillPurchaseOrder]: high(ToolName.BillPurchaseOrder),
  [ToolName.RetryIntegrationJob]: high(ToolName.RetryIntegrationJob),
  [ToolName.PrepareAction]: low(ToolName.PrepareAction),
  [ToolName.PreviewAction]: low(ToolName.PreviewAction),
  [ToolName.CommitAction]: high(ToolName.CommitAction),
} satisfies Record<ToolName, ToolPolicy>

export const EmptyInputSchema = z.object({})
export const RecordInputSchema = RecordRefSchema
export const RecordCreateInputSchema = RecordCreateRequestSchema
export const RecordUpdateInputSchema = RecordUpdateRequestSchema
export const RecordDeleteInputSchema = RecordDeleteRequestSchema
export const RecordMetadataInputSchema = RecordMetadataRequestSchema
export const TransactionLinesInputSchema = TransactionLinesRequestSchema
export const SuiteQlInputSchema = SuiteQlRequestSchema
export const AuditLogInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
})

export const AccountPermissionCheckInputSchema = z.object({
  recordTypes: z.array(z.string().min(1)).max(20).default([]),
  includeRestlet: z.boolean().default(false),
})

export const GenericActionInputSchema = z.object({
  action: z.string().min(1),
  payload: z.record(z.string(), JsonValueSchema).default({}),
})

export const RestletActionInputSchema = RestletActionSchema
export const InventoryStockImportPrepareInputSchema = InventoryStockImportPrepareRequestSchema
export const InventoryStockImportCommitInputSchema = InventoryStockImportCommitRequestSchema

function low(toolName: ToolName): ToolPolicy {
  return { toolName, risk: ToolRisk.Low, mutatesNetSuite: false }
}

function medium(toolName: ToolName): ToolPolicy {
  return { toolName, risk: ToolRisk.Medium, mutatesNetSuite: true }
}

function high(toolName: ToolName): ToolPolicy {
  return { toolName, risk: ToolRisk.High, mutatesNetSuite: true }
}

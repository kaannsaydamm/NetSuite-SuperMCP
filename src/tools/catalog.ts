import { z } from "zod"
import {
  CommitOperationRequestSchema,
  GenericTransformOperationInputSchema,
  PrepareCompensationRequestSchema,
  PrepareOperationRequestSchema,
  PreviewOperationRequestSchema,
  PurchaseOrderOperationInputSchema,
  SalesOrderOperationInputSchema,
} from "../contracts/operation-schemas"
import {
  InventoryAdjustmentAccountSearchRequestSchema,
  InventoryStockImportPrepareRequestSchema,
  RecordCreateRequestSchema,
  RecordDeleteRequestSchema,
  RecordMetadataRequestSchema,
  RecordRefSchema,
  RecordUpdateRequestSchema,
  SuiteQlRequestSchema,
  TransactionLinesRequestSchema,
} from "../netsuite/types"
import { type ToolPolicy, ToolRisk } from "../policy"
import { JsonValueSchema } from "../shared/json"

export const ToolName = {
  GetEnvironment: "ns_getEnvironment",
  GetSuperMcpVersion: "ns_getSuperMcpVersion",
  CheckAccountPermissions: "ns_checkAccountPermissions",
  GetRecord: "ns_getRecord",
  RunSuiteQl: "ns_runSuiteQL",
  RunSavedSearch: "ns_runSavedSearch",
  RunReport: "ns_runReport",
  GetRecordMetadata: "ns_getRecordMetadata",
  GetTransactionLines: "ns_getTransactionLines",
  ListPlatformObjects: "ns_listPlatformObjects",
  GetPlatformObject: "ns_getPlatformObject",
  SearchRecords: "ns_searchRecords",
  ListReportTypes: "ns_listReportTypes",
  ListReports: "ns_listReports",
  RunSearch: "ns_runSearch",
  CreateSavedSearch: "ns_createSavedSearch",
  UpdateSavedSearch: "ns_updateSavedSearch",
  DeleteSavedSearch: "ns_deleteSavedSearch",
  ListFileCabinet: "ns_listFileCabinet",
  GetFile: "ns_getFile",
  WriteFile: "ns_writeFile",
  CreateFolder: "ns_createFolder",
  UpdateFolder: "ns_updateFolder",
  DeleteFolder: "ns_deleteFolder",
  CopyFile: "ns_copyFile",
  MoveFile: "ns_moveFile",
  DeleteFile: "ns_deleteFile",
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
  FindInventoryAdjustmentAccounts: "ns_findInventoryAdjustmentAccounts",
  PrepareInventoryStockImport: "ns_prepareInventoryStockImport",
  CommitInventoryStockImport: "ns_commitInventoryStockImport",
  PrepareAction: "ns_prepareAction",
  PreviewAction: "ns_previewAction",
  CommitAction: "ns_commitAction",
  PrepareCompensation: "ns_prepareCompensation",
  GetAuditLog: "ns_getAuditLog",
  ListCapabilities: "ns_listCapabilities",
  DescribeTool: "ns_describeTool",
  GetToolExample: "ns_getToolExample",
  ValidateToolRequest: "ns_validateToolRequest",
  GetLoginAuditTrail: "ns_getLoginAuditTrail",
  DiagnoseAuthentication: "ns_diagnoseAuthentication",
  TestOAuthCredentials: "ns_testOAuthCredentials",
  GetOAuthTokenMetadata: "ns_getOAuthTokenMetadata",
  RevokeOAuthAuthorization: "ns_revokeOAuthAuthorization",
  AnalyzeRoleAccess: "ns_analyzeRoleAccess",
  CompareRoleVisibility: "ns_compareRoleVisibility",
  ExplainTokenEligibility: "ns_explainTokenEligibility",
  GetIdentityRelationship: "ns_getIdentityRelationship",
  GetIntegrationState: "ns_getIntegrationState",
  AnalyzeSegregationOfDuties: "ns_analyzeSegregationOfDuties",
} as const

export type ToolName = (typeof ToolName)[keyof typeof ToolName]

export const toolPolicies = {
  [ToolName.GetEnvironment]: low(ToolName.GetEnvironment),
  [ToolName.GetSuperMcpVersion]: low(ToolName.GetSuperMcpVersion),
  [ToolName.CheckAccountPermissions]: low(ToolName.CheckAccountPermissions),
  [ToolName.GetRecord]: low(ToolName.GetRecord),
  [ToolName.RunSuiteQl]: low(ToolName.RunSuiteQl),
  [ToolName.RunSavedSearch]: low(ToolName.RunSavedSearch),
  [ToolName.RunReport]: low(ToolName.RunReport),
  [ToolName.GetRecordMetadata]: low(ToolName.GetRecordMetadata),
  [ToolName.GetTransactionLines]: low(ToolName.GetTransactionLines),
  [ToolName.ListPlatformObjects]: low(ToolName.ListPlatformObjects),
  [ToolName.GetPlatformObject]: low(ToolName.GetPlatformObject),
  [ToolName.SearchRecords]: low(ToolName.SearchRecords),
  [ToolName.ListReportTypes]: low(ToolName.ListReportTypes),
  [ToolName.ListReports]: low(ToolName.ListReports),
  [ToolName.RunSearch]: low(ToolName.RunSearch),
  [ToolName.CreateSavedSearch]: medium(ToolName.CreateSavedSearch),
  [ToolName.UpdateSavedSearch]: medium(ToolName.UpdateSavedSearch),
  [ToolName.DeleteSavedSearch]: high(ToolName.DeleteSavedSearch),
  [ToolName.ListFileCabinet]: low(ToolName.ListFileCabinet),
  [ToolName.GetFile]: low(ToolName.GetFile),
  [ToolName.WriteFile]: high(ToolName.WriteFile),
  [ToolName.CreateFolder]: medium(ToolName.CreateFolder),
  [ToolName.UpdateFolder]: medium(ToolName.UpdateFolder),
  [ToolName.DeleteFolder]: high(ToolName.DeleteFolder),
  [ToolName.CopyFile]: medium(ToolName.CopyFile),
  [ToolName.MoveFile]: medium(ToolName.MoveFile),
  [ToolName.DeleteFile]: high(ToolName.DeleteFile),
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
  [ToolName.DescribeTool]: low(ToolName.DescribeTool),
  [ToolName.GetToolExample]: low(ToolName.GetToolExample),
  [ToolName.ValidateToolRequest]: low(ToolName.ValidateToolRequest),
  [ToolName.GetLoginAuditTrail]: low(ToolName.GetLoginAuditTrail),
  [ToolName.DiagnoseAuthentication]: low(ToolName.DiagnoseAuthentication),
  [ToolName.TestOAuthCredentials]: low(ToolName.TestOAuthCredentials),
  [ToolName.GetOAuthTokenMetadata]: low(ToolName.GetOAuthTokenMetadata),
  [ToolName.RevokeOAuthAuthorization]: diagnosticHigh(ToolName.RevokeOAuthAuthorization),
  [ToolName.AnalyzeRoleAccess]: low(ToolName.AnalyzeRoleAccess),
  [ToolName.CompareRoleVisibility]: low(ToolName.CompareRoleVisibility),
  [ToolName.ExplainTokenEligibility]: low(ToolName.ExplainTokenEligibility),
  [ToolName.GetIdentityRelationship]: low(ToolName.GetIdentityRelationship),
  [ToolName.GetIntegrationState]: low(ToolName.GetIntegrationState),
  [ToolName.AnalyzeSegregationOfDuties]: low(ToolName.AnalyzeSegregationOfDuties),
  [ToolName.CreateRecord]: medium(ToolName.CreateRecord),
  [ToolName.UpdateRecord]: medium(ToolName.UpdateRecord),
  [ToolName.SubmitFields]: medium(ToolName.SubmitFields),
  [ToolName.DeleteRecord]: high(ToolName.DeleteRecord),
  [ToolName.UpdateMapping]: medium(ToolName.UpdateMapping),
  [ToolName.FindInventoryAdjustmentAccounts]: low(ToolName.FindInventoryAdjustmentAccounts),
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
  [ToolName.PrepareCompensation]: low(ToolName.PrepareCompensation),
} satisfies Record<ToolName, ToolPolicy>

export const EmptyInputSchema = z.object({})
export const RecordInputSchema = RecordRefSchema
export const RecordCreateInputSchema = RecordCreateRequestSchema
export const RecordUpdateInputSchema = RecordUpdateRequestSchema
export const RecordDeleteInputSchema = RecordDeleteRequestSchema
export const RecordDeletePlanInputSchema = RecordRefSchema
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

export const ToolContractLookupInputSchema = z.object({ name: z.string().min(1) })
export const ToolRequestValidationInputSchema = z.object({
  name: z.string().min(1),
  payload: JsonValueSchema,
})

export const PrepareOperationInputSchema = PrepareOperationRequestSchema
export const PreviewOperationInputSchema = PreviewOperationRequestSchema
export const CommitOperationInputSchema = CommitOperationRequestSchema
export const PrepareCompensationInputSchema = PrepareCompensationRequestSchema
export {
  GenericTransformOperationInputSchema,
  PurchaseOrderOperationInputSchema,
  SalesOrderOperationInputSchema,
}
export const InventoryAdjustmentAccountSearchInputSchema =
  InventoryAdjustmentAccountSearchRequestSchema
export const InventoryStockImportPrepareInputSchema = InventoryStockImportPrepareRequestSchema
export const InventoryStockImportCommitInputSchema = InventoryStockImportPrepareRequestSchema

function low(toolName: ToolName): ToolPolicy {
  return { toolName, risk: ToolRisk.Low, mutatesNetSuite: false }
}

function medium(toolName: ToolName): ToolPolicy {
  return { toolName, risk: ToolRisk.Medium, mutatesNetSuite: true }
}

function high(toolName: ToolName): ToolPolicy {
  return { toolName, risk: ToolRisk.High, mutatesNetSuite: true }
}

function diagnosticHigh(toolName: ToolName): ToolPolicy {
  return { toolName, risk: ToolRisk.High, mutatesNetSuite: false }
}

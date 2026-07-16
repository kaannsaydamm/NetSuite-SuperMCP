import { z } from "zod"
import type { JsonValue } from "../shared/json"
import {
  AccountPermissionCheckInputSchema,
  AuditLogInputSchema,
  CommitOperationInputSchema,
  EmptyInputSchema,
  GenericTransformOperationInputSchema,
  InventoryAdjustmentAccountSearchInputSchema,
  InventoryStockImportCommitInputSchema,
  InventoryStockImportPrepareInputSchema,
  PrepareCompensationInputSchema,
  PrepareOperationInputSchema,
  PreviewOperationInputSchema,
  PurchaseOrderOperationInputSchema,
  RecordCreateInputSchema,
  RecordDeletePlanInputSchema,
  RecordInputSchema,
  RecordMetadataInputSchema,
  RecordUpdateInputSchema,
  SalesOrderOperationInputSchema,
  SuiteQlInputSchema,
  ToolContractLookupInputSchema,
  ToolName,
  ToolRequestValidationInputSchema,
  TransactionLinesInputSchema,
  toolPolicies,
} from "../tools/catalog"
import { outputSchemaFor } from "../tools/output-schemas"
import { actionInputSchemaFor } from "./action-schemas"
import {
  DiagnoseAuthenticationInputSchema,
  IdentityProfileInputSchema,
  IntegrationStateInputSchema,
  LoginAuditTrailInputSchema,
  RevokeOAuthInputSchema,
  RoleAccessInputSchema,
  RoleComparisonInputSchema,
  SegregationOfDutiesInputSchema,
} from "./identity-schemas"

export type ToolContract = {
  readonly name: ToolName
  readonly title: string
  readonly description: string
  readonly inputSchema: z.ZodTypeAny
  readonly outputSchema: z.ZodTypeAny
  readonly risk: "low" | "medium" | "high" | "critical"
  readonly mutatesNetSuite: boolean
  readonly effects: readonly string[]
  readonly requiredPermissions: readonly string[]
  readonly phaseSupport: readonly ("prepare" | "preview" | "commit")[]
  readonly examples: { readonly valid: JsonValue; readonly invalid: JsonValue }
}

export function getToolContract(name: string): ToolContract {
  if (!isToolName(name)) {
    throw new Error(`UNKNOWN_TOOL: Tool ${name} is not registered`)
  }
  const policy = toolPolicies[name]
  return {
    name,
    title: humanize(name),
    description: policy.mutatesNetSuite
      ? "Prepares or commits a typed NetSuite mutation through the operation planner."
      : "Reads or validates NetSuite information without changing a business record.",
    inputSchema: inputSchemaFor(name),
    outputSchema: outputSchemaFor(name),
    risk: policy.risk,
    mutatesNetSuite: policy.mutatesNetSuite,
    effects:
      name === ToolName.RevokeOAuthAuthorization
        ? ["Revokes the selected OAuth authorization and clears its local access-token cache."]
        : policy.mutatesNetSuite
          ? ["May change NetSuite only during an explicit commit phase."]
          : [],
    requiredPermissions: permissionHints(name),
    phaseSupport: phaseSupport(name),
    examples: examplesFor(name),
  }
}

export function describeTool(name: string) {
  const contract = getToolContract(name)
  return {
    name: contract.name,
    title: contract.title,
    description: contract.description,
    risk: contract.risk,
    mutatesNetSuite: contract.mutatesNetSuite,
    effects: contract.effects,
    requiredPermissions: contract.requiredPermissions,
    phaseSupport: contract.phaseSupport,
    inputSchema: serializableSchema(contract.inputSchema),
    outputSchema: serializableSchema(contract.outputSchema),
  }
}

function serializableSchema(schema: z.ZodTypeAny): JsonValue {
  return JSON.parse(JSON.stringify(z.toJSONSchema(schema))) as JsonValue
}

export function validateToolRequest(name: string, payload: JsonValue) {
  const result = getToolContract(name).inputSchema.safeParse(payload)
  return result.success
    ? { valid: true, normalized: result.data, issues: [] }
    : {
        valid: false,
        issues: flattenIssues(result.error.issues).map((issue) => ({
          code: issue.code,
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      }
}

function flattenIssues(issues: readonly z.core.$ZodIssue[]): readonly z.core.$ZodIssue[] {
  return issues.flatMap((issue) =>
    issue.code === "invalid_union" ? flattenIssues(issue.errors.flat()) : [issue],
  )
}

function inputSchemaFor(name: ToolName): z.ZodTypeAny {
  switch (name) {
    case ToolName.GetEnvironment:
    case ToolName.GetSuperMcpVersion:
    case ToolName.ListCapabilities:
    case ToolName.ListReportTypes:
      return EmptyInputSchema
    case ToolName.CheckAccountPermissions:
      return AccountPermissionCheckInputSchema
    case ToolName.GetAuditLog:
      return AuditLogInputSchema
    case ToolName.GetRecord:
      return RecordInputSchema
    case ToolName.CreateRecord:
      return RecordCreateInputSchema
    case ToolName.UpdateRecord:
    case ToolName.SubmitFields:
      return RecordUpdateInputSchema
    case ToolName.DeleteRecord:
      return RecordDeletePlanInputSchema
    case ToolName.GetRecordMetadata:
      return RecordMetadataInputSchema
    case ToolName.GetTransactionLines:
      return TransactionLinesInputSchema
    case ToolName.RunSuiteQl:
      return SuiteQlInputSchema
    case ToolName.FulfillSalesOrder:
    case ToolName.InvoiceSalesOrder:
      return SalesOrderOperationInputSchema
    case ToolName.ReceivePurchaseOrder:
    case ToolName.BillPurchaseOrder:
      return PurchaseOrderOperationInputSchema
    case ToolName.TransformRecord:
      return GenericTransformOperationInputSchema
    case ToolName.PrepareAction:
      return PrepareOperationInputSchema
    case ToolName.PreviewAction:
      return PreviewOperationInputSchema
    case ToolName.CommitAction:
      return CommitOperationInputSchema
    case ToolName.PrepareCompensation:
      return PrepareCompensationInputSchema
    case ToolName.FindInventoryAdjustmentAccounts:
      return InventoryAdjustmentAccountSearchInputSchema
    case ToolName.PrepareInventoryStockImport:
      return InventoryStockImportPrepareInputSchema
    case ToolName.CommitInventoryStockImport:
      return InventoryStockImportCommitInputSchema
    case ToolName.DescribeTool:
    case ToolName.GetToolExample:
      return ToolContractLookupInputSchema
    case ToolName.ValidateToolRequest:
      return ToolRequestValidationInputSchema
    case ToolName.GetLoginAuditTrail:
      return LoginAuditTrailInputSchema
    case ToolName.DiagnoseAuthentication:
      return DiagnoseAuthenticationInputSchema
    case ToolName.TestOAuthCredentials:
    case ToolName.GetOAuthTokenMetadata:
    case ToolName.ExplainTokenEligibility:
    case ToolName.GetIdentityRelationship:
      return IdentityProfileInputSchema
    case ToolName.RevokeOAuthAuthorization:
      return RevokeOAuthInputSchema
    case ToolName.AnalyzeRoleAccess:
      return RoleAccessInputSchema
    case ToolName.CompareRoleVisibility:
      return RoleComparisonInputSchema
    case ToolName.GetIntegrationState:
      return IntegrationStateInputSchema
    case ToolName.AnalyzeSegregationOfDuties:
      return SegregationOfDutiesInputSchema
    default:
      return actionInputSchemaFor(name)
  }
}

function examplesFor(name: ToolName): { readonly valid: JsonValue; readonly invalid: JsonValue } {
  return { valid: validExampleFor(name), invalid: null }
}

function validExampleFor(name: ToolName): JsonValue {
  switch (name) {
    case ToolName.GetEnvironment:
    case ToolName.GetSuperMcpVersion:
    case ToolName.ListCapabilities:
    case ToolName.ListReportTypes:
      return {}
    case ToolName.CheckAccountPermissions:
      return { recordTypes: ["salesOrder"], includeRestlet: true }
    case ToolName.GetAuditLog:
      return { limit: 20 }
    case ToolName.GetRecord:
    case ToolName.DeleteRecord:
      return { type: "customer", id: "123" }
    case ToolName.CreateRecord:
      return { type: "customer", values: { companyName: "Example" } }
    case ToolName.UpdateRecord:
    case ToolName.SubmitFields:
      return { type: "customer", id: "123", values: { comments: "Reviewed" } }
    case ToolName.GetRecordMetadata:
      return { type: "customer" }
    case ToolName.GetTransactionLines:
      return { type: "salesOrder", id: "123", sublist: "item" }
    case ToolName.RunSuiteQl:
      return { query: "SELECT id FROM customer", limit: 10 }
    case ToolName.FulfillSalesOrder:
    case ToolName.InvoiceSalesOrder:
      return { salesOrderId: "123", selection: { mode: "allOpen" } }
    case ToolName.ReceivePurchaseOrder:
    case ToolName.BillPurchaseOrder:
      return { purchaseOrderId: "123", selection: { mode: "allOpen" } }
    case ToolName.TransformRecord:
      return {
        fromType: "salesOrder",
        fromId: "123",
        toType: "itemFulfillment",
        selection: { mode: "allOpen" },
      }
    case ToolName.PrepareAction:
      return { action: ToolName.CreateFolder, payload: { name: "Example" } }
    case ToolName.PreviewAction:
    case ToolName.PrepareCompensation:
      return { operationId: "123e4567-e89b-42d3-a456-426614174000" }
    case ToolName.CommitAction:
      return {
        operationId: "123e4567-e89b-42d3-a456-426614174000",
        confirmation: "confirm:example",
      }
    case ToolName.FindInventoryAdjustmentAccounts:
      return { search: "inventory", limit: 25 }
    case ToolName.PrepareInventoryStockImport:
      return inventoryImportExample(false)
    case ToolName.CommitInventoryStockImport:
      return inventoryImportExample(false)
    case ToolName.DescribeTool:
    case ToolName.GetToolExample:
      return { name: ToolName.FulfillSalesOrder }
    case ToolName.ValidateToolRequest:
      return { name: ToolName.GetRecord, payload: { type: "customer", id: "123" } }
    case ToolName.GetLoginAuditTrail:
      return { profile: "current", status: "either", limit: 25 }
    case ToolName.DiagnoseAuthentication:
      return { profile: "current", includeAuthenticatedChecks: true }
    case ToolName.TestOAuthCredentials:
    case ToolName.GetOAuthTokenMetadata:
    case ToolName.ExplainTokenEligibility:
    case ToolName.GetIdentityRelationship:
      return { profile: "current" }
    case ToolName.RevokeOAuthAuthorization:
      return { profile: "current", confirmation: "revoke:current:1234567" }
    case ToolName.AnalyzeRoleAccess:
      return { profile: "current", recordFamilies: ["customer"], permissions: [] }
    case ToolName.CompareRoleVisibility:
      return { recordFamilies: ["customer"], permissions: [] }
    case ToolName.GetIntegrationState:
      return {
        profile: "current",
        integrationId: "123",
        fields: ["name", "state"],
        features: ["RESTWEBSERVICES"],
      }
    case ToolName.AnalyzeSegregationOfDuties:
      return {
        profile: "current",
        permissionGroups: [
          { name: "Example conflict", permissions: ["TRAN_SALESORD", "TRAN_CUSTPYMT"] },
        ],
      }
    default:
      return actionExampleFor(name)
  }
}

function inventoryImportExample(commit: boolean): JsonValue {
  return {
    rows: [{ itemKey: "0123456789012", targetQuantity: 3 }],
    locationId: "2",
    adjustmentAccountId: "454",
    ...(commit ? { confirmation: "confirm:inventory-import" } : {}),
  }
}

function actionExampleFor(name: ToolName): JsonValue {
  const examples: Partial<Record<ToolName, JsonValue>> = {
    [ToolName.RunSavedSearch]: { savedSearchId: "customsearch_example", limit: 10 },
    [ToolName.RunReport]: { reportId: "123", limit: 10 },
    [ToolName.ListPlatformObjects]: { recordType: "script", limit: 10 },
    [ToolName.GetPlatformObject]: { recordType: "script", recordId: "123" },
    [ToolName.SearchRecords]: { recordType: "customer", limit: 10 },
    [ToolName.ListReports]: { limit: 10 },
    [ToolName.RunSearch]: { recordType: "customer", limit: 10 },
    [ToolName.CreateSavedSearch]: { recordType: "customer", title: "Example" },
    [ToolName.UpdateSavedSearch]: {
      searchId: "customsearch_example",
      values: { title: "Example" },
    },
    [ToolName.DeleteSavedSearch]: { searchId: "customsearch_example" },
    [ToolName.ListFileCabinet]: { path: "/SuiteScripts", limit: 10 },
    [ToolName.GetFile]: { fileId: "123" },
    [ToolName.WriteFile]: { path: "/SuiteScripts/example.txt", contents: "example" },
    [ToolName.CreateFolder]: { name: "Example" },
    [ToolName.UpdateFolder]: { folderId: "123", name: "Example" },
    [ToolName.DeleteFolder]: { folderId: "123" },
    [ToolName.CopyFile]: { fileId: "123", targetFolderId: "456" },
    [ToolName.MoveFile]: { fileId: "123", targetFolderId: "456" },
    [ToolName.DeleteFile]: { fileId: "123" },
    [ToolName.GetIntegrationLogs]: { recordType: "salesOrder", limit: 10 },
    [ToolName.GetScriptLogs]: { scriptId: "123", limit: 10 },
    [ToolName.FindScriptErrors]: { scriptId: "123", limit: 10 },
    [ToolName.ListScripts]: { query: "integration", limit: 10 },
    [ToolName.ListScriptDeployments]: { scriptId: "123", limit: 10 },
    [ToolName.GetFailedIntegrationJobs]: { recordType: "customrecord_job", limit: 10 },
    [ToolName.ExplainIntegrationError]: { recordType: "customrecord_job", recordId: "123" },
    [ToolName.RetryIntegrationJob]: {
      recordType: "customrecord_job",
      recordId: "123",
      values: { status: "retry" },
    },
    [ToolName.GetMapping]: { recordType: "customrecord_mapping", recordId: "123" },
    [ToolName.UpdateMapping]: {
      recordType: "customrecord_mapping",
      recordId: "123",
      values: { target: "example" },
    },
  }
  const example = examples[name]
  if (example === undefined) {
    throw new Error(`MISSING_TOOL_EXAMPLE: ${name} has no valid request example`)
  }
  return example
}

function phaseSupport(name: ToolName): readonly ("prepare" | "preview" | "commit")[] {
  if (name === ToolName.RevokeOAuthAuthorization) return ["commit"]
  if (name === ToolName.CommitAction) return ["commit"]
  if (name === ToolName.PreviewAction) return ["preview"]
  if (toolPolicies[name].mutatesNetSuite) return ["prepare", "preview", "commit"]
  return ["preview"]
}

function permissionHints(name: ToolName): readonly string[] {
  if (name === ToolName.GetLoginAuditTrail) return ["View Login Audit Trail"]
  if (name === ToolName.RevokeOAuthAuthorization) return ["OAuth authorization owner"]
  if (name.includes("File") || name.includes("Folder")) return ["Documents and Files"]
  if (name.includes("Script")) return ["SuiteScript"]
  if (name.includes("Inventory")) return ["Inventory", "Inventory Adjustment"]
  return toolPolicies[name].mutatesNetSuite
    ? ["Record-specific create or edit permission"]
    : ["Record-specific view permission"]
}

function isToolName(name: string): name is ToolName {
  return Object.values(ToolName).includes(name as ToolName)
}

function humanize(name: string): string {
  return name.replace(/^ns_/, "").replace(/([a-z])([A-Z])/g, "$1 $2")
}

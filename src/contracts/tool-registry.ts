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
  CleanupPlanInputSchema,
  CustomizationDiffInputSchema,
  CustomizationInventoryInputSchema,
  DeploymentInputSchema,
  GenerateCustomizationDocsInputSchema,
  GenerateCustomizationProjectInputSchema,
  MigrationPlanInputSchema,
  PrepareCustomizationDeploymentInputSchema,
  ProjectInputSchema,
  RecordDeploymentResultInputSchema,
} from "./customization-schemas"
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
import {
  AckOutboxInputSchema,
  AnonymizePayloadInputSchema,
  CanaryInputSchema,
  CanaryMonitorInputSchema,
  CanaryPrepareInputSchema,
  DefineIntegrationContractInputSchema,
  EmitIntegrationEventInputSchema,
  IntegrationHealthInputSchema,
  PollOutboxInputSchema,
  ReconcileRecordsInputSchema,
  RegressionSuiteInputSchema,
  ReplayPayloadInputSchema,
  ShadowPayloadInputSchema,
  SubscribeIntegrationEventsInputSchema,
  SyntheticTransactionsInputSchema,
  ValidateIntegrationContractInputSchema,
} from "./integration-schemas"
import {
  AnalyzeSuiteQlInputSchema,
  BuildSuiteQlInputSchema,
  CreateReadJobInputSchema,
  DiffSavedSearchDefinitionsInputSchema,
  ExportSavedSearchInputSchema,
  ExportSuiteQlInputSchema,
  IncrementalExportInputSchema,
  JobInputSchema,
  PreviewCloneSavedSearchInputSchema,
  ResumeJobInputSchema,
  RunJobStepInputSchema,
  RunSuiteQlPagedInputSchema,
  SavedSearchDefinitionInputSchema,
} from "./query-schemas"
import {
  BatchGetRecordsInputSchema,
  BatchResolveInternalIdsInputSchema,
  CreateEvidenceBundleInputSchema,
  DescribeFieldInputSchema,
  DescribeRecordTypeInputSchema,
  DiagnoseTransactionInputSchema,
  DiffRecordSnapshotsInputSchema,
  FindFieldByLabelInputSchema,
  FindRecordByExternalIdInputSchema,
  GetRecordWithSublistsInputSchema,
  ListRecordFieldsInputSchema,
  ListRecordTypesInputSchema,
  RecordSnapshotInputSchema,
  SystemNotesInputSchema,
  TransactionChainInputSchema,
} from "./record-explorer-schemas"
import {
  FieldUsageInputSchema,
  RecordUsageInputSchema,
  ScriptGraphInputSchema,
  ScriptObservabilityInputSchema,
  ScriptSelectorSchema,
} from "./script-schemas"

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
    case ToolName.ListRecordTypes:
      return ListRecordTypesInputSchema
    case ToolName.DescribeRecordType:
      return DescribeRecordTypeInputSchema
    case ToolName.ListRecordFields:
      return ListRecordFieldsInputSchema
    case ToolName.DescribeField:
      return DescribeFieldInputSchema
    case ToolName.FindFieldByLabel:
      return FindFieldByLabelInputSchema
    case ToolName.FindRecordByExternalId:
      return FindRecordByExternalIdInputSchema
    case ToolName.BatchResolveInternalIds:
      return BatchResolveInternalIdsInputSchema
    case ToolName.BatchGetRecords:
      return BatchGetRecordsInputSchema
    case ToolName.GetRecordWithSublists:
      return GetRecordWithSublistsInputSchema
    case ToolName.GetTransactionChain:
      return TransactionChainInputSchema
    case ToolName.GetSystemNotes:
    case ToolName.ExplainRecordHistory:
    case ToolName.GetTransactionEventStream:
      return SystemNotesInputSchema
    case ToolName.DiagnoseTransaction:
      return DiagnoseTransactionInputSchema
    case ToolName.CreateRecordSnapshot:
      return RecordSnapshotInputSchema
    case ToolName.DiffRecordSnapshots:
      return DiffRecordSnapshotsInputSchema
    case ToolName.CreateEvidenceBundle:
      return CreateEvidenceBundleInputSchema
    case ToolName.BuildSuiteQl:
      return BuildSuiteQlInputSchema
    case ToolName.ValidateSuiteQl:
    case ToolName.ExplainSuiteQl:
      return AnalyzeSuiteQlInputSchema
    case ToolName.RunSuiteQlPaged:
      return RunSuiteQlPagedInputSchema
    case ToolName.CreateReadJob:
      return CreateReadJobInputSchema
    case ToolName.GetJobStatus:
    case ToolName.CancelJob:
      return JobInputSchema
    case ToolName.ResumeJob:
      return ResumeJobInputSchema
    case ToolName.RunJobStep:
      return RunJobStepInputSchema
    case ToolName.IncrementalExport:
      return IncrementalExportInputSchema
    case ToolName.ExportSuiteQl:
      return ExportSuiteQlInputSchema
    case ToolName.ExportSavedSearch:
      return ExportSavedSearchInputSchema
    case ToolName.ExportSavedSearchDefinition:
      return SavedSearchDefinitionInputSchema
    case ToolName.DiffSavedSearchDefinitions:
      return DiffSavedSearchDefinitionsInputSchema
    case ToolName.PreviewCloneSavedSearch:
      return PreviewCloneSavedSearchInputSchema
    case ToolName.GetScriptObservability:
      return ScriptObservabilityInputSchema
    case ToolName.AnalyzeScript:
      return ScriptSelectorSchema
    case ToolName.FindScriptDependencies:
    case ToolName.FindDuplicateScriptLogic:
      return ScriptGraphInputSchema
    case ToolName.FindRecordWriters:
    case ToolName.FindRecordReaders:
      return RecordUsageInputSchema
    case ToolName.FindFieldUsage:
      return FieldUsageInputSchema
    case ToolName.GetIntegrationHealth:
      return IntegrationHealthInputSchema
    case ToolName.DefineIntegrationContract:
      return DefineIntegrationContractInputSchema
    case ToolName.ValidateIntegrationContract:
      return ValidateIntegrationContractInputSchema
    case ToolName.ReconcileRecords:
    case ToolName.ReconcileOrders:
    case ToolName.ReconcileInventory:
    case ToolName.ReconcileReturns:
    case ToolName.ReconcilePayments:
      return ReconcileRecordsInputSchema
    case ToolName.ShadowPayload:
      return ShadowPayloadInputSchema
    case ToolName.ReplayPayload:
      return ReplayPayloadInputSchema
    case ToolName.PrepareCanary:
      return CanaryPrepareInputSchema
    case ToolName.MonitorCanary:
      return CanaryMonitorInputSchema
    case ToolName.PromoteCanary:
    case ToolName.AbortCanary:
      return CanaryInputSchema
    case ToolName.GenerateSyntheticTransactions:
      return SyntheticTransactionsInputSchema
    case ToolName.AnonymizePayload:
      return AnonymizePayloadInputSchema
    case ToolName.GenerateRegressionTests:
    case ToolName.RunRegressionTests:
      return RegressionSuiteInputSchema
    case ToolName.SubscribeIntegrationEvents:
      return SubscribeIntegrationEventsInputSchema
    case ToolName.EmitIntegrationEvent:
      return EmitIntegrationEventInputSchema
    case ToolName.PollIntegrationOutbox:
      return PollOutboxInputSchema
    case ToolName.AckIntegrationEvent:
      return AckOutboxInputSchema
    case ToolName.InventoryCustomizations:
      return CustomizationInventoryInputSchema
    case ToolName.DiffCustomizationEnvironments:
      return CustomizationDiffInputSchema
    case ToolName.GenerateSuiteCloudProject:
      return GenerateCustomizationProjectInputSchema
    case ToolName.ValidateSuiteCloudProject:
    case ToolName.PrepareCustomizationRollback:
      return ProjectInputSchema
    case ToolName.PreviewCustomizationDeployment:
    case ToolName.PrepareCustomizationDeployment:
      return PrepareCustomizationDeploymentInputSchema
    case ToolName.GetCustomizationDeployment:
    case ToolName.VerifyCustomizationDeployment:
      return DeploymentInputSchema
    case ToolName.RecordCustomizationDeploymentResult:
      return RecordDeploymentResultInputSchema
    case ToolName.PlanCustomizationMigration:
      return MigrationPlanInputSchema
    case ToolName.PlanCustomizationCleanup:
      return CleanupPlanInputSchema
    case ToolName.GenerateSystemDocumentation:
      return GenerateCustomizationDocsInputSchema
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
    case ToolName.ListRecordTypes:
      return { search: "sales", limit: 20 }
    case ToolName.DescribeRecordType:
      return { type: "salesOrder" }
    case ToolName.ListRecordFields:
      return { type: "salesOrder", search: "customer", limit: 50 }
    case ToolName.DescribeField:
      return { type: "salesOrder", fieldId: "entity" }
    case ToolName.FindFieldByLabel:
      return { type: "salesOrder", label: "Customer", limit: 10 }
    case ToolName.FindRecordByExternalId:
      return { type: "customer", externalId: "example", limit: 5 }
    case ToolName.BatchResolveInternalIds:
      return { type: "inventoryItem", matchField: "upccode", values: ["0123456789012"] }
    case ToolName.BatchGetRecords:
      return { records: [{ type: "customer", id: "123" }] }
    case ToolName.GetRecordWithSublists:
      return { type: "salesOrder", id: "123", sublists: ["item"], lineLimit: 100 }
    case ToolName.GetTransactionChain:
      return { type: "salesOrder", id: "123", maxNodes: 100, integrationReferences: [] }
    case ToolName.GetSystemNotes:
    case ToolName.ExplainRecordHistory:
    case ToolName.GetTransactionEventStream:
      return { type: "salesOrder", id: "123", limit: 100 }
    case ToolName.DiagnoseTransaction:
      return { type: "salesOrder", id: "123", maxNodes: 100, includeSystemNotes: true }
    case ToolName.CreateRecordSnapshot:
      return { type: "salesOrder", id: "123", sublists: ["item"], lineLimit: 100 }
    case ToolName.DiffRecordSnapshots:
      return {
        before: {
          ref: { type: "customer", id: "123" },
          fingerprint: "before",
          record: { id: "123", companyName: "Before" },
          sublists: {},
        },
        after: {
          ref: { type: "customer", id: "123" },
          fingerprint: "after",
          record: { id: "123", companyName: "After" },
          sublists: {},
        },
      }
    case ToolName.CreateEvidenceBundle:
      return {
        name: "case-123",
        items: [{ kind: "record", source: "customer:123", payload: { id: "123" } }],
      }
    case ToolName.BuildSuiteQl:
      return {
        table: "customer",
        fields: ["id", "entityid"],
        filters: [{ field: "isinactive", operator: "=", value: "F" }],
        joins: [],
      }
    case ToolName.ValidateSuiteQl:
    case ToolName.ExplainSuiteQl:
      return { query: "SELECT id FROM customer WHERE isinactive = ?", params: ["F"] }
    case ToolName.RunSuiteQlPaged:
    case ToolName.IncrementalExport:
      return {
        query: "SELECT id, entityid FROM customer",
        params: [],
        keyField: "id",
        keyIsUnique: true,
        pageSize: 100,
        rowBudget: 1000,
      }
    case ToolName.CreateReadJob:
    case ToolName.ExportSuiteQl:
      return {
        kind: "suiteql",
        query: "SELECT id, entityid FROM customer",
        params: [],
        keyField: "id",
        keyIsUnique: true,
        pageSize: 500,
        rowBudget: 10000,
        format: "jsonl",
        compression: "gzip",
      }
    case ToolName.ExportSavedSearch:
      return {
        kind: "savedSearch",
        savedSearchId: "customsearch_example",
        pageSize: 500,
        rowBudget: 10000,
        format: "csv",
        compression: "gzip",
      }
    case ToolName.GetJobStatus:
    case ToolName.CancelJob:
      return { jobId: "123e4567-e89b-42d3-a456-426614174000" }
    case ToolName.ResumeJob:
      return { jobId: "123e4567-e89b-42d3-a456-426614174000", recoverRunning: false }
    case ToolName.RunJobStep:
      return { jobId: "123e4567-e89b-42d3-a456-426614174000", maxChunks: 1 }
    case ToolName.ExportSavedSearchDefinition:
      return { savedSearchId: "customsearch_example" }
    case ToolName.DiffSavedSearchDefinitions:
      return {
        before: {
          id: "customsearch_before",
          searchType: "customer",
          title: "Before",
          isPublic: false,
          filters: [],
          columns: [{ name: "internalid" }],
        },
        after: {
          id: "customsearch_after",
          searchType: "customer",
          title: "After",
          isPublic: false,
          filters: [],
          columns: [{ name: "internalid" }],
        },
      }
    case ToolName.PreviewCloneSavedSearch:
      return {
        sourceSearchId: "customsearch_example",
        targetTitle: "Example clone",
        targetSearchId: "customsearch_example_clone",
      }
    case ToolName.GetScriptObservability:
      return { scriptId: "customscript_example", maxExecutions: 25 }
    case ToolName.AnalyzeScript:
      return { scriptId: "customscript_example", maxScripts: 1 }
    case ToolName.FindScriptDependencies:
    case ToolName.FindDuplicateScriptLogic:
      return { scriptIds: ["customscript_example"], maxScripts: 10 }
    case ToolName.FindRecordWriters:
    case ToolName.FindRecordReaders:
      return { recordType: "salesorder", scriptIds: ["customscript_example"] }
    case ToolName.FindFieldUsage:
      return { fieldId: "custbody_external_id", scriptIds: ["customscript_example"] }
    case ToolName.GetIntegrationHealth:
      return {
        integrationId: "orders",
        processed: 10,
        pending: 1,
        failed: 0,
        outputState: "unknown",
        errors: [],
      }
    case ToolName.DefineIntegrationContract:
      return integrationContractExample()
    case ToolName.ValidateIntegrationContract:
      return { contract: integrationContractExample(), records: [] }
    case ToolName.ReconcileRecords:
    case ToolName.ReconcileOrders:
    case ToolName.ReconcileInventory:
    case ToolName.ReconcileReturns:
    case ToolName.ReconcilePayments:
      return {
        domain: "generic",
        contract: integrationContractExample(),
        sourceName: "external",
        targetName: "NetSuite",
        sourceRecords: [],
        targetRecords: [],
      }
    case ToolName.ShadowPayload:
      return { action: ToolName.CreateSavedSearch, payload: { title: "Preview" } }
    case ToolName.ReplayPayload:
      return {
        mode: "simulation",
        action: ToolName.CreateSavedSearch,
        payload: { title: "Preview" },
      }
    case ToolName.PrepareCanary:
      return {
        name: "order canary",
        predicate: { field: "externalid", operator: "equals", value: "TEST-1" },
        maxRecords: 1,
        operationIds: ["123e4567-e89b-42d3-a456-426614174000"],
      }
    case ToolName.MonitorCanary:
      return { canaryId: "123e4567-e89b-42d3-a456-426614174000", observations: [] }
    case ToolName.PromoteCanary:
    case ToolName.AbortCanary:
      return { canaryId: "123e4567-e89b-42d3-a456-426614174000" }
    case ToolName.GenerateSyntheticTransactions:
      return {
        count: 2,
        seed: "test",
        template: { status: "pending" },
        sequenceFields: ["externalId"],
      }
    case ToolName.AnonymizePayload:
      return { records: [{ email: "person@example.com" }], fields: ["email"], salt: "example-salt" }
    case ToolName.GenerateRegressionTests:
    case ToolName.RunRegressionTests:
      return {
        name: "preview suite",
        cases: [
          { id: "case-1", action: ToolName.CreateSavedSearch, payload: {}, expectedFields: {} },
        ],
      }
    case ToolName.SubscribeIntegrationEvents:
      return {
        subscriptionId: "orders",
        eventTypes: ["failed"],
        endpoint: "https://example.com/events",
      }
    case ToolName.EmitIntegrationEvent:
      return {
        subscriptionId: "orders",
        eventType: "failed",
        idempotencyKey: "event-1",
        payload: {},
      }
    case ToolName.PollIntegrationOutbox:
      return { limit: 20 }
    case ToolName.AckIntegrationEvent:
      return { eventId: "123e4567-e89b-42d3-a456-426614174000", delivered: true }
    case ToolName.InventoryCustomizations:
      return { categories: ["script", "workflow"], maxPerCategory: 100 }
    case ToolName.DiffCustomizationEnvironments:
      return {
        sourceEnvironment: "sandbox",
        targetEnvironment: "production",
        source: [customizationExample()],
        target: [],
      }
    case ToolName.GenerateSuiteCloudProject:
      return {
        name: "selected-customizations",
        customizations: [customizationExample()],
        files: [{ path: "FileCabinet/SuiteScripts/example.js", content: "define([], () => ({}))" }],
      }
    case ToolName.ValidateSuiteCloudProject:
    case ToolName.PrepareCustomizationRollback:
      return { projectId: "123e4567-e89b-42d3-a456-426614174000" }
    case ToolName.PreviewCustomizationDeployment:
    case ToolName.PrepareCustomizationDeployment:
      return {
        projectId: "123e4567-e89b-42d3-a456-426614174000",
        changedScriptIds: ["customscript_example"],
        expectedLiveVersion: "0.1.34",
      }
    case ToolName.GetCustomizationDeployment:
    case ToolName.VerifyCustomizationDeployment:
      return { deploymentId: "123e4567-e89b-42d3-a456-426614174000" }
    case ToolName.RecordCustomizationDeploymentResult:
      return {
        deploymentId: "123e4567-e89b-42d3-a456-426614174000",
        confirmation: "recordCustomizationDeployment:123e4567-e89b-42d3-a456-426614174000",
        succeeded: true,
        uploadedFiles: ["SuiteScripts/example.js"],
        changedObjects: ["customscript_example"],
        validationWarnings: [],
        providerEvidence: [{ command: "project:deploy", exitCode: 0 }],
      }
    case ToolName.PlanCustomizationMigration:
      return {
        sourceAccount: "source",
        targetAccount: "target",
        customizations: [customizationExample()],
        targetScriptIds: [],
      }
    case ToolName.PlanCustomizationCleanup:
      return {
        customizations: [customizationExample()],
        usageEvidence: [{ scriptId: "customscript_example", references: 0, evidence: ["search"] }],
      }
    case ToolName.GenerateSystemDocumentation:
      return { title: "NetSuite Customizations", customizations: [customizationExample()] }
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

function integrationContractExample(): JsonValue {
  return {
    id: "orders-v1",
    version: 1,
    domain: "orders",
    keyFields: ["externalId"],
    fields: {
      externalId: { type: "string", required: true, semantic: "identity" },
      amount: { type: "number", required: true, semantic: "amount" },
    },
    mappings: {},
    invariants: [{ rule: "nonnegative", field: "amount" }],
  }
}

function customizationExample(): JsonValue {
  return {
    type: "script",
    scriptId: "customscript_example",
    name: "Example",
    definition: { scriptType: "RESTlet" },
    permissions: [],
    dependencies: [],
    metadata: { provenance: [{ source: "example" }] },
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

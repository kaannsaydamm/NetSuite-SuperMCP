import { z } from "zod"
import { AssuranceOutputSchema } from "../contracts/assurance-schemas"
import { HarnessOutputSchema } from "../contracts/harness-schemas"
import {
  AuthenticationDiagnosisOutputSchema,
  IdentityRelationshipOutputSchema,
  IntegrationStateOutputSchema,
  LoginAuditTrailOutputSchema,
  OAuthRevocationOutputSchema,
  RoleAccessOutputSchema,
  RoleComparisonOutputSchema,
  SegregationOfDutiesOutputSchema,
  TokenEligibilityOutputSchema,
  TokenMetadataOutputSchema,
} from "../contracts/identity-schemas"
import { QueryOutputSchema } from "../contracts/query-schemas"
import { RecordExplorerOutputSchema } from "../contracts/record-explorer-schemas"
import { RunbookOutputSchema } from "../contracts/runbook-schemas"
import { SemanticOutputSchema } from "../contracts/semantic-schemas"
import { OperationPlanSchema } from "../operations/operation-plan"
import { JsonValueSchema } from "../shared/json"
import { ToolName } from "./catalog"

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

const CompensationPlanOutputSchema = z
  .object({
    operationId: z.string().uuid(),
    strategy: z.enum(["delete", "void", "counterTransaction", "manualReview"]),
    atomic: z.literal(false),
    reversible: z.boolean(),
    explanation: z.string(),
    target: z.record(z.string(), JsonValueSchema).optional(),
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
      effects: z.array(z.string()),
      requiredPermissions: z.array(z.string()),
      phaseSupport: z.array(z.enum(["prepare", "preview", "commit"])),
    }),
  ),
})

const ToolDescriptionOutputSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  risk: z.enum(["low", "medium", "high", "critical"]),
  mutatesNetSuite: z.boolean(),
  effects: z.array(z.string()),
  requiredPermissions: z.array(z.string()),
  phaseSupport: z.array(z.enum(["prepare", "preview", "commit"])),
  inputSchema: JsonValueSchema,
  outputSchema: JsonValueSchema,
})

const ScriptAnalysisOutputSchema = z
  .object({
    sourceCount: z.number().int().nonnegative().optional(),
    gaps: z.array(JsonValueSchema).optional(),
  })
  .loose()

const IntegrationOutputSchema = z.object({}).loose()
const CustomizationOutputSchema = z.object({}).loose()

const ToolExampleOutputSchema = z.object({
  name: z.string(),
  valid: JsonValueSchema,
  invalid: JsonValueSchema,
})

const ToolValidationOutputSchema = z.object({
  valid: z.boolean(),
  normalized: JsonValueSchema.optional(),
  issues: z.array(
    z.object({
      code: z.string(),
      path: z.string(),
      message: z.string(),
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
    case ToolName.DescribeTool:
      return ToolDescriptionOutputSchema
    case ToolName.GetToolExample:
      return ToolExampleOutputSchema
    case ToolName.ValidateToolRequest:
      return ToolValidationOutputSchema
    case ToolName.GetLoginAuditTrail:
      return LoginAuditTrailOutputSchema
    case ToolName.DiagnoseAuthentication:
    case ToolName.TestOAuthCredentials:
      return AuthenticationDiagnosisOutputSchema
    case ToolName.GetOAuthTokenMetadata:
      return TokenMetadataOutputSchema
    case ToolName.RevokeOAuthAuthorization:
      return OAuthRevocationOutputSchema
    case ToolName.AnalyzeRoleAccess:
      return RoleAccessOutputSchema
    case ToolName.CompareRoleVisibility:
      return RoleComparisonOutputSchema
    case ToolName.ExplainTokenEligibility:
      return TokenEligibilityOutputSchema
    case ToolName.GetIdentityRelationship:
      return IdentityRelationshipOutputSchema
    case ToolName.GetIntegrationState:
      return IntegrationStateOutputSchema
    case ToolName.AnalyzeSegregationOfDuties:
      return SegregationOfDutiesOutputSchema
    case ToolName.ListRecordTypes:
    case ToolName.DescribeRecordType:
    case ToolName.ListRecordFields:
    case ToolName.DescribeField:
    case ToolName.FindFieldByLabel:
    case ToolName.FindRecordByExternalId:
    case ToolName.BatchResolveInternalIds:
    case ToolName.BatchGetRecords:
    case ToolName.GetRecordWithSublists:
    case ToolName.GetTransactionChain:
    case ToolName.GetSystemNotes:
    case ToolName.ExplainRecordHistory:
    case ToolName.GetTransactionEventStream:
    case ToolName.DiagnoseTransaction:
    case ToolName.CreateRecordSnapshot:
    case ToolName.DiffRecordSnapshots:
    case ToolName.CreateEvidenceBundle:
      return RecordExplorerOutputSchema
    case ToolName.BuildSuiteQl:
    case ToolName.ValidateSuiteQl:
    case ToolName.ExplainSuiteQl:
    case ToolName.RunSuiteQlPaged:
    case ToolName.CreateReadJob:
    case ToolName.GetJobStatus:
    case ToolName.RunJobStep:
    case ToolName.CancelJob:
    case ToolName.ResumeJob:
    case ToolName.IncrementalExport:
    case ToolName.ExportSuiteQl:
    case ToolName.ExportSavedSearch:
    case ToolName.ExportSavedSearchDefinition:
    case ToolName.DiffSavedSearchDefinitions:
    case ToolName.PreviewCloneSavedSearch:
      return QueryOutputSchema
    case ToolName.RunSuiteQl:
      return SuiteQlOutputSchema
    case ToolName.GetRecord:
    case ToolName.GetRecordMetadata:
    case ToolName.GetTransactionLines:
      return NetSuiteRecordOutputSchema
    case ToolName.CreateRecord:
    case ToolName.UpdateRecord:
    case ToolName.SubmitFields:
    case ToolName.DeleteRecord:
      return OperationPlanSchema
    case ToolName.FindInventoryAdjustmentAccounts:
      return InventoryAdjustmentAccountOutputSchema
    case ToolName.PrepareInventoryStockImport:
    case ToolName.CommitInventoryStockImport:
      return OperationPlanSchema
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
      return OperationPlanSchema
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
      return OperationPlanSchema
    case ToolName.GetIntegrationLogs:
    case ToolName.GetScriptLogs:
    case ToolName.FindScriptErrors:
    case ToolName.ListScripts:
    case ToolName.ListScriptDeployments:
      return RestletActionOutputSchema
    case ToolName.GetScriptObservability:
    case ToolName.AnalyzeScript:
    case ToolName.FindScriptDependencies:
    case ToolName.FindRecordWriters:
    case ToolName.FindRecordReaders:
    case ToolName.FindFieldUsage:
    case ToolName.FindDuplicateScriptLogic:
      return ScriptAnalysisOutputSchema
    case ToolName.GetIntegrationHealth:
    case ToolName.DefineIntegrationContract:
    case ToolName.ValidateIntegrationContract:
    case ToolName.ReconcileRecords:
    case ToolName.ReconcileOrders:
    case ToolName.ReconcileInventory:
    case ToolName.ReconcileReturns:
    case ToolName.ReconcilePayments:
    case ToolName.ShadowPayload:
    case ToolName.ReplayPayload:
    case ToolName.PrepareCanary:
    case ToolName.MonitorCanary:
    case ToolName.PromoteCanary:
    case ToolName.AbortCanary:
    case ToolName.GenerateSyntheticTransactions:
    case ToolName.AnonymizePayload:
    case ToolName.GenerateRegressionTests:
    case ToolName.RunRegressionTests:
    case ToolName.SubscribeIntegrationEvents:
    case ToolName.EmitIntegrationEvent:
    case ToolName.PollIntegrationOutbox:
    case ToolName.AckIntegrationEvent:
      return IntegrationOutputSchema
    case ToolName.InventoryCustomizations:
    case ToolName.DiffCustomizationEnvironments:
    case ToolName.GenerateSuiteCloudProject:
    case ToolName.ValidateSuiteCloudProject:
    case ToolName.PreviewCustomizationDeployment:
    case ToolName.PrepareCustomizationDeployment:
    case ToolName.GetCustomizationDeployment:
    case ToolName.RecordCustomizationDeploymentResult:
    case ToolName.VerifyCustomizationDeployment:
    case ToolName.PrepareCustomizationRollback:
    case ToolName.PlanCustomizationMigration:
    case ToolName.PlanCustomizationCleanup:
    case ToolName.GenerateSystemDocumentation:
      return CustomizationOutputSchema
    case ToolName.DefineBusinessTerm:
    case ToolName.DefineMetric:
    case ToolName.DeleteBusinessTerm:
    case ToolName.DeleteMetric:
    case ToolName.GetMetricDefinition:
    case ToolName.PlanBusinessQuery:
    case ToolName.ValidateMetricPlan:
    case ToolName.RunMetric:
    case ToolName.CompareMetricDefinitions:
    case ToolName.TraceMetricLineage:
    case ToolName.GenerateMetricReport:
    case ToolName.ExportMetricResult:
      return SemanticOutputSchema
    case ToolName.DiscoverProcess:
    case ToolName.DiscoverBusinessRules:
    case ToolName.AnalyzeFieldWriteConflicts:
    case ToolName.ProfileDataQuality:
    case ToolName.ValidateMasterData:
    case ToolName.EvaluateInvariants:
    case ToolName.EvaluatePolicyFacts:
    case ToolName.SimulateDownstreamImpact:
    case ToolName.PreviewGlImpact:
    case ToolName.SimulateInventoryState:
    case ToolName.SimulateChannelAllocation:
    case ToolName.RankRootCauses:
      return AssuranceOutputSchema
    case ToolName.DefineRunbook:
    case ToolName.PreviewRunbook:
    case ToolName.StartRunbook:
    case ToolName.GetRunbookExecution:
    case ToolName.RecordRunbookStep:
    case ToolName.ProposeRepair:
    case ToolName.PrepareBoundedRepair:
    case ToolName.CorrelateIncidents:
    case ToolName.MeasureSla:
    case ToolName.BuildSupportEvidenceBundle:
    case ToolName.GenerateLiveDocumentation:
    case ToolName.RecordEvidenceClaim:
    case ToolName.GetEvidenceMemory:
      return RunbookOutputSchema
    case ToolName.GetHarnessContext:
    case ToolName.GetHarnessBudget:
    case ToolName.GetCatalogProfile:
    case ToolName.CreateCompositeTool:
    case ToolName.GetCompositeTool:
      return HarnessOutputSchema
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
      return OperationPlanSchema
    case ToolName.PrepareCompensation:
      return CompensationPlanOutputSchema
    case ToolName.GetMapping:
    case ToolName.PreviewAction:
    case ToolName.CommitAction:
      return RestletActionOutputSchema
    default:
      throw new Error(`MISSING_OUTPUT_SCHEMA: ${toolName} has no typed output schema`)
  }
}

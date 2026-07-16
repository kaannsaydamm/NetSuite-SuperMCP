import type { AuditLog } from "../audit"
import type { AppConfig } from "../config"
import type { CustomizationStore } from "../customizations/customization-store"
import type { IntegrationStore } from "../integrations/integration-store"
import type { ExportStore } from "../jobs/export-store"
import type { JobStore } from "../jobs/job-store"
import type { NetSuiteClient } from "../netsuite/client"
import type { OAuthControl } from "../netsuite/oauth"
import type { OperationStore } from "../operations/operation-store"
import type { CursorCodec } from "../query/suiteql"

export type ToolDependencies = {
  readonly config: AppConfig
  readonly auditLog: AuditLog
  readonly netsuite: NetSuiteClient
  readonly managementNetsuite?: NetSuiteClient
  readonly oauthControl?: OAuthControl
  readonly managementOauthControl?: OAuthControl
  readonly operationStore: OperationStore
  readonly jobStore: JobStore
  readonly exportStore: ExportStore
  readonly cursorCodec: CursorCodec
  readonly integrationStore: IntegrationStore
  readonly customizationStore: CustomizationStore
  readonly requester: string
  readonly client: string
}

export type ToolResponse = {
  readonly content: { readonly type: "text"; readonly text: string }[]
  readonly isError?: boolean
  readonly structuredContent?: Record<string, unknown>
}

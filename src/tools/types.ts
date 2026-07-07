import type { AuditLog } from "../audit"
import type { AppConfig } from "../config"
import type { NetSuiteClient } from "../netsuite/client"

export type ToolDependencies = {
  readonly config: AppConfig
  readonly auditLog: AuditLog
  readonly netsuite: NetSuiteClient
  readonly requester: string
  readonly client: string
}

export type ToolResponse = {
  readonly content: { readonly type: "text"; readonly text: string }[]
  readonly isError?: boolean
}

import type { AuditLog } from "../audit"
import type { AppConfig } from "../config"
import type { NetSuiteClient } from "../netsuite/client"
import type { OperationStore } from "../operations/operation-store"

export type ToolDependencies = {
  readonly config: AppConfig
  readonly auditLog: AuditLog
  readonly netsuite: NetSuiteClient
  readonly operationStore: OperationStore
  readonly requester: string
  readonly client: string
}

export type ToolResponse = {
  readonly content: { readonly type: "text"; readonly text: string }[]
  readonly isError?: boolean
  readonly structuredContent?: Record<string, unknown>
}

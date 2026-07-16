import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AppConfig } from "../src/config"
import type { NetSuiteClient } from "../src/netsuite/client"
import type {
  RecordCreateRequest,
  RecordDeleteRequest,
  RecordMetadataRequest,
  RecordRef,
  RecordUpdateRequest,
  RestletAction,
  SuiteQlRequest,
  TransactionLinesRequest,
} from "../src/netsuite/types"
import type { JsonObject } from "../src/shared/json"

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = {
    serverName: "NetSuite SuperMCP",
    serverVersion: "0.1.0",
    host: "127.0.0.1",
    port: 3025,
    authMode: "bearer",
    bearerToken: "test-token-12345",
    netsuite: {
      accountId: "1234567_SB1",
      environment: "sandbox",
      baseUrl: "https://1234567-sb1.suitetalk.api.netsuite.com",
      restletUrl: "https://1234567-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl",
      oauthFlow: "client_credentials",
      consumerKey: "consumer-key",
      certificateId: "cert-id",
      privateKeyPemBase64: "cGVt",
      tokenUrl: "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token",
    },
    auditLogPath: "./data/test-audit.ndjson",
    jobStorePath: "./data/test-read-jobs.json",
    exportDirectory: "./data/test-exports",
    integrationStorePath: "./data/test-integrations.json",
    customizationStorePath: "./data/test-customization-deployments.json",
    customizationProjectDirectory: "./data/test-customization-projects",
    semanticStorePath: "./data/test-semantic-definitions.json",
    runbookStorePath: "./data/test-runbooks.json",
    compositeStorePath: "./data/test-composites.json",
    harnessBudgetStorePath: "./data/test-harness-budgets.json",
    lowRiskRepairClasses: [],
    cursorSecret: "test-cursor-secret-value",
  } satisfies AppConfig

  return { ...base, ...overrides }
}

export async function tempAuditPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "netsuite-supermcp-"))
  return join(dir, "audit.ndjson")
}

export class FakeNetSuiteClient implements NetSuiteClient {
  readonly actions: RestletAction[] = []
  readonly createdRecords: RecordCreateRequest[] = []
  readonly updatedRecords: RecordUpdateRequest[] = []
  readonly submittedFields: RecordUpdateRequest[] = []
  readonly deletedRecords: RecordDeleteRequest[] = []
  readonly metadataRequests: RecordMetadataRequest[] = []
  readonly transactionLineRequests: TransactionLinesRequest[] = []

  async getRecord(ref: RecordRef): Promise<JsonObject> {
    return { recordType: ref.type, id: ref.id }
  }

  async createRecord(request: RecordCreateRequest): Promise<JsonObject> {
    this.createdRecords.push(request)
    return { type: request.type, id: "created-record-id" }
  }

  async updateRecord(request: RecordUpdateRequest): Promise<JsonObject> {
    this.updatedRecords.push(request)
    return { type: request.type, id: request.id, updated: true }
  }

  async submitFields(request: RecordUpdateRequest): Promise<JsonObject> {
    this.submittedFields.push(request)
    return { type: request.type, id: request.id, submitted: true }
  }

  async deleteRecord(request: RecordDeleteRequest): Promise<JsonObject> {
    this.deletedRecords.push(request)
    return { type: request.type, id: request.id, deleted: true }
  }

  async getRecordMetadata(request: RecordMetadataRequest): Promise<JsonObject> {
    this.metadataRequests.push(request)
    return { type: request.type ?? "catalog", select: request.select }
  }

  async getTransactionLines(request: TransactionLinesRequest): Promise<JsonObject> {
    this.transactionLineRequests.push(request)
    return { type: request.type, id: request.id, sublist: request.sublist, count: 0 }
  }

  async runSuiteQl(request: SuiteQlRequest): Promise<JsonObject> {
    return { query: request.query, rowCount: 0 }
  }

  async runRestletAction(action: RestletAction): Promise<JsonObject> {
    this.actions.push(action)
    return { action: action.action, phase: action.phase, ok: true }
  }
}

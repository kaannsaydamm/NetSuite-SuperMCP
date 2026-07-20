import ky, { HTTPError } from "ky"
import type { AppConfig } from "../config"
import { bindSuiteQlParams } from "../query/suiteql"
import { NetSuiteRequestError } from "../shared/errors"
import { type JsonObject, type JsonValue, JsonValueSchema } from "../shared/json"
import type {
  RecordCreateRequest,
  RecordDeleteRequest,
  RecordMetadataRequest,
  RecordRef,
  RecordUpdateRequest,
  RestletAction,
  SuiteQlRequest,
  TransactionLinesRequest,
} from "./types"

type RequestJsonOptions = Omit<RequestInit, "headers"> & {
  readonly headers?: Record<string, string>
  readonly json?: unknown
  readonly searchParams?: Record<string, string> | URLSearchParams
  readonly retryable?: boolean
}

export interface NetSuiteClient {
  getRecord(ref: RecordRef): Promise<JsonObject>
  createRecord(request: RecordCreateRequest): Promise<JsonObject>
  updateRecord(request: RecordUpdateRequest): Promise<JsonObject>
  submitFields(request: RecordUpdateRequest): Promise<JsonObject>
  deleteRecord(request: RecordDeleteRequest): Promise<JsonObject>
  getRecordMetadata(request: RecordMetadataRequest): Promise<JsonObject>
  getTransactionLines(request: TransactionLinesRequest): Promise<JsonObject>
  runSuiteQl(request: SuiteQlRequest): Promise<JsonObject>
  runRestletAction(action: RestletAction): Promise<JsonObject>
}

export class OAuthNetSuiteClient implements NetSuiteClient {
  constructor(
    readonly config: AppConfig["netsuite"],
    readonly accessTokenProvider: () => Promise<string>,
  ) {}

  async getRecord(ref: RecordRef): Promise<JsonObject> {
    return this.requestJson(
      `${this.config.baseUrl}/services/rest/record/v1/${ref.type}/${ref.id}`,
      {
        method: "GET",
        retryable: true,
      },
    )
  }

  async createRecord(request: RecordCreateRequest): Promise<JsonObject> {
    return this.requestJson(`${this.config.baseUrl}/services/rest/record/v1/${request.type}`, {
      method: "POST",
      json: request.values,
    })
  }

  async updateRecord(request: RecordUpdateRequest): Promise<JsonObject> {
    return this.patchRecord(request)
  }

  async submitFields(request: RecordUpdateRequest): Promise<JsonObject> {
    return this.patchRecord(request)
  }

  async deleteRecord(request: RecordDeleteRequest): Promise<JsonObject> {
    return this.requestJson(
      `${this.config.baseUrl}/services/rest/record/v1/${request.type}/${request.id}`,
      {
        method: "DELETE",
      },
    )
  }

  async getRecordMetadata(request: RecordMetadataRequest): Promise<JsonObject> {
    const path =
      request.type === undefined
        ? `${this.config.baseUrl}/services/rest/record/v1/metadata-catalog`
        : `${this.config.baseUrl}/services/rest/record/v1/metadata-catalog/${request.type}`
    const searchParams =
      request.select.length === 0 ? undefined : { select: request.select.join(",") }
    return this.requestJson(path, {
      method: "GET",
      retryable: true,
      headers: { accept: request.mediaType },
      ...(searchParams === undefined ? {} : { searchParams }),
    })
  }

  async getTransactionLines(request: TransactionLinesRequest): Promise<JsonObject> {
    return this.requestJson(
      `${this.config.baseUrl}/services/rest/record/v1/${request.type}/${request.id}/${request.sublist}`,
      { method: "GET", retryable: true },
    )
  }

  async runSuiteQl(request: SuiteQlRequest): Promise<JsonObject> {
    const searchParams = suiteQlSearchParams(request)
    return this.requestJson(`${this.config.baseUrl}/services/rest/query/v1/suiteql`, {
      method: "POST",
      json: suiteQlBody(request),
      retryable: true,
      ...(searchParams === undefined ? {} : { searchParams }),
    })
  }

  async runRestletAction(action: RestletAction): Promise<JsonObject> {
    return this.requestJson(this.config.restletUrl, {
      method: "POST",
      json: action,
      retryable: action.phase === "preview",
    })
  }

  private async patchRecord(request: RecordUpdateRequest): Promise<JsonObject> {
    return this.requestJson(
      `${this.config.baseUrl}/services/rest/record/v1/${request.type}/${request.id}`,
      {
        method: "PATCH",
        json: request.values,
      },
    )
  }

  private async requestJson(url: string, options: RequestJsonOptions) {
    const token = await this.accessTokenProvider()
    const { retryable = false, ...requestOptions } = options
    try {
      const response = await ky(url, {
        ...requestOptions,
        timeout: 30_000,
        retry: {
          limit: retryable ? 2 : 0,
          methods: ["get", "post"],
          statusCodes: [408, 429, 500, 502, 503, 504],
        },
        headers: { ...options.headers, authorization: `Bearer ${token}`, prefer: "transient" },
      })
      return await responseToJsonObject(response)
    } catch (error) {
      if (error instanceof HTTPError) {
        throw new NetSuiteRequestError(error.response.status, await error.response.text())
      }
      throw error
    }
  }
}

async function responseToJsonObject(response: Response): Promise<JsonObject> {
  const text = await response.text()
  if (text.length === 0) {
    return {
      status: response.status,
      location: response.headers.get("location"),
    }
  }

  const value = JsonValueSchema.parse(JSON.parse(text))
  if (!isJsonObject(value)) {
    throw new NetSuiteRequestError(response.status, "NetSuite response was not a JSON object")
  }
  return value
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function suiteQlSearchParams(request: SuiteQlRequest): Record<string, string> | undefined {
  const entries: Record<string, string> = {}
  if (request.limit !== undefined) {
    entries["limit"] = request.limit.toString()
  }
  if (request.offset !== undefined) {
    entries["offset"] = request.offset.toString()
  }
  return Object.keys(entries).length === 0 ? undefined : entries
}

function suiteQlBody(request: SuiteQlRequest): JsonObject {
  return { q: bindSuiteQlParams(request.query, request.params) }
}

import { randomUUID } from "node:crypto"
import { z } from "zod"
import {
  ConfigError,
  NetSuiteNotConfiguredError,
  NetSuiteRequestError,
  PolicyError,
} from "./errors"

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    likelyCause: z.string().min(1),
    retryable: z.boolean(),
    requestId: z.string().uuid(),
    httpStatus: z.number().int().optional(),
    netsuiteCode: z.string().optional(),
    netsuiteMessage: z.string().optional(),
    requiredPermission: z.string().optional(),
  }),
})

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>

export function createRequestId(): string {
  return randomUUID()
}

export function toErrorEnvelope(error: unknown, requestId: string): ErrorEnvelope {
  if (error instanceof NetSuiteRequestError) {
    return ErrorEnvelopeSchema.parse({
      error: {
        code: "NETSUITE_REQUEST_FAILED",
        message: error.message,
        likelyCause: likelyNetSuiteCause(error.statusCode),
        retryable: error.statusCode === 429 || error.statusCode >= 500,
        requestId,
        httpStatus: error.statusCode,
        ...extractNetSuiteDetails(error.responseBody),
      },
    })
  }
  if (error instanceof NetSuiteNotConfiguredError || error instanceof ConfigError) {
    return envelope(
      "CONFIGURATION_ERROR",
      error.message,
      "Required local configuration is missing or invalid.",
      false,
      requestId,
    )
  }
  if (error instanceof PolicyError) {
    return envelope(
      "POLICY_ERROR",
      error.message,
      "The configured tool policy rejected the request.",
      false,
      requestId,
    )
  }

  const message = error instanceof Error ? error.message : "Unknown NetSuite operation failure"
  const explicitCode = message.match(/^([A-Z][A-Z0-9_]+):\s*/)?.[1]
  const code =
    explicitCode ?? (error instanceof z.ZodError ? "VALIDATION_ERROR" : "OPERATION_FAILED")
  return envelope(
    code,
    message.replace(/^[A-Z][A-Z0-9_]+:\s*/, ""),
    code === "OPERATION_SOURCE_CHANGED"
      ? "The NetSuite source record changed after this operation was prepared."
      : code === "VALIDATION_ERROR"
        ? "The request does not match the tool contract."
        : "NetSuite rejected the operation or the operation could not be completed.",
    false,
    requestId,
  )
}

function envelope(
  code: string,
  message: string,
  likelyCause: string,
  retryable: boolean,
  requestId: string,
): ErrorEnvelope {
  return ErrorEnvelopeSchema.parse({ error: { code, message, likelyCause, retryable, requestId } })
}

function likelyNetSuiteCause(statusCode: number): string {
  if (statusCode === 401) return "The OAuth token is missing, expired, or not accepted by NetSuite."
  if (statusCode === 403) return "The connected NetSuite role lacks permission for this operation."
  if (statusCode === 404) return "The requested NetSuite endpoint or record was not found."
  if (statusCode === 429) return "NetSuite governance or concurrency limits were reached."
  if (statusCode >= 500) return "NetSuite returned a temporary server failure."
  return "NetSuite rejected the request payload or record state."
}

function extractNetSuiteDetails(responseBody: string): {
  readonly netsuiteCode?: string
  readonly netsuiteMessage?: string
} {
  try {
    const parsed = JSON.parse(responseBody) as unknown
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const object = parsed as Record<string, unknown>
      const nested =
        typeof object["error"] === "object" && object["error"] !== null
          ? (object["error"] as Record<string, unknown>)
          : object
      const details = Array.isArray(object["o:errorDetails"])
        ? (object["o:errorDetails"] as Record<string, unknown>[])[0]
        : undefined
      const code = details?.["o:errorCode"] ?? nested["o:errorCode"] ?? nested["code"]
      const message =
        details?.["detail"] ?? nested["detail"] ?? nested["message"] ?? object["title"]
      return {
        ...(typeof code === "string" ? { netsuiteCode: code } : {}),
        ...(typeof message === "string" ? { netsuiteMessage: sanitizeMessage(message) } : {}),
      }
    }
  } catch {
    return {}
  }
  return {}
}

function sanitizeMessage(value: string): string {
  return value
    .replace(
      /(authorization|bearer|token|secret|password|credential)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/([?&](?:h|token|access_token|signature|sig)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 2000)
}

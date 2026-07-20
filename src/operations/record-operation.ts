import type { JsonObject } from "../shared/json"
import type { ToolName } from "../tools/catalog"
import type { ToolDependencies } from "../tools/types"
import { snapshotFingerprint } from "./snapshot"

export async function prepareRecordOperation(
  dependencies: ToolDependencies,
  action: ToolName,
  payload: JsonObject,
): Promise<JsonObject> {
  const type = requireString(payload, "type")
  const id = typeof payload["id"] === "string" ? payload["id"] : undefined
  if (id === undefined) {
    try {
      await dependencies.netsuite.getRecordMetadata({
        type,
        select: [],
        mediaType: "application/schema+json",
      })
    } catch (error) {
      throw new Error(`INVALID_RECORD_TYPE: ${type}`, { cause: error })
    }
  }
  const sourceSnapshot =
    id === undefined
      ? { type, state: "newRecord" }
      : await dependencies.netsuite.getRecord({ type, id })
  const preview = { source: sourceSnapshot, requestedValues: payload["values"] ?? {} }
  const source = id === undefined ? { type, target: "newRecord" } : { type, id }
  const verb =
    action === "ns_createRecord" ? "Create" : action === "ns_deleteRecord" ? "Delete" : "Update"
  return dependencies.operationStore.create({
    action,
    executor: "record",
    environment: dependencies.config.netsuite.environment,
    accountId: dependencies.config.netsuite.accountId,
    requester: dependencies.requester,
    client: dependencies.client,
    kind: action.startsWith("ns_") ? action.slice(3) : action,
    source,
    selection: { mode: "explicitValues" },
    payload,
    preview,
    snapshotFingerprint: snapshotFingerprint(preview),
    impact: {
      summary: `${verb} ${type}${id === undefined ? "" : ` ${id}`} with explicitly supplied values. No record was saved.`,
      details: preview,
    },
    warnings:
      dependencies.config.netsuite.environment === "production"
        ? ["This plan targets a production NetSuite account."]
        : [],
  })
}

function requireString(payload: JsonObject, field: string): string {
  const value = payload[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

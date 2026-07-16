import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  FieldUsageInputSchema,
  RecordUsageInputSchema,
  ScriptGraphInputSchema,
  ScriptObservabilityInputSchema,
  ScriptSelectorSchema,
} from "../contracts/script-schemas"
import {
  analyzeScriptSource,
  dependencyEdges,
  findDuplicateLogic,
  type ScriptSource,
} from "../scripts/source-audit"
import type { JsonObject, JsonValue } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerScriptTools(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    ToolName.GetScriptObservability,
    {
      title: "Get SuiteScript observability",
      description:
        "Reads native script, deployment, execution-log, and scheduled-instance evidence by ID.",
      inputSchema: ScriptObservabilityInputSchema,
      outputSchema: outputSchemaFor(ToolName.GetScriptObservability),
    },
    async (input) => {
      const payload = toJsonObject(input)
      return runNetSuiteTool({
        toolName: ToolName.GetScriptObservability,
        dependencies,
        input: payload,
        execute: async () =>
          await dependencies.netsuite.runRestletAction({
            action: ToolName.GetScriptObservability,
            phase: "preview",
            payload,
          }),
      })
    },
  )

  registerSourceTool(
    server,
    dependencies,
    ToolName.AnalyzeScript,
    ScriptSelectorSchema,
    (sources) => ({
      analyses: sources.map(analyzeScriptSource),
    }),
  )
  registerSourceTool(
    server,
    dependencies,
    ToolName.FindScriptDependencies,
    ScriptGraphInputSchema,
    (sources) => ({
      nodes: sources.map((source) => ({ scriptId: source.scriptId, file: source.file })),
      edges: sources.flatMap(dependencyEdges),
    }),
  )
  registerSourceTool(
    server,
    dependencies,
    ToolName.FindRecordWriters,
    RecordUsageInputSchema,
    (sources, input) => usageResult(sources, String(input.recordType), "recordWrite"),
  )
  registerSourceTool(
    server,
    dependencies,
    ToolName.FindRecordReaders,
    RecordUsageInputSchema,
    (sources, input) => usageResult(sources, String(input.recordType), "recordRead"),
  )
  registerSourceTool(
    server,
    dependencies,
    ToolName.FindFieldUsage,
    FieldUsageInputSchema,
    (sources, input) => {
      const fieldId = String(input.fieldId)
      const usages = sources
        .flatMap(dependencyEdges)
        .filter(
          (edge) =>
            (edge.type === "fieldRead" || edge.type === "fieldWrite") && edge.to === fieldId,
        )
      return {
        fieldId,
        ...(input.recordType === undefined ? {} : { recordType: String(input.recordType) }),
        usages,
        unknownRecordContext: input.recordType !== undefined && usages.length > 0,
      }
    },
  )
  registerSourceTool(
    server,
    dependencies,
    ToolName.FindDuplicateScriptLogic,
    ScriptGraphInputSchema,
    (sources) => ({ groups: findDuplicateLogic(sources) }),
  )
}

function registerSourceTool<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  inputSchema: z.ZodType<T>,
  project: (sources: readonly ScriptSource[], input: T) => JsonValue,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description:
        "Reads SuiteScript sources through the permanent RESTlet and returns conservative evidence-backed analysis.",
      inputSchema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input: T) => {
      const payload = toJsonObject(input)
      return runNetSuiteTool({
        toolName,
        dependencies,
        input: payload,
        execute: async () => {
          const response = await dependencies.netsuite.runRestletAction({
            action: "ns_getScriptSources",
            phase: "preview",
            payload,
          })
          const sources = scriptSources(response)
          const projected = project(sources, input)
          return {
            ...(projected as JsonObject),
            sourceCount: sources.length,
            gaps: Array.isArray(response["gaps"]) ? response["gaps"] : [],
          }
        },
      })
    },
  )
}

function usageResult(
  sources: readonly ScriptSource[],
  recordType: string,
  type: "recordRead" | "recordWrite",
): JsonObject {
  return {
    recordType,
    usages: sources
      .flatMap(dependencyEdges)
      .filter((edge) => edge.type === type && edge.to === recordType),
  }
}

function scriptSources(response: JsonObject): readonly ScriptSource[] {
  if (!Array.isArray(response["sources"])) return []
  return response["sources"].flatMap((entry) => {
    if (!isObject(entry) || !isObject(entry["file"]) || typeof entry["source"] !== "string") {
      return []
    }
    const file = entry["file"]
    const scriptId = stringValue(entry["scriptId"])
    const fileId = stringValue(file["id"])
    const fileName = stringValue(file["name"])
    if (scriptId === undefined || fileId === undefined || fileName === undefined) return []
    return [
      {
        scriptId,
        deploymentIds: Array.isArray(entry["deploymentIds"])
          ? entry["deploymentIds"].map(String)
          : [],
        file: {
          id: fileId,
          name: fileName,
          ...(typeof file["path"] === "string" ? { path: file["path"] } : {}),
        },
        source: entry["source"],
      },
    ]
  })
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

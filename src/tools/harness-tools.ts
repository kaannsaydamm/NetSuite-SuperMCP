import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  CompositeDefinitionSchema,
  GetCompositeToolInputSchema,
} from "../contracts/harness-schemas"
import { getToolContract, validateToolRequest } from "../contracts/tool-registry"
import type { JsonValue } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerHarnessTools(server: McpServer, dependencies: ToolDependencies): void {
  register(
    server,
    dependencies,
    ToolName.CreateCompositeTool,
    CompositeDefinitionSchema,
    async (input) => {
      const declared = new Set(input.inputs.map((entry) => entry.name))
      const examples = Object.fromEntries(input.inputs.map((entry) => [entry.name, entry.example]))
      for (const step of input.steps) {
        if (step.kind === "runbook") {
          await dependencies.runbookStore.getDefinition(
            dependencies.requester,
            step.runbookId,
            step.runbookVersion,
          )
          continue
        }
        if (step.kind !== "tool") continue
        if (!dependencies.allowedToolNames.has(step.toolName as ToolName))
          throw new Error(`COMPOSITE_TOOL_NOT_ALLOWED: ${step.toolName}`)
        const contract = getToolContract(step.toolName)
        const resolved = resolveTemplate(step.inputTemplate, declared, examples)
        const validation = validateToolRequest(contract.name, resolved)
        if (!validation.valid) throw new Error(`COMPOSITE_STEP_INPUT_INVALID: ${step.id}`)
      }
      return await dependencies.compositeStore.define(dependencies.requester, input)
    },
  )
  register(
    server,
    dependencies,
    ToolName.GetCompositeTool,
    GetCompositeToolInputSchema,
    async (input) =>
      await dependencies.compositeStore.get(
        dependencies.requester,
        input.compositeId,
        input.compositeVersion,
      ),
  )
}

function register<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  schema: z.ZodType<T>,
  execute: (input: T) => unknown | Promise<unknown>,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description: "Creates or reads an immutable composite definition for typed MCP workflows.",
      inputSchema: schema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input: T) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input: jsonObject(input),
        execute: async () => jsonObject(await execute(input)),
      }),
  )
}

function resolveTemplate(
  value: JsonValue,
  declared: ReadonlySet<string>,
  examples: Record<string, JsonValue>,
): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => resolveTemplate(entry, declared, examples))
  if (value === null || typeof value !== "object") return value
  const object = value as { readonly [key: string]: JsonValue }
  if (Object.keys(object).length === 1 && typeof object["$input"] === "string") {
    const name = object["$input"]
    if (!declared.has(name)) throw new Error(`COMPOSITE_UNDECLARED_INPUT: ${name}`)
    const example = examples[name]
    if (example === undefined) throw new Error(`COMPOSITE_INPUT_EXAMPLE_REQUIRED: ${name}`)
    return example
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, current]) => [
      key,
      resolveTemplate(current, declared, examples),
    ]),
  )
}

function jsonObject(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as { readonly [key: string]: JsonValue }
}

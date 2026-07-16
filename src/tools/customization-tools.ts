import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  CleanupPlanInputSchema,
  CustomizationDiffInputSchema,
  CustomizationInventoryInputSchema,
  DeploymentInputSchema,
  GenerateCustomizationDocsInputSchema,
  GenerateCustomizationProjectInputSchema,
  MigrationPlanInputSchema,
  PrepareCustomizationDeploymentInputSchema,
  ProjectInputSchema,
  RecordDeploymentResultInputSchema,
} from "../contracts/customization-schemas"
import {
  cleanupPlan,
  customizationDocumentation,
  diffCustomizations,
  generateProject,
  migrationPlan,
  validateProject,
} from "../customizations/customization"
import type { JsonObject, JsonValue } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerCustomizationTools(
  server: McpServer,
  dependencies: ToolDependencies,
): void {
  registerTool(
    server,
    dependencies,
    ToolName.InventoryCustomizations,
    CustomizationInventoryInputSchema,
    async (input) => {
      const response = await dependencies.netsuite.runRestletAction({
        action: ToolName.InventoryCustomizations,
        phase: "preview",
        payload: jsonObject(input),
      })
      const canonical = canonicalInventory(response)
      return {
        ...response,
        canonical: canonical.items,
        gaps: [...canonical.gaps, ...array(response["gaps"])],
      }
    },
  )
  registerTool(
    server,
    dependencies,
    ToolName.DiffCustomizationEnvironments,
    CustomizationDiffInputSchema,
    diffCustomizations,
  )
  registerTool(
    server,
    dependencies,
    ToolName.GenerateSuiteCloudProject,
    GenerateCustomizationProjectInputSchema,
    async (input) =>
      await generateProject(dependencies.config.customizationProjectDirectory, input),
  )
  registerTool(
    server,
    dependencies,
    ToolName.ValidateSuiteCloudProject,
    ProjectInputSchema,
    async (input) =>
      await validateProject(dependencies.config.customizationProjectDirectory, input.projectId),
  )
  registerTool(
    server,
    dependencies,
    ToolName.PreviewCustomizationDeployment,
    PrepareCustomizationDeploymentInputSchema,
    async (input) => ({
      ...(await validateProject(
        dependencies.config.customizationProjectDirectory,
        input.projectId,
      )),
      changedScriptIds: input.changedScriptIds,
      expectedLiveVersion: input.expectedLiveVersion ?? null,
      writesNetSuite: false,
    }),
  )
  registerTool(
    server,
    dependencies,
    ToolName.PrepareCustomizationDeployment,
    PrepareCustomizationDeploymentInputSchema,
    async (input) => {
      const validation = await validateProject(
        dependencies.config.customizationProjectDirectory,
        input.projectId,
      )
      if (!validation.valid) throw new Error("CUSTOMIZATION_PROJECT_CHECKSUM_MISMATCH")
      const deployment = await dependencies.customizationStore.prepare(dependencies.requester, {
        projectId: input.projectId,
        changedScriptIds: input.changedScriptIds,
        ...(input.expectedLiveVersion === undefined
          ? {}
          : { expectedLiveVersion: input.expectedLiveVersion }),
      })
      return {
        ...deployment,
        projectRoot: validation.projectRoot,
        providerCommand: "npx -y @oracle/suitecloud-cli@3.2.0 project:deploy --validate",
        commandWorkingDirectory: validation.projectRoot,
        requiresHarnessApproval: true,
        writesNetSuite: false,
      }
    },
  )
  registerTool(
    server,
    dependencies,
    ToolName.GetCustomizationDeployment,
    DeploymentInputSchema,
    async (input) =>
      await dependencies.customizationStore.get(dependencies.requester, input.deploymentId),
  )
  registerTool(
    server,
    dependencies,
    ToolName.RecordCustomizationDeploymentResult,
    RecordDeploymentResultInputSchema,
    async (input) =>
      await dependencies.customizationStore.update(
        dependencies.requester,
        input.deploymentId,
        (deployment) => {
          if (deployment.state !== "prepared") throw new Error("DEPLOYMENT_RESULT_ALREADY_RECORDED")
          if (deployment.confirmation !== input.confirmation)
            throw new Error("CONFIRMATION_MISMATCH")
          return {
            ...deployment,
            state: input.succeeded ? "succeeded" : "failed",
            result: {
              uploadedFiles: input.uploadedFiles,
              changedObjects: input.changedObjects,
              validationWarnings: input.validationWarnings,
              providerEvidence: input.providerEvidence,
            },
          }
        },
      ),
  )
  registerTool(
    server,
    dependencies,
    ToolName.VerifyCustomizationDeployment,
    DeploymentInputSchema,
    async (input) => {
      const deployment = await dependencies.customizationStore.get(
        dependencies.requester,
        input.deploymentId,
      )
      if (deployment.state !== "succeeded") throw new Error("DEPLOYMENT_NOT_SUCCESSFUL")
      const live = await dependencies.netsuite.runRestletAction({
        action: ToolName.GetSuperMcpVersion,
        phase: "preview",
        payload: {},
      })
      const expected = deployment.expectedLiveVersion
      const verified = expected === undefined || live["version"] === expected
      return await dependencies.customizationStore.update(
        dependencies.requester,
        input.deploymentId,
        (current) => ({
          ...current,
          state: verified ? "verified" : "failed",
          verification: { expectedVersion: expected ?? null, live, verified },
        }),
      )
    },
  )
  registerTool(
    server,
    dependencies,
    ToolName.PrepareCustomizationRollback,
    ProjectInputSchema,
    async (input) => {
      const validation = await validateProject(
        dependencies.config.customizationProjectDirectory,
        input.projectId,
      )
      const manifest = validation.manifest as {
        files: Array<{
          path: string
          restorable: boolean
          previousChecksum?: string
          rollbackPath?: string
        }>
      }
      const restorable = manifest.files.filter(
        (
          file,
        ): file is {
          path: string
          restorable: true
          previousChecksum: string
          rollbackPath: string
        } =>
          file.restorable && file.rollbackPath !== undefined && file.previousChecksum !== undefined,
      )
      const files = await Promise.all(restorable.map(rollbackFile))
      return {
        projectId: input.projectId,
        restorableFiles: files,
        nonRestorableFiles: manifest.files
          .filter((file) => !file.restorable)
          .map((file) => file.path),
        automaticRollbackClaimed: false,
        nextStep: "Generate and review a new checksum-pinned project from restorableFiles.",
      }
    },
  )
  registerTool(
    server,
    dependencies,
    ToolName.PlanCustomizationMigration,
    MigrationPlanInputSchema,
    (input) =>
      migrationPlan(
        input.sourceAccount,
        input.targetAccount,
        input.customizations,
        input.targetScriptIds,
      ),
  )
  registerTool(
    server,
    dependencies,
    ToolName.PlanCustomizationCleanup,
    CleanupPlanInputSchema,
    (input) => cleanupPlan(input.customizations, input.usageEvidence),
  )
  registerTool(
    server,
    dependencies,
    ToolName.GenerateSystemDocumentation,
    GenerateCustomizationDocsInputSchema,
    (input) => customizationDocumentation(input.title, input.customizations),
  )
}

function registerTool<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  inputSchema: z.ZodType<T>,
  execute: (input: T) => unknown | Promise<unknown>,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description:
        "Inventories, compares, packages, or plans NetSuite customizations with stable IDs and checksums.",
      inputSchema,
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

async function rollbackFile(file: {
  path: string
  rollbackPath: string
  previousChecksum: string
}) {
  const content = await readFile(file.rollbackPath, "utf8")
  const checksum = createHash("sha256").update(content).digest("hex")
  if (checksum !== file.previousChecksum)
    throw new Error(`ROLLBACK_CHECKSUM_MISMATCH: ${file.path}`)
  return { path: file.path, content, expectedChecksum: file.previousChecksum }
}

function canonicalInventory(response: JsonObject) {
  const items: JsonObject[] = []
  const gaps: JsonObject[] = []
  for (const raw of array(response["items"])) {
    if (!object(raw)) continue
    const values = object(raw["values"]) ? raw["values"] : {}
    const scriptId = scalar(values["scriptid"])
    const name = scalar(values["name"])
    const category = typeof raw["category"] === "string" ? raw["category"] : undefined
    if (scriptId === undefined || name === undefined || category === undefined) {
      gaps.push({
        internalId: String(raw["internalId"] ?? "unknown"),
        reason: "stable script ID or name unavailable",
      })
      continue
    }
    items.push({
      type: category,
      scriptId,
      internalId: String(raw["internalId"] ?? ""),
      name,
      definition: values,
      permissions: [],
      dependencies: [],
      metadata: {
        provenance: [
          { source: "nativeCustomizationSearch", searchType: raw["searchType"] ?? null },
        ],
      },
    })
  }
  return { items, gaps }
}

function scalar(value: JsonValue | undefined): string | undefined {
  if (!object(value)) return undefined
  const selected = value["value"] ?? value["text"]
  return typeof selected === "string" || typeof selected === "number" ? String(selected) : undefined
}

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function array(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

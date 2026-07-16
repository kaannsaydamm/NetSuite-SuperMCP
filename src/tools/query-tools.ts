import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"
import {
  AnalyzeSuiteQlInputSchema,
  BuildSuiteQlInputSchema,
  CreateReadJobInputSchema,
  DiffSavedSearchDefinitionsInputSchema,
  ExportSavedSearchInputSchema,
  ExportSuiteQlInputSchema,
  IncrementalExportInputSchema,
  JobInputSchema,
  PreviewCloneSavedSearchInputSchema,
  ResumeJobInputSchema,
  RunJobStepInputSchema,
  RunSuiteQlPagedInputSchema,
  SavedSearchDefinitionInputSchema,
  SavedSearchDefinitionSchema,
} from "../contracts/query-schemas"
import type { ReadJob } from "../jobs/job-store"
import { analyzeSuiteQl, buildSuiteQl, runSuiteQlPage } from "../query/suiteql"
import { diffSnapshots } from "../record-explorer/explorer"
import type { JsonObject } from "../shared/json"
import { ToolName } from "./catalog"
import { outputSchemaFor } from "./output-schemas"
import { runNetSuiteTool } from "./response"
import type { ToolDependencies } from "./types"

export function registerQueryTools(server: McpServer, dependencies: ToolDependencies): void {
  registerExportResource(server, dependencies)
  readTool(server, dependencies, ToolName.BuildSuiteQl, BuildSuiteQlInputSchema, async (input) =>
    buildSuiteQl(input),
  )
  readTool(
    server,
    dependencies,
    ToolName.ValidateSuiteQl,
    AnalyzeSuiteQlInputSchema,
    async (input) => {
      const analysis = analyzeSuiteQl(input.query)
      if (!analysis.valid || !input.validateRemotely) return { valid: analysis.valid, analysis }
      try {
        await dependencies.netsuite.runSuiteQl({
          query: input.query,
          params: input.params,
          limit: 1,
        })
        return { valid: true, analysis, remoteValidation: { valid: true } }
      } catch (error) {
        return {
          valid: false,
          analysis,
          remoteValidation: { valid: false, error: errorText(error) },
        }
      }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.ExplainSuiteQl,
    AnalyzeSuiteQlInputSchema,
    async (input) => {
      const analysis = analyzeSuiteQl(input.query)
      return {
        analysis,
        explanation: {
          statement: analysis.statementType,
          tables: analysis.tables,
          projectedFields: analysis.fields,
          rowCapRequired: true,
          cost: analysis.estimatedCost,
          warnings: analysis.warnings,
          sensitiveFields: analysis.sensitiveFields,
        },
      }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.RunSuiteQlPaged,
    RunSuiteQlPagedInputSchema,
    async (input) =>
      await runSuiteQlPage(dependencies.netsuite, dependencies.cursorCodec, {
        query: input.query,
        params: input.params,
        keyField: input.keyField,
        keyIsUnique: true,
        pageSize: input.pageSize,
        rowBudget: input.rowBudget,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      }),
  )
  readTool(
    server,
    dependencies,
    ToolName.IncrementalExport,
    IncrementalExportInputSchema,
    async (input) => {
      const page = await runSuiteQlPage(dependencies.netsuite, dependencies.cursorCodec, {
        query: input.query,
        params: input.params,
        keyField: input.keyField,
        keyIsUnique: true,
        pageSize: input.pageSize,
        rowBudget: input.rowBudget,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      })
      return { ...page, checkpoint: page.nextCursor }
    },
  )
  readTool(
    server,
    dependencies,
    ToolName.CreateReadJob,
    CreateReadJobInputSchema,
    async (input) => ({
      job: publicJob(await dependencies.jobStore.create(dependencies.requester, input)),
    }),
  )
  readTool(
    server,
    dependencies,
    ToolName.ExportSuiteQl,
    ExportSuiteQlInputSchema,
    async (input) => ({
      job: publicJob(await dependencies.jobStore.create(dependencies.requester, input)),
    }),
  )
  readTool(
    server,
    dependencies,
    ToolName.ExportSavedSearch,
    ExportSavedSearchInputSchema,
    async (input) => ({
      job: publicJob(await dependencies.jobStore.create(dependencies.requester, input)),
    }),
  )
  readTool(server, dependencies, ToolName.GetJobStatus, JobInputSchema, async (input) => ({
    job: publicJob(await dependencies.jobStore.get(input.jobId, dependencies.requester)),
  }))
  readTool(server, dependencies, ToolName.CancelJob, JobInputSchema, async (input) => ({
    job: publicJob(await dependencies.jobStore.cancel(input.jobId, dependencies.requester)),
  }))
  readTool(server, dependencies, ToolName.ResumeJob, ResumeJobInputSchema, async (input) => ({
    job: publicJob(
      await dependencies.jobStore.resume(input.jobId, dependencies.requester, input.recoverRunning),
    ),
  }))
  readTool(
    server,
    dependencies,
    ToolName.RunJobStep,
    RunJobStepInputSchema,
    async (input) => await runJobSteps(dependencies, input.jobId, input.maxChunks),
  )
  readTool(
    server,
    dependencies,
    ToolName.ExportSavedSearchDefinition,
    SavedSearchDefinitionInputSchema,
    async (input) => ({
      definition: await savedSearchDefinition(dependencies, input.savedSearchId),
    }),
  )
  readTool(
    server,
    dependencies,
    ToolName.DiffSavedSearchDefinitions,
    DiffSavedSearchDefinitionsInputSchema,
    async (input) => diffSnapshots(input.before, input.after),
  )
  readTool(
    server,
    dependencies,
    ToolName.PreviewCloneSavedSearch,
    PreviewCloneSavedSearchInputSchema,
    async (input) => {
      const source = await savedSearchDefinition(dependencies, input.sourceSearchId)
      return {
        clonePreview: {
          sourceSearchId: input.sourceSearchId,
          action: ToolName.CreateSavedSearch,
          payload: {
            recordType: source.searchType,
            title: input.targetTitle,
            ...(input.targetSearchId ? { searchId: input.targetSearchId } : {}),
            filters: source.filters,
            columns: source.columns,
            ...(input.isPublic === undefined ? {} : { isPublic: input.isPublic }),
          },
          mutatesNetSuite: false,
          nextStep: "Pass this payload to ns_prepareAction; commit only through ns_commitAction.",
        },
      }
    },
  )
}

async function runJobSteps(
  dependencies: ToolDependencies,
  jobId: string,
  maxChunks: number,
): Promise<JsonObject> {
  let job = await dependencies.jobStore.get(jobId, dependencies.requester)
  if (["completed", "cancelled"].includes(job.state)) return { job: publicJob(job) }
  if (job.state === "failed") throw new Error("JOB_REQUIRES_RESUME: call ns_resumeJob first")

  for (let index = 0; index < maxChunks; index += 1) {
    job = await dependencies.jobStore.get(jobId, dependencies.requester)
    if (job.state === "cancelled" || job.state === "completed") break
    job = await dependencies.jobStore.update(jobId, dependencies.requester, (current) => {
      if (current.state === "running") throw new Error("JOB_ALREADY_RUNNING")
      return { ...current, state: "running" }
    })
    try {
      const chunk = await executeJobChunk(dependencies, job)
      await dependencies.exportStore.writeChunk(
        job.resourceId,
        job.checkpoint.chunksCompleted,
        chunk.rows,
        job.spec.format,
      )
      const rowsWritten = job.checkpoint.rowsWritten + chunk.rows.length
      const chunksCompleted = job.checkpoint.chunksCompleted + 1
      const completed = !chunk.hasMore || rowsWritten >= job.spec.rowBudget
      job = await dependencies.jobStore.update(jobId, dependencies.requester, (current) => ({
        ...current,
        state: current.state === "cancelled" ? "cancelled" : completed ? "completed" : "partial",
        checkpoint: {
          cursor: chunk.cursor,
          pageIndex: chunk.pageIndex,
          rowsWritten,
          chunksCompleted,
        },
      }))
      if (job.state === "cancelled") return { job: publicJob(job) }
      if (completed) {
        const resource = await dependencies.exportStore.finalize(
          job.resourceId,
          job.spec.format,
          job.spec.compression,
          chunksCompleted,
        )
        return { job: publicJob(job), resource }
      }
    } catch (error) {
      job = await dependencies.jobStore.update(jobId, dependencies.requester, (current) => ({
        ...current,
        state: "failed",
        error: errorText(error),
        partialFailures: [
          ...current.partialFailures,
          { chunk: current.checkpoint.chunksCompleted, error: errorText(error) },
        ],
      }))
      return { job: publicJob(job) }
    }
  }
  return { job: publicJob(job) }
}

async function executeJobChunk(dependencies: ToolDependencies, job: ReadJob) {
  const remaining = job.spec.rowBudget - job.checkpoint.rowsWritten
  if (remaining <= 0)
    return {
      rows: [],
      hasMore: false,
      cursor: job.checkpoint.cursor,
      pageIndex: job.checkpoint.pageIndex,
    }
  if (job.spec.kind === "suiteql") {
    const page = await runSuiteQlPage(dependencies.netsuite, dependencies.cursorCodec, {
      query: job.spec.query,
      params: job.spec.params,
      keyField: job.spec.keyField,
      keyIsUnique: true,
      ...(job.checkpoint.cursor ? { cursor: job.checkpoint.cursor } : {}),
      pageSize: Math.min(job.spec.pageSize, remaining),
      rowBudget: job.spec.rowBudget,
    })
    return {
      rows: page.items,
      hasMore: page.hasMore,
      cursor: page.nextCursor,
      pageIndex: job.checkpoint.pageIndex,
    }
  }
  const response = await dependencies.netsuite.runRestletAction({
    action: ToolName.RunSavedSearch,
    phase: "preview",
    payload: {
      savedSearchId: job.spec.savedSearchId,
      pageSize: Math.min(job.spec.pageSize, remaining),
      pageIndex: job.checkpoint.pageIndex,
    },
  })
  const rows = Array.isArray(response["results"]) ? response["results"].slice(0, remaining) : []
  const totalCount =
    typeof response["totalCount"] === "number" ? response["totalCount"] : rows.length
  const nextPage = job.checkpoint.pageIndex + 1
  return {
    rows,
    hasMore: nextPage * job.spec.pageSize < totalCount && rows.length > 0,
    cursor: null,
    pageIndex: nextPage,
  }
}

async function savedSearchDefinition(dependencies: ToolDependencies, savedSearchId: string) {
  const response = await dependencies.netsuite.runRestletAction({
    action: "ns_getSavedSearchDefinition",
    phase: "preview",
    payload: { savedSearchId },
  })
  return SavedSearchDefinitionSchema.parse(response["definition"])
}

function registerExportResource(server: McpServer, dependencies: ToolDependencies) {
  server.registerResource(
    "NetSuite SuperMCP export",
    new ResourceTemplate("netsuite-supermcp://exports/{resourceId}", { list: undefined }),
    { description: "Completed streamed NetSuite export", mimeType: "application/octet-stream" },
    async (uri, variables) => {
      const resourceId = String(variables["resourceId"] ?? "")
      if (!/^[0-9a-f-]{36}$/i.test(resourceId)) throw new Error("INVALID_EXPORT_RESOURCE_ID")
      const job = await dependencies.jobStore.getByResource(resourceId, dependencies.requester)
      if (job.state !== "completed") throw new Error("EXPORT_NOT_READY")
      const resource = await dependencies.exportStore.read(resourceId)
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: resource.mimeType,
            ...(resource.text === undefined
              ? { blob: resource.blob as string }
              : { text: resource.text }),
          },
        ],
      }
    },
  )
}

function readTool<T>(
  server: McpServer,
  dependencies: ToolDependencies,
  toolName: ToolName,
  schema: z.ZodType<T>,
  execute: (input: T) => Promise<JsonObject>,
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description: "Builds, validates, pages, or exports bounded read-only NetSuite query results.",
      inputSchema: schema,
      outputSchema: outputSchemaFor(toolName),
    },
    async (input: T) =>
      runNetSuiteTool({
        toolName,
        dependencies,
        input: input as JsonObject,
        execute: () => execute(input),
      }),
  )
}

function publicJob(job: ReadJob): JsonObject {
  return {
    id: job.id,
    state: job.state,
    kind: job.spec.kind,
    checkpoint: job.checkpoint,
    resourceUri: `netsuite-supermcp://exports/${job.resourceId}`,
    rowBudget: job.spec.rowBudget,
    partialFailures: job.partialFailures,
    ...(job.error ? { error: job.error } : {}),
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

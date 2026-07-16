import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { z } from "zod"
import type {
  CustomizationDiffInputSchema,
  CustomizationSchema,
  GenerateCustomizationProjectInputSchema,
} from "../contracts/customization-schemas"
import type { JsonObject, JsonValue } from "../shared/json"

export type Customization = z.infer<typeof CustomizationSchema>
export type ProjectInput = z.infer<typeof GenerateCustomizationProjectInputSchema>

export function canonicalCustomization(input: Omit<Customization, "checksum">): Customization {
  return { ...input, checksum: checksum(canonicalJson(businessDefinition(input.definition))) }
}

export function diffCustomizations(input: z.infer<typeof CustomizationDiffInputSchema>) {
  const source = indexStable(input.source)
  const target = indexStable(input.target)
  const differences: Array<Record<string, unknown>> = []
  for (const [key, item] of source) {
    const counterpart = target.get(key)
    if (!counterpart) {
      differences.push({ classification: "missingInTarget", key, source: item })
      continue
    }
    const changed: string[] = []
    if (effectiveChecksum(item) !== effectiveChecksum(counterpart)) changed.push("definition")
    if (item.deploymentState !== counterpart.deploymentState) changed.push("deploymentState")
    if (canonicalJson(item.permissions) !== canonicalJson(counterpart.permissions))
      changed.push("permissions")
    if (canonicalJson(item.dependencies) !== canonicalJson(counterpart.dependencies))
      changed.push("dependencies")
    if (changed.length > 0)
      differences.push({
        classification: "changed",
        key,
        changed,
        source: item,
        target: counterpart,
      })
  }
  for (const [key, item] of target) {
    if (!source.has(key)) differences.push({ classification: "extraInTarget", key, target: item })
  }
  return {
    sourceEnvironment: input.sourceEnvironment,
    targetEnvironment: input.targetEnvironment,
    comparedBy: ["type", "scriptId", "checksum", "deploymentState", "permissions", "dependencies"],
    internalIdsUsedForMatching: false,
    differences,
  }
}

export async function generateProject(root: string, input: ProjectInput) {
  const projectId = randomUUID()
  const projectRoot = resolve(root, projectId)
  const rollbackRoot = resolve(root, "_rollback", projectId)
  await mkdir(projectRoot, { recursive: true })
  const files: JsonObject[] = []
  let totalBytes = 0
  for (const entry of input.files) {
    totalBytes += Buffer.byteLength(entry.content)
    if (totalBytes > 10_485_760) throw new Error("PROJECT_CONTENT_LIMIT_EXCEEDED")
    const destination = resolve(projectRoot, entry.path)
    if (!destination.startsWith(`${projectRoot}\\`) && destination !== projectRoot) {
      throw new Error("PROJECT_PATH_ESCAPE")
    }
    const actualChecksum = checksum(entry.content)
    if (entry.expectedChecksum !== undefined && entry.expectedChecksum !== actualChecksum) {
      throw new Error(`CHECKSUM_MISMATCH: ${entry.path}`)
    }
    await mkdir(resolve(destination, ".."), { recursive: true })
    await writeFile(destination, entry.content, "utf8")
    if (entry.previousContent !== undefined) {
      const rollbackDestination = resolve(rollbackRoot, entry.path)
      await mkdir(resolve(rollbackDestination, ".."), { recursive: true })
      await writeFile(rollbackDestination, entry.previousContent, "utf8")
    }
    files.push({
      path: entry.path,
      checksum: actualChecksum,
      restorable: entry.previousContent !== undefined,
      ...(entry.previousContent === undefined
        ? {}
        : {
            previousChecksum: checksum(entry.previousContent),
            rollbackPath: resolve(rollbackRoot, entry.path),
          }),
    })
  }
  const manifest = {
    projectId,
    name: input.name,
    customizations: input.customizations.map((item) => ({
      type: item.type,
      scriptId: item.scriptId,
      checksum: effectiveChecksum(item),
    })),
    files,
  }
  await writeFile(
    join(projectRoot, "supermcp-project.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  return { projectId, projectRoot, rollbackRoot, manifest }
}

export async function validateProject(root: string, projectId: string) {
  const projectRoot = resolve(root, projectId)
  if (!projectRoot.startsWith(resolve(root))) throw new Error("PROJECT_PATH_ESCAPE")
  const manifest = JSON.parse(
    await readFile(join(projectRoot, "supermcp-project.json"), "utf8"),
  ) as {
    files: Array<{
      path: string
      checksum: string
      restorable: boolean
      previousChecksum?: string
      rollbackPath?: string
    }>
  }
  const mismatches: JsonObject[] = []
  for (const file of manifest.files) {
    const content = await readFile(resolve(projectRoot, file.path), "utf8")
    const actual = checksum(content)
    if (actual !== file.checksum)
      mismatches.push({ path: file.path, expected: file.checksum, actual })
  }
  return { projectId, projectRoot, valid: mismatches.length === 0, mismatches, manifest }
}

export function migrationPlan(
  sourceAccount: string,
  targetAccount: string,
  customizations: readonly Customization[],
  targetScriptIds: readonly string[],
) {
  const target = new Set(targetScriptIds)
  return {
    sourceAccount,
    targetAccount,
    items: customizations.map((item) => ({
      type: item.type,
      scriptId: item.scriptId,
      targetState: target.has(item.scriptId) ? "update" : "create",
      internalIdMappingRequired: item.internalId !== undefined,
      dependencies: item.dependencies,
    })),
  }
}

export function cleanupPlan(
  customizations: readonly Customization[],
  usageEvidence: ReadonlyArray<{
    scriptId: string
    references: number
    evidence: readonly JsonValue[]
  }>,
) {
  const usage = new Map(usageEvidence.map((entry) => [entry.scriptId, entry]))
  const candidates = customizations.flatMap((item) => {
    const evidence = usage.get(item.scriptId)
    if (!evidence || evidence.references > 0) return []
    const missingOwner = Object.keys(item.metadata).every((key) => key === "provenance")
    return [
      {
        type: item.type,
        scriptId: item.scriptId,
        references: 0,
        orphan: item.dependencies.length === 0,
        technicalDebtScore: (missingOwner ? 2 : 0) + (item.dependencies.length === 0 ? 1 : 0),
        evidence: evidence.evidence,
        action: "reviewForCleanup",
        deletionPrepared: false,
      },
    ]
  })
  return { candidates, deletionPrepared: false, deletionTool: "ns_prepareAction" }
}

export function customizationDocumentation(
  title: string,
  customizations: readonly Customization[],
) {
  const lines = [`# ${title}`, "", `Customizations: ${customizations.length}`, ""]
  for (const item of [...customizations].sort((a, b) => stableKey(a).localeCompare(stableKey(b)))) {
    lines.push(`## ${item.type}: ${item.scriptId}`, "", `- Name: ${item.name}`)
    lines.push(`- Checksum: ${effectiveChecksum(item)}`)
    lines.push(
      `- Dependencies: ${item.dependencies.length === 0 ? "none declared" : item.dependencies.join(", ")}`,
    )
    lines.push(`- Owner: ${item.metadata.owner ?? "unknown"}`, "")
  }
  return { markdown: lines.join("\n"), sourceFingerprint: checksum(canonicalJson(customizations)) }
}

function indexStable(items: readonly Customization[]) {
  const indexed = new Map<string, Customization>()
  for (const item of items) {
    const key = stableKey(item)
    if (indexed.has(key)) throw new Error(`DUPLICATE_STABLE_CUSTOMIZATION_KEY: ${key}`)
    indexed.set(key, item)
  }
  return indexed
}

function stableKey(item: Customization): string {
  return `${item.type}:${item.scriptId}`
}

function effectiveChecksum(item: Customization): string {
  return item.checksum ?? checksum(canonicalJson(businessDefinition(item.definition)))
}

function businessDefinition(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(businessDefinition)
  if (typeof value !== "object" || value === null) return value
  const result: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:date|time|timestamp|lastmodified)/i.test(key)) continue
    result[key] = businessDefinition(entry)
  }
  return result
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

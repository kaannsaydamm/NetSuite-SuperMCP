import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import {
  type BusinessTermDefinition,
  BusinessTermDefinitionSchema,
  type MetricDefinition,
  MetricDefinitionSchema,
} from "../contracts/semantic-schemas"
import { definitionFingerprint } from "./semantic"

const OwnedTermSchema = z.object({
  owner: z.string().min(1),
  definition: BusinessTermDefinitionSchema,
  fingerprint: z.string().length(64),
})
const OwnedMetricSchema = z.object({
  owner: z.string().min(1),
  definition: MetricDefinitionSchema,
  fingerprint: z.string().length(64),
})
const StoreSchema = z.object({
  terms: z.array(OwnedTermSchema),
  metrics: z.array(OwnedMetricSchema),
})
type Store = z.infer<typeof StoreSchema>

export class SemanticStore {
  private queue: Promise<void> = Promise.resolve()
  constructor(readonly path: string) {}

  async defineTerm(owner: string, definition: BusinessTermDefinition) {
    return await this.define(owner, "terms", definition)
  }
  async defineMetric(owner: string, definition: MetricDefinition) {
    return await this.define(owner, "metrics", definition)
  }

  async getTerm(owner: string, id: string, version: string): Promise<BusinessTermDefinition> {
    const store = await this.read()
    const entry = store.terms.find(
      (candidate) =>
        candidate.owner === owner &&
        candidate.definition.id === id &&
        candidate.definition.version === version,
    )
    if (entry === undefined) throw new Error("SEMANTIC_DEFINITION_NOT_FOUND")
    return entry.definition
  }
  async getMetric(owner: string, id: string, version: string): Promise<MetricDefinition> {
    const store = await this.read()
    const entry = store.metrics.find(
      (candidate) =>
        candidate.owner === owner &&
        candidate.definition.id === id &&
        candidate.definition.version === version,
    )
    if (entry === undefined) throw new Error("SEMANTIC_DEFINITION_NOT_FOUND")
    return entry.definition
  }

  private async define<T extends BusinessTermDefinition | MetricDefinition>(
    owner: string,
    key: "terms" | "metrics",
    definition: T,
  ) {
    return await this.write(async (store) => {
      const entries = store[key] as Array<{ owner: string; definition: T; fingerprint: string }>
      const existing = entries.find(
        (entry) =>
          entry.owner === owner &&
          entry.definition.id === definition.id &&
          entry.definition.version === definition.version,
      )
      const fingerprint = definitionFingerprint(definition)
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) throw new Error("SEMANTIC_VERSION_IMMUTABLE")
        return existing
      }
      const entry = { owner, definition, fingerprint }
      entries.push(entry)
      return entry
    })
  }

  private async read(): Promise<Store> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { terms: [], metrics: [] }
      throw error
    }
  }

  private async write<T>(operation: (store: Store) => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      const store = await this.read()
      const result = await operation(store)
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(StoreSchema.parse(store), null, 2)}\n`, "utf8")
      await rename(temporary, this.path)
      return result
    } finally {
      release()
    }
  }
}

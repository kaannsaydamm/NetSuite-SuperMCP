import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { type CompositeDefinition, CompositeDefinitionSchema } from "../contracts/harness-schemas"
import { evidenceFingerprint } from "../runbooks/runbook"

const EntrySchema = z.object({
  owner: z.string().min(1),
  fingerprint: z.string().length(64),
  definition: CompositeDefinitionSchema,
})
const StoreSchema = z.object({ definitions: z.array(EntrySchema) })
type Store = z.infer<typeof StoreSchema>

export class CompositeStore {
  private queue: Promise<void> = Promise.resolve()
  constructor(readonly path: string) {}

  async define(owner: string, definition: CompositeDefinition) {
    return await this.write(async (store) => {
      const fingerprint = evidenceFingerprint(definition)
      const existing = find(store, owner, definition.id, definition.version)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("COMPOSITE_VERSION_IMMUTABLE")
        return existing
      }
      for (const step of definition.steps) {
        if (step.kind !== "composite") continue
        if (step.compositeId === definition.id && step.compositeVersion === definition.version)
          throw new Error("COMPOSITE_CYCLE_DETECTED")
        if (!find(store, owner, step.compositeId, step.compositeVersion))
          throw new Error(
            `COMPOSITE_REFERENCE_NOT_FOUND: ${step.compositeId}@${step.compositeVersion}`,
          )
      }
      const entry = EntrySchema.parse({ owner, fingerprint, definition })
      store.definitions.push(entry)
      assertAcyclic(store, owner)
      return entry
    })
  }

  async get(owner: string, id: string, version: string) {
    const entry = find(await this.read(), owner, id, version)
    if (!entry) throw new Error("COMPOSITE_NOT_FOUND")
    return entry
  }

  private async read(): Promise<Store> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { definitions: [] }
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

function find(store: Store, owner: string, id: string, version: string) {
  return store.definitions.find(
    (entry) =>
      entry.owner === owner && entry.definition.id === id && entry.definition.version === version,
  )
}

function assertAcyclic(store: Store, owner: string): void {
  const entries = store.definitions.filter((entry) => entry.owner === owner)
  const graph = new Map(
    entries.map((entry) => [
      key(entry.definition.id, entry.definition.version),
      entry.definition.steps
        .filter((step) => step.kind === "composite")
        .map((step) => key(step.compositeId, step.compositeVersion)),
    ]),
  )
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (node: string) => {
    if (visiting.has(node)) throw new Error("COMPOSITE_CYCLE_DETECTED")
    if (visited.has(node)) return
    visiting.add(node)
    for (const child of graph.get(node) ?? []) visit(child)
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of graph.keys()) visit(node)
}

function key(id: string, version: string): string {
  return `${id}@${version}`
}

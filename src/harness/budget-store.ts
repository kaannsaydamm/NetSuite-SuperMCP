import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import type { HarnessContext } from "../contracts/harness-schemas"
import type { JsonObject } from "../shared/json"

const UsageSchema = z.object({
  calls: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  records: z.number().int().nonnegative(),
  governanceUnits: z.number().int().nonnegative(),
  runtimeMs: z.number().int().nonnegative(),
})
const StoreSchema = z.object({ scopes: z.record(z.string(), UsageSchema) })
type Usage = z.infer<typeof UsageSchema>
const zeroUsage = (): Usage => ({ calls: 0, rows: 0, records: 0, governanceUnits: 0, runtimeMs: 0 })

export class HarnessBudgetStore {
  private queue: Promise<void> = Promise.resolve()
  constructor(readonly path: string) {}

  async reserve(context: HarnessContext | undefined, input: JsonObject): Promise<void> {
    if (context === undefined) return
    const requestedRows = boundedCount(input, ["limit", "pageSize"])
    const requestedRecords = boundedCount(input, ["records", "items", "lines"])
    await this.update(context, { calls: 1, rows: requestedRows, records: requestedRecords })
  }

  async recordRuntime(context: HarnessContext | undefined, runtimeMs: number): Promise<void> {
    if (context === undefined) return
    await this.update(context, { runtimeMs: Math.max(0, Math.ceil(runtimeMs)) }, false)
  }

  async status(context: HarnessContext | undefined) {
    if (context === undefined)
      return { scoped: false, limits: {}, used: zeroUsage(), remaining: {} }
    const store = await this.read()
    const used = store.scopes[context.scopeId] ?? zeroUsage()
    return {
      scoped: true,
      scopeId: context.scopeId,
      limits: context.budgets,
      used,
      remaining: remaining(context, used),
    }
  }

  private async update(
    context: HarnessContext,
    delta: Partial<Usage>,
    enforce = true,
  ): Promise<void> {
    await this.write(async (store) => {
      const current = store.scopes[context.scopeId] ?? zeroUsage()
      const next = UsageSchema.parse(
        Object.fromEntries(
          Object.keys(current).map((key) => [
            key,
            current[key as keyof Usage] + (delta[key as keyof Usage] ?? 0),
          ]),
        ),
      )
      if (enforce) {
        for (const [key, limit] of Object.entries(context.budgets)) {
          if (limit !== undefined && next[key as keyof Usage] > limit)
            throw new Error(`HARNESS_BUDGET_EXHAUSTED: ${key}`)
        }
      }
      store.scopes[context.scopeId] = next
    })
  }

  private async read() {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { scopes: {} }
      throw error
    }
  }

  private async write(operation: (store: z.infer<typeof StoreSchema>) => Promise<void>) {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      const store = await this.read()
      await operation(store)
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8")
      await rename(temporary, this.path)
    } finally {
      release()
    }
  }
}

function boundedCount(input: JsonObject, keys: string[]): number {
  let count = 0
  for (const [key, value] of Object.entries(input)) {
    if (!keys.includes(key)) continue
    if (typeof value === "number" && Number.isInteger(value) && value > 0) count += value
    if (Array.isArray(value)) count += value.length
  }
  return count
}

function remaining(context: HarnessContext, used: Usage) {
  return Object.fromEntries(
    Object.entries(context.budgets).map(([key, limit]) => [
      key,
      limit === undefined ? null : Math.max(0, limit - used[key as keyof Usage]),
    ]),
  )
}

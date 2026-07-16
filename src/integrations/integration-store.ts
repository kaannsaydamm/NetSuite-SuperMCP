import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { IntegrationContractSchema } from "../contracts/integration-schemas"
import { JsonValueSchema } from "../shared/json"

const CanarySchema = z.object({
  id: z.string().uuid(),
  owner: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(["prepared", "monitoring", "promotionReady", "aborted"]),
  predicate: z.object({
    field: z.string(),
    operator: z.enum(["equals", "in"]),
    value: JsonValueSchema,
  }),
  maxRecords: z.number().int().min(1).max(100),
  operationIds: z.array(z.string().uuid()).min(1).max(100),
  observations: z.array(JsonValueSchema),
})

const SubscriptionSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  eventTypes: z.array(z.string().min(1)),
  endpoint: z.string().url(),
})

const OutboxEventSchema = z.object({
  id: z.string().uuid(),
  owner: z.string().min(1),
  subscriptionId: z.string().min(1),
  eventType: z.string().min(1),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), JsonValueSchema),
  state: z.enum(["pending", "delivered", "failed"]),
  attempts: z.number().int().nonnegative(),
})

const StoreSchema = z.object({
  contracts: z.array(IntegrationContractSchema.extend({ owner: z.string().min(1) })),
  canaries: z.array(CanarySchema),
  subscriptions: z.array(SubscriptionSchema),
  outbox: z.array(OutboxEventSchema),
})

type Store = z.infer<typeof StoreSchema>
export type Canary = z.infer<typeof CanarySchema>

export class IntegrationStore {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(readonly path: string) {}

  async defineContract(owner: string, contract: z.infer<typeof IntegrationContractSchema>) {
    return await this.write(async (store) => {
      const parsed = IntegrationContractSchema.parse(contract)
      const duplicate = store.contracts.some(
        (entry) =>
          entry.owner === owner && entry.id === parsed.id && entry.version === parsed.version,
      )
      if (duplicate) throw new Error("CONTRACT_VERSION_EXISTS")
      const saved = { ...parsed, owner }
      store.contracts.push(saved)
      return saved
    })
  }

  async prepareCanary(
    owner: string,
    input: Omit<Canary, "id" | "owner" | "state" | "observations">,
  ): Promise<Canary> {
    return await this.write(async (store) => {
      const canary = CanarySchema.parse({
        ...input,
        id: randomUUID(),
        owner,
        state: "prepared",
        observations: [],
      })
      store.canaries.push(canary)
      return canary
    })
  }

  async getCanary(owner: string, id: string): Promise<Canary> {
    const store = await this.read()
    const canary = store.canaries.find((entry) => entry.id === id && entry.owner === owner)
    if (!canary) throw new Error("CANARY_NOT_FOUND")
    return canary
  }

  async updateCanary(
    owner: string,
    id: string,
    update: (canary: Canary) => Canary,
  ): Promise<Canary> {
    return await this.write(async (store) => {
      const index = store.canaries.findIndex((entry) => entry.id === id && entry.owner === owner)
      if (index < 0) throw new Error("CANARY_NOT_FOUND")
      const current = store.canaries[index]
      if (!current) throw new Error("CANARY_NOT_FOUND")
      const next = CanarySchema.parse(update(current))
      store.canaries[index] = next
      return next
    })
  }

  async subscribe(owner: string, input: { id: string; eventTypes: string[]; endpoint: string }) {
    return await this.write(async (store) => {
      const subscription = SubscriptionSchema.parse({ ...input, owner })
      const index = store.subscriptions.findIndex(
        (entry) => entry.id === subscription.id && entry.owner === owner,
      )
      if (index >= 0) store.subscriptions[index] = subscription
      else store.subscriptions.push(subscription)
      return subscription
    })
  }

  async emit(
    owner: string,
    input: {
      subscriptionId: string
      eventType: string
      idempotencyKey: string
      payload: Record<string, unknown>
    },
  ) {
    return await this.write(async (store) => {
      const subscription = store.subscriptions.find(
        (entry) => entry.id === input.subscriptionId && entry.owner === owner,
      )
      if (!subscription) throw new Error("SUBSCRIPTION_NOT_FOUND")
      if (!subscription.eventTypes.includes(input.eventType))
        throw new Error("EVENT_TYPE_NOT_SUBSCRIBED")
      const existing = store.outbox.find(
        (entry) => entry.owner === owner && entry.idempotencyKey === input.idempotencyKey,
      )
      if (existing) return existing
      const event = OutboxEventSchema.parse({
        ...input,
        id: randomUUID(),
        owner,
        state: "pending",
        attempts: 0,
      })
      store.outbox.push(event)
      return event
    })
  }

  async poll(owner: string, limit: number) {
    const store = await this.read()
    return store.outbox
      .filter((entry) => entry.owner === owner && entry.state !== "delivered")
      .slice(0, limit)
      .map((entry) => {
        const endpoint = store.subscriptions.find(
          (subscription) =>
            subscription.owner === owner && subscription.id === entry.subscriptionId,
        )?.endpoint
        return { ...entry, ...(endpoint === undefined ? {} : { endpoint }) }
      })
  }

  async acknowledge(owner: string, id: string, delivered: boolean) {
    return await this.write(async (store) => {
      const index = store.outbox.findIndex((entry) => entry.id === id && entry.owner === owner)
      if (index < 0) throw new Error("OUTBOX_EVENT_NOT_FOUND")
      const current = store.outbox[index]
      if (!current) throw new Error("OUTBOX_EVENT_NOT_FOUND")
      const next = OutboxEventSchema.parse({
        ...current,
        state: delivered ? "delivered" : "failed",
        attempts: current.attempts + 1,
      })
      store.outbox[index] = next
      return next
    })
  }

  private async read(): Promise<Store> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return emptyStore()
      throw error
    }
  }

  private async write<T>(operation: (store: Store) => Promise<T>): Promise<T> {
    const previous = this.writeQueue
    let release!: () => void
    this.writeQueue = new Promise<void>((resolve) => {
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

function emptyStore(): Store {
  return { contracts: [], canaries: [], subscriptions: [], outbox: [] }
}

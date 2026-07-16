import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

const DeploymentSchema = z.object({
  id: z.string().uuid(),
  owner: z.string().min(1),
  projectId: z.string().uuid(),
  state: z.enum(["prepared", "succeeded", "failed", "verified"]),
  changedScriptIds: z.array(z.string().min(1)),
  expectedLiveVersion: z.string().optional(),
  confirmation: z.string().min(1),
  result: z
    .object({
      uploadedFiles: z.array(z.string()),
      changedObjects: z.array(z.string()),
      validationWarnings: z.array(z.string()),
      providerEvidence: z.array(JsonValueSchema),
    })
    .optional(),
  verification: JsonValueSchema.optional(),
})
export type CustomizationDeployment = z.infer<typeof DeploymentSchema>
const StoreSchema = z.object({ deployments: z.array(DeploymentSchema) })
type Store = z.infer<typeof StoreSchema>

export class CustomizationStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(readonly path: string) {}

  async prepare(
    owner: string,
    input: { projectId: string; changedScriptIds: string[]; expectedLiveVersion?: string },
  ) {
    return await this.write(async (store) => {
      const id = randomUUID()
      const plan = DeploymentSchema.parse({
        ...input,
        id,
        owner,
        state: "prepared",
        confirmation: `recordCustomizationDeployment:${id}`,
      })
      store.deployments.push(plan)
      return plan
    })
  }

  async get(owner: string, id: string): Promise<CustomizationDeployment> {
    const store = await this.read()
    const deployment = store.deployments.find((entry) => entry.owner === owner && entry.id === id)
    if (!deployment) throw new Error("CUSTOMIZATION_DEPLOYMENT_NOT_FOUND")
    return deployment
  }

  async update(
    owner: string,
    id: string,
    update: (deployment: CustomizationDeployment) => CustomizationDeployment,
  ) {
    return await this.write(async (store) => {
      const index = store.deployments.findIndex((entry) => entry.owner === owner && entry.id === id)
      if (index < 0) throw new Error("CUSTOMIZATION_DEPLOYMENT_NOT_FOUND")
      const current = store.deployments[index]
      if (!current) throw new Error("CUSTOMIZATION_DEPLOYMENT_NOT_FOUND")
      const next = DeploymentSchema.parse(update(current))
      store.deployments[index] = next
      return next
    })
  }

  private async read(): Promise<Store> {
    try {
      return StoreSchema.parse(JSON.parse(await readFile(this.path, "utf8")))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { deployments: [] }
      }
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

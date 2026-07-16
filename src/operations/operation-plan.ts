import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

export const OperationPlanSchema = z
  .object({
    operationId: z.string().uuid(),
    kind: z.string().min(1),
    action: z.string().min(1),
    environment: z.enum(["sandbox", "production"]),
    executor: z.enum(["record", "restlet"]),
    accountId: z.string().min(1),
    requester: z.string().min(1),
    client: z.string().min(1),
    source: z.record(z.string(), JsonValueSchema),
    selection: z.record(z.string(), JsonValueSchema),
    payload: z.record(z.string(), JsonValueSchema),
    snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    preview: z.record(z.string(), JsonValueSchema),
    impact: z.object({
      summary: z.string().min(1),
      details: z.record(z.string(), JsonValueSchema),
    }),
    warnings: z.array(z.string()),
    confirmation: z.string().min(1),
    phase: z.literal("prepare"),
    used: z.boolean(),
  })
  .loose()

export type OperationPlanContract = z.infer<typeof OperationPlanSchema>

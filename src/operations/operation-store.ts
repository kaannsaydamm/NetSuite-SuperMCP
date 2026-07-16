import { randomUUID } from "node:crypto"
import type { NetSuiteEnvironment } from "../config"
import type { JsonObject } from "../shared/json"

export type OperationIdentity = {
  readonly accountId: string
  readonly client: string
  readonly requester: string
}

export type OperationPlan = OperationIdentity & {
  readonly action: string
  readonly confirmation: string
  readonly environment: NetSuiteEnvironment
  readonly impact: JsonObject
  readonly kind: string
  readonly operationId: string
  readonly payload: JsonObject
  readonly phase: "prepare"
  readonly preview: JsonObject
  readonly snapshotFingerprint: string
  readonly selection: JsonObject
  readonly source: JsonObject
  readonly used: boolean
  readonly warnings: readonly string[]
  readonly result?: JsonObject
}

export type CreateOperationPlanRequest = OperationIdentity & {
  readonly action: string
  readonly environment: NetSuiteEnvironment
  readonly impact: JsonObject
  readonly kind: string
  readonly payload: JsonObject
  readonly preview: JsonObject
  readonly snapshotFingerprint: string
  readonly selection: JsonObject
  readonly source: JsonObject
  readonly warnings: readonly string[]
}

export class OperationStore {
  readonly #plans = new Map<string, OperationPlan>()

  create(request: CreateOperationPlanRequest): OperationPlan {
    const operationId = randomUUID()
    const plan = {
      ...request,
      operationId,
      confirmation: `commit:${request.action}:${operationId}`,
      phase: "prepare",
      used: false,
    } satisfies OperationPlan
    this.#plans.set(operationId, plan)
    return plan
  }

  preview(operationId: string, identity: OperationIdentity): OperationPlan {
    const plan = this.#requireBoundPlan(operationId, identity)
    if (plan.used) {
      throw new Error(`operation plan ${operationId} has already been used`)
    }
    return plan
  }

  beginCommit(
    operationId: string,
    confirmation: string,
    identity: OperationIdentity,
  ): OperationPlan {
    const plan = this.validateCommit(operationId, confirmation, identity)
    const consumed = { ...plan, used: true }
    this.#plans.set(operationId, consumed)
    return consumed
  }

  validateCommit(
    operationId: string,
    confirmation: string,
    identity: OperationIdentity,
  ): OperationPlan {
    const plan = this.preview(operationId, identity)
    if (plan.confirmation !== confirmation) {
      throw new Error(`confirmation must match ${plan.confirmation}`)
    }
    return plan
  }

  replayCommit(
    operationId: string,
    confirmation: string,
    identity: OperationIdentity,
  ): JsonObject | null {
    const plan = this.#requireBoundPlan(operationId, identity)
    if (plan.confirmation !== confirmation) {
      throw new Error(`confirmation must match ${plan.confirmation}`)
    }
    if (!plan.used) {
      return null
    }
    if (plan.result === undefined) {
      throw new Error(`operation plan ${operationId} is already being committed`)
    }
    return { ...plan.result, operationId, used: true, idempotent: true }
  }

  completeCommit(operationId: string, result: JsonObject): void {
    const plan = this.#plans.get(operationId)
    if (plan === undefined || !plan.used) {
      throw new Error(`operation plan ${operationId} is not being committed`)
    }
    this.#plans.set(operationId, { ...plan, result })
  }

  releaseCommit(operationId: string): void {
    const plan = this.#plans.get(operationId)
    if (plan?.used && plan.result === undefined) {
      this.#plans.set(operationId, { ...plan, used: false })
    }
  }

  completed(operationId: string, identity: OperationIdentity): OperationPlan {
    const plan = this.#requireBoundPlan(operationId, identity)
    if (!plan.used || plan.result === undefined) {
      throw new Error(`operation plan ${operationId} has not completed a commit`)
    }
    return plan
  }

  #requireBoundPlan(operationId: string, identity: OperationIdentity): OperationPlan {
    const plan = this.#plans.get(operationId)
    if (plan === undefined) {
      throw new Error(`operation plan ${operationId} was not found`)
    }
    if (
      plan.accountId !== identity.accountId ||
      plan.requester !== identity.requester ||
      plan.client !== identity.client
    ) {
      throw new Error(`operation plan ${operationId} does not belong to this connection`)
    }
    return plan
  }
}

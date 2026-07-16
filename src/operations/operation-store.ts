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
  readonly operationId: string
  readonly payload: JsonObject
  readonly phase: "prepare"
  readonly preview: JsonObject
  readonly used: boolean
}

export type CreateOperationPlanRequest = OperationIdentity & {
  readonly action: string
  readonly environment: NetSuiteEnvironment
  readonly payload: JsonObject
  readonly preview: JsonObject
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
    const plan = this.preview(operationId, identity)
    if (plan.confirmation !== confirmation) {
      throw new Error(`confirmation must match ${plan.confirmation}`)
    }
    const consumed = { ...plan, used: true }
    this.#plans.set(operationId, consumed)
    return consumed
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

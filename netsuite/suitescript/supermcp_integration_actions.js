/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/record"], (nsError, record) => {
  const INTEGRATION_ACTIONS = {
    ns_retryIntegrationJob: retryIntegrationJob,
  }

  function run(actionRequest) {
    const handler = INTEGRATION_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function retryIntegrationJob(actionRequest) {
    const payload = actionRequest.payload
    const recordType = requireText(payload, "recordType")
    const recordId = requireId(payload, "recordId")
    const values = requireValues(payload)
    const plan = { record: { type: recordType, id: String(recordId) }, values }

    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return { action: actionRequest.action, phase: actionRequest.phase, retry: plan }
    }

    requireConfirmation(payload, `retry:${recordType}:${recordId}`)
    record.submitFields({
      type: recordType,
      id: recordId,
      values,
      options: { enablesourcing: true, ignoreMandatoryFields: false },
    })

    return { action: actionRequest.action, phase: actionRequest.phase, retried: plan }
  }

  function requireValues(payload) {
    const values = payload.values
    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      Object.keys(values).length === 0
    ) {
      throw createRequestError("INVALID_VALUES", "payload.values must be a non-empty object")
    }
    return values
  }

  function requireConfirmation(payload, expected) {
    if (payload.confirmation !== expected) {
      throw createRequestError("INVALID_CONFIRMATION", `confirmation must match ${expected}`)
    }
  }

  function requireText(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value !== "string" || value.length === 0) {
      throw createRequestError("MISSING_TEXT", `${fieldId} must be a non-empty string`)
    }
    return value
  }

  function requireId(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value
    }
    if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
      return Number(value)
    }
    throw createRequestError("MISSING_ID", `${fieldId} must be a positive internal ID`)
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/record"], (nsError, record) => {
  const MAPPING_ACTIONS = {
    ns_getMapping: getMapping,
    ns_updateMapping: updateMapping,
  }

  function run(actionRequest) {
    const handler = MAPPING_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function getMapping(actionRequest) {
    const payload = actionRequest.payload
    const recordType = requireText(payload, "recordType")
    const recordId = requireId(payload, "recordId")
    const fields = optionalTextList(payload, "fields")
    if (actionRequest.phase === "prepare") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        record: { type: recordType, id: String(recordId) },
        fields,
      }
    }

    const loadedRecord = record.load({ type: recordType, id: recordId, isDynamic: false })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      record: { type: recordType, id: String(recordId) },
      values: readRecordFields(loadedRecord, fields),
    }
  }

  function updateMapping(actionRequest) {
    const payload = actionRequest.payload
    const recordType = requireText(payload, "recordType")
    const recordId = requireId(payload, "recordId")
    const values = requireValues(payload)
    const plan = { record: { type: recordType, id: String(recordId) }, values }

    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return { action: actionRequest.action, phase: actionRequest.phase, mappingUpdate: plan }
    }

    record.submitFields({
      type: recordType,
      id: recordId,
      values,
      options: { enablesourcing: true, ignoreMandatoryFields: false },
    })
    return { action: actionRequest.action, phase: actionRequest.phase, mappingUpdated: plan }
  }

  function readRecordFields(loadedRecord, fields) {
    const values = {}
    for (const fieldId of fields) {
      values[fieldId] = {
        value: loadedRecord.getValue({ fieldId }),
        text: safeGetText(loadedRecord, fieldId),
      }
    }
    return values
  }

  function safeGetText(loadedRecord, fieldId) {
    try {
      return loadedRecord.getText({ fieldId })
    } catch (error) {
      if (error && error.name === "SSS_INVALID_API_USAGE") {
        return null
      }
      throw error
    }
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

  function optionalTextList(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return ["name", "externalid", "custrecord_source", "custrecord_target", "custrecord_channel"]
    }
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
      throw createRequestError(
        "INVALID_FIELD_LIST",
        `${fieldId} must be a non-empty array with at most 50 fields`,
      )
    }
    for (const entry of value) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw createRequestError(
          "INVALID_FIELD_LIST",
          `${fieldId} entries must be non-empty strings`,
        )
      }
    }
    return value
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

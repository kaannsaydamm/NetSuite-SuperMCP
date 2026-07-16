/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/file", "N/record", "N/search"], (nsError, file, record, search) => {
  const READ_ACTIONS = {
    ns_explainIntegrationError: explainIntegrationError,
    ns_getFailedIntegrationJobs: runSavedSearch,
    ns_getFile: getFile,
    ns_getIntegrationLogs: runSavedSearch,
    ns_runReport: runReport,
    ns_runSavedSearch: runSavedSearch,
  }

  function run(actionRequest) {
    const handler = READ_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function runSavedSearch(actionRequest) {
    const payload = actionRequest.payload
    const savedSearchId = requireText(payload, "savedSearchId")
    return runPagedSearch(actionRequest, savedSearchId, "savedSearchId")
  }

  function runReport(actionRequest) {
    const payload = actionRequest.payload
    const reportId = requireText(payload, "reportId")
    return runPagedSearch(actionRequest, reportId, "reportId")
  }

  function getFile(actionRequest) {
    const payload = actionRequest.payload
    const fileId = requireFileId(payload, "fileId")
    const maxBytes = optionalIntInRange(payload, "maxBytes", 1048576, 1, 10485760)
    if (actionRequest.phase === "prepare") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        file: { id: String(fileId) },
        maxBytes,
      }
    }

    const loadedFile = file.load({ id: fileId })
    if (loadedFile.size > maxBytes) {
      throw createRequestError(
        "FILE_TOO_LARGE",
        `file size ${loadedFile.size} exceeds maxBytes ${maxBytes}`,
      )
    }
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      file: {
        id: String(fileId),
        name: loadedFile.name,
        fileType: loadedFile.fileType,
        size: loadedFile.size,
        folder: loadedFile.folder,
      },
      contents: loadedFile.getContents(),
    }
  }

  function runPagedSearch(actionRequest, searchId, idKey) {
    const payload = actionRequest.payload
    const pageSize = optionalIntInRange(payload, "pageSize", 100, 1, 1000)
    const pageIndex = optionalIntInRange(payload, "pageIndex", 0, 0, 100000)

    if (actionRequest.phase === "prepare") {
      const prepared = pagedSearchResponseBase(actionRequest, idKey, searchId, pageSize)
      prepared.pageIndex = pageIndex
      return prepared
    }

    const loadedSearch = search.load({ id: searchId })
    const paged = loadedSearch.runPaged({ pageSize })

    if (pageIndex >= paged.pageRanges.length) {
      const emptyResult = pagedSearchResponseBase(actionRequest, idKey, searchId, pageSize)
      emptyResult.pageIndex = pageIndex
      emptyResult.totalCount = paged.count
      emptyResult.results = []
      return emptyResult
    }

    const page = paged.fetch({ index: pageIndex })
    const result = pagedSearchResponseBase(actionRequest, idKey, searchId, pageSize)
    result.pageIndex = pageIndex
    result.totalCount = paged.count
    result.results = page.data.map((entry) => serializeSearchResult(entry, loadedSearch.columns))
    return result
  }

  function pagedSearchResponseBase(actionRequest, idKey, searchId, pageSize) {
    const response = { action: actionRequest.action, phase: actionRequest.phase, pageSize }
    response[idKey] = searchId
    return response
  }

  function serializeSearchResult(result, columns) {
    const values = {}
    for (const column of columns) {
      values[columnKey(column)] = { value: result.getValue(column), text: result.getText(column) }
    }
    return { id: result.id, recordType: result.recordType, values }
  }

  function explainIntegrationError(actionRequest) {
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
    const values = readRecordFields(loadedRecord, fields)

    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      record: { type: recordType, id: String(recordId) },
      values,
      errorText: firstText(values, ["error", "message", "details", "stack", "payload"]),
    }
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

  function firstText(values, fragments) {
    for (const fieldId of Object.keys(values)) {
      if (!fragments.some((fragment) => fieldId.toLowerCase().includes(fragment))) {
        continue
      }
      const entry = values[fieldId]
      if (typeof entry.value === "string" && entry.value.length > 0) {
        return entry.value
      }
      if (typeof entry.text === "string" && entry.text.length > 0) {
        return entry.text
      }
    }
    return null
  }

  function columnKey(column) {
    return [column.join, column.name, column.summary, column.label].filter(Boolean).join(".")
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

  function requireFileId(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value
    }
    if (typeof value === "string" && value.length > 0) {
      return value
    }
    throw createRequestError("MISSING_FILE_ID", `${fieldId} must be a file internal ID or path`)
  }

  function optionalTextList(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return [
        "name",
        "custrecord_error",
        "custrecord_message",
        "custrecord_details",
        "custrecord_payload",
      ]
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

  function optionalIntInRange(payload, fieldId, defaultValue, minValue, maxValue) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return defaultValue
    }
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= minValue &&
      value <= maxValue
    ) {
      return value
    }
    throw createRequestError(
      "INVALID_INT",
      `${fieldId} must be an integer between ${minValue} and ${maxValue}`,
    )
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

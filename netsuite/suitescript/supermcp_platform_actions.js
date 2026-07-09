/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/record", "N/search"], (nsError, record, search) => {
  const PLATFORM_ACTIONS = {
    ns_getPlatformObject: getPlatformObject,
    ns_listPlatformObjects: listPlatformObjects,
    ns_searchRecords: searchRecords,
  }

  const CATEGORY_TYPES = {
    customRecords: "customrecordtype",
    customLists: "customlist",
    files: "file",
    folders: "folder",
    integrationRecords: "integration",
    savedSearches: "savedsearch",
    scriptDeployments: "scriptdeployment",
    scripts: "script",
  }

  function run(actionRequest) {
    const handler = PLATFORM_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function listPlatformObjects(actionRequest) {
    const payload = actionRequest.payload
    const category = optionalText(payload, "category") || "savedSearches"
    const type = CATEGORY_TYPES[category] || category
    return runSearch(actionRequest, type, optionalText(payload, "query"))
  }

  function searchRecords(actionRequest) {
    const payload = actionRequest.payload
    const type = requireText(payload, "recordType")
    return runSearch(actionRequest, type, optionalText(payload, "query"))
  }

  function getPlatformObject(actionRequest) {
    const payload = actionRequest.payload
    const type = requireText(payload, "recordType")
    const id = requireId(payload, "recordId")
    const fields = optionalTextList(payload, "fields")
    if (actionRequest.phase === "prepare") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        record: { type, id: String(id) },
        fields,
      }
    }
    const loadedRecord = record.load({ type, id, isDynamic: false })
    const values = {}
    for (const fieldId of fields) {
      values[fieldId] = {
        value: loadedRecord.getValue({ fieldId }),
        text: safeGetText(loadedRecord, fieldId),
      }
    }
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      record: { type, id: String(id) },
      values,
    }
  }

  function runSearch(actionRequest, type, query) {
    const payload = actionRequest.payload
    const pageSize = optionalLimit(payload, "pageSize", "limit", 100, 1, 1000)
    const pageIndex = optionalIntInRange(payload, "pageIndex", 0, 0, 100000)
    const filters = query ? [["name", "contains", query]] : []
    const columns = optionalTextList(payload, "columns", ["name", "internalid"])
    if (actionRequest.phase === "prepare") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        recordType: type,
        pageSize,
        pageIndex,
        columns,
      }
    }
    const loadedSearch = search.create({ type, filters, columns })
    const paged = loadedSearch.runPaged({ pageSize })
    if (pageIndex >= paged.pageRanges.length) {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        recordType: type,
        totalCount: paged.count,
        results: [],
      }
    }
    const page = paged.fetch({ index: pageIndex })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      recordType: type,
      pageSize,
      pageIndex,
      totalCount: paged.count,
      results: page.data.map((entry) => serializeSearchResult(entry, loadedSearch.columns)),
    }
  }

  function serializeSearchResult(result, columns) {
    const values = {}
    for (const column of columns) {
      values[columnKey(column)] = { value: result.getValue(column), text: result.getText(column) }
    }
    return { id: result.id, recordType: result.recordType, values }
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

  function columnKey(column) {
    return [column.join, column.name, column.summary, column.label].filter(Boolean).join(".")
  }

  function optionalText(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return null
    }
    if (typeof value !== "string") {
      throw createRequestError("INVALID_TEXT", `${fieldId} must be a string`)
    }
    return value
  }

  function requireText(payload, fieldId) {
    const value = optionalText(payload, fieldId)
    if (value !== null && value.length > 0) {
      return value
    }
    throw createRequestError("MISSING_TEXT", `${fieldId} must be a non-empty string`)
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

  function optionalTextList(payload, fieldId, defaultValue) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return defaultValue || ["name", "internalid"]
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

  function optionalLimit(payload, primaryFieldId, aliasFieldId, defaultValue, minValue, maxValue) {
    const primaryValue = payload[primaryFieldId]
    const aliasValue = payload[aliasFieldId]
    if (primaryValue !== undefined && aliasValue !== undefined && primaryValue !== aliasValue) {
      throw createRequestError(
        "INVALID_LIMIT",
        `${primaryFieldId} and ${aliasFieldId} must match when both are provided`,
      )
    }
    return optionalIntInRange(
      { [primaryFieldId]: primaryValue === undefined ? aliasValue : primaryValue },
      primaryFieldId,
      defaultValue,
      minValue,
      maxValue,
    )
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

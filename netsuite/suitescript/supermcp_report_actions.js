/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/record", "N/search"], (nsError, record, search) => {
  const REPORT_ACTIONS = {
    ns_createSavedSearch: createSavedSearch,
    ns_deleteSavedSearch: deleteSavedSearch,
    ns_getSavedSearchDefinition: getSavedSearchDefinition,
    ns_listReports: listReports,
    ns_listReportTypes: listReportTypes,
    ns_runSearch: runSearch,
    ns_updateSavedSearch: updateSavedSearch,
  }

  const REPORT_TYPES = [
    { id: "transaction", label: "Transactions" },
    { id: "customer", label: "Customers" },
    { id: "vendor", label: "Vendors" },
    { id: "item", label: "Items" },
    { id: "inventorybalance", label: "Inventory Balance" },
    { id: "employee", label: "Employees" },
    { id: "customrecord", label: "Custom Records" },
    { id: "savedsearch", label: "Saved Searches" },
  ]

  function run(actionRequest) {
    const handler = REPORT_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function listReportTypes(actionRequest) {
    return { action: actionRequest.action, phase: actionRequest.phase, reportTypes: REPORT_TYPES }
  }

  function getSavedSearchDefinition(actionRequest) {
    if (actionRequest.phase !== "preview") {
      throw createRequestError("INVALID_PHASE", "ns_getSavedSearchDefinition only supports preview")
    }
    const savedSearchId = requireText(actionRequest.payload, "savedSearchId")
    const loaded = search.load({ id: savedSearchId })
    return {
      action: actionRequest.action,
      phase: "preview",
      definition: {
        id: String(loaded.id || savedSearchId),
        searchType: String(loaded.searchType),
        title: String(loaded.title || ""),
        isPublic: typeof loaded.isPublic === "boolean" ? loaded.isPublic : null,
        filters: loaded.filters.map(serializeFilter),
        columns: loaded.columns.map(serializeColumn),
      },
    }
  }

  function listReports(actionRequest) {
    const payload = actionRequest.payload
    const query = optionalText(payload, "query")
    const pageSize = optionalLimit(payload, "pageSize", "limit", 100, 1, 1000)
    const pageIndex = optionalIntInRange(payload, "pageIndex", 0, 0, 100000)
    const filters = query ? [["title", "contains", query]] : []
    const columns = ["title", "id", "recordtype", "owner", "internalid", "access"]
    const loadedSearch = search.create({ type: "savedsearch", filters, columns })
    const paged = loadedSearch.runPaged({ pageSize })
    if (pageIndex >= paged.pageRanges.length) {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        reports: [],
        totalCount: paged.count,
      }
    }
    const page = paged.fetch({ index: pageIndex })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      pageSize,
      pageIndex,
      totalCount: paged.count,
      reports: page.data.map((entry) => serializeSearchResult(entry, loadedSearch.columns)),
    }
  }

  function runSearch(actionRequest) {
    const payload = actionRequest.payload
    const type = requireText(payload, "recordType")
    const filters = optionalRawArray(payload, "filters")
    const columns = optionalTextList(payload, "columns", ["internalid"])
    const pageSize = optionalLimit(payload, "pageSize", "limit", 100, 1, 1000)
    const pageIndex = optionalIntInRange(payload, "pageIndex", 0, 0, 100000)
    if (actionRequest.phase === "prepare") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        recordType: type,
        columns,
        pageSize,
        pageIndex,
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

  function createSavedSearch(actionRequest) {
    const payload = actionRequest.payload
    const type = requireText(payload, "recordType")
    const title = requireText(payload, "title")
    const id = optionalText(payload, "searchId")
    const filters = optionalRawArray(payload, "filters")
    const columns = optionalTextList(payload, "columns", ["internalid"])
    const isPublic = optionalBoolean(payload, "isPublic")
    const confirmation = `createSavedSearch:${type}:${title}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        search: { type, title, id, columns },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    const savedSearch = search.create({
      type,
      title,
      filters,
      columns,
      ...(id === null ? {} : { id }),
      ...(isPublic === null ? {} : { isPublic }),
    })
    const savedId = savedSearch.save()
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      search: { id: String(savedId), type, title },
      confirmation,
    }
  }

  function updateSavedSearch(actionRequest) {
    const payload = actionRequest.payload
    const id = requireText(payload, "searchId")
    const values = requireValues(payload)
    const confirmation = `updateSavedSearch:${id}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        search: { id, values },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    record.submitFields({ type: "savedsearch", id, values })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      search: { id },
      updated: true,
      confirmation,
    }
  }

  function deleteSavedSearch(actionRequest) {
    const payload = actionRequest.payload
    const id = requireText(payload, "searchId")
    const confirmation = `deleteSavedSearch:${id}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        search: { id },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    search.delete({ id })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      deleted: true,
      search: { id },
      confirmation,
    }
  }

  function serializeSearchResult(result, columns) {
    const values = {}
    for (const column of columns) {
      values[columnKey(column)] = { value: result.getValue(column), text: result.getText(column) }
    }
    return { id: result.id, recordType: result.recordType, values }
  }

  function serializeFilter(filter) {
    return {
      name: filter.name,
      operator: filter.operator,
      values: filter.values,
      join: filter.join || null,
      summary: filter.summary || null,
      formula: filter.formula || null,
      leftParens: filter.leftParens || 0,
      rightParens: filter.rightParens || 0,
      isOr: filter.isOr === true,
      isNot: filter.isNot === true,
    }
  }

  function serializeColumn(column) {
    return {
      name: column.name,
      join: column.join || null,
      summary: column.summary || null,
      formula: column.formula || null,
      function: column.function || null,
      label: column.label || null,
      sort: column.sort || null,
    }
  }

  function columnKey(column) {
    return [column.join, column.name, column.summary, column.label].filter(Boolean).join(".")
  }

  function optionalRawArray(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return []
    }
    if (!Array.isArray(value)) {
      throw createRequestError("INVALID_ARRAY", `${fieldId} must be an array`)
    }
    return value
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

  function optionalTextList(payload, fieldId, defaultValue) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return defaultValue
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

  function optionalBoolean(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return null
    }
    if (typeof value !== "boolean") {
      throw createRequestError("INVALID_BOOLEAN", `${fieldId} must be a boolean`)
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

  function requireConfirmation(payload, expected) {
    if (payload.confirmation !== expected) {
      throw createRequestError("INVALID_CONFIRMATION", `confirmation must match ${expected}`)
    }
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

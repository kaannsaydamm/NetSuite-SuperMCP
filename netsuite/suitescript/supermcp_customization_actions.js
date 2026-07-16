/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/search"], (nsError, search) => {
  const CUSTOMIZATION_ACTIONS = {
    ns_inventoryCustomizations: inventoryCustomizations,
  }

  const SEARCH_TYPES = {
    bundle: ["bundleinstallation"],
    customField: [
      "crmcustomfield",
      "customrecordcustomfield",
      "entitycustomfield",
      "itemcustomfield",
      "itemnumbercustomfield",
      "othercustomfield",
      "transactionbodycustomfield",
      "transactioncolumncustomfield",
    ],
    customList: ["customlist"],
    customRecord: ["customrecordtype"],
    file: ["file"],
    form: ["entryform", "transactionform"],
    integration: ["integration"],
    role: ["role"],
    savedSearch: ["savedsearch"],
    script: ["script"],
    scriptDeployment: ["scriptdeployment"],
    suiteApp: ["bundleinstallation"],
    workflow: ["workflow"],
  }

  function run(actionRequest) {
    const handler = CUSTOMIZATION_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function inventoryCustomizations(actionRequest) {
    const payload = actionRequest.payload
    const categories = requireCategories(payload)
    const maxPerCategory = optionalInt(payload, "maxPerCategory", 100, 1, 1000)
    const query = optionalText(payload, "query")
    const items = []
    const gaps = []
    for (const category of categories) {
      const types = SEARCH_TYPES[category]
      if (!types) {
        gaps.push({ category, reason: "unsupported customization category" })
        continue
      }
      for (const type of types) {
        try {
          const rows = runSearch(type, query, maxPerCategory, ["internalid", "name", "scriptid"])
          for (const row of rows) items.push({ category, searchType: type, ...row })
        } catch (error) {
          try {
            const rows = runSearch(type, query, maxPerCategory, ["internalid", "name"])
            for (const row of rows) items.push({ category, searchType: type, ...row })
            gaps.push({ category, searchType: type, reason: "stable script ID is unavailable" })
          } catch (fallbackError) {
            gaps.push({
              category,
              searchType: type,
              reason: fallbackError?.name || error?.name || "search unavailable",
            })
          }
        }
      }
    }
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      categories,
      maxPerCategory,
      items,
      gaps,
    }
  }

  function runSearch(type, query, limit, columns) {
    const filters = query ? [["name", "contains", query]] : []
    const loaded = search.create({ type, filters, columns })
    return loaded
      .run()
      .getRange({ start: 0, end: limit })
      .map((row) => {
        const values = {}
        for (const column of columns) {
          values[column] = {
            value: row.getValue({ name: column }),
            text: row.getText({ name: column }),
          }
        }
        return { internalId: String(row.id), values }
      })
  }

  function requireCategories(payload) {
    const value = payload.categories
    if (!Array.isArray(value) || value.length === 0 || value.length > 13) {
      throw requestError("INVALID_CATEGORIES", "categories must contain between 1 and 13 values")
    }
    for (const entry of value) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw requestError("INVALID_CATEGORIES", "category values must be non-empty strings")
      }
    }
    return value
  }

  function optionalText(payload, field) {
    const value = payload[field]
    if (value === undefined || value === null) return null
    if (typeof value !== "string") throw requestError("INVALID_TEXT", `${field} must be a string`)
    return value
  }

  function optionalInt(payload, field, fallback, min, max) {
    const value = payload[field]
    if (value === undefined || value === null) return fallback
    if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max)
      return value
    throw requestError("INVALID_INT", `${field} must be between ${min} and ${max}`)
  }

  function requestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/file", "N/search"], (nsError, file, search) => {
  const SCRIPT_OBSERVABILITY_ACTIONS = {
    ns_findScriptErrors: findScriptErrors,
    ns_getScriptLogs: getScriptLogs,
    ns_getScriptObservability: getScriptObservability,
    ns_getScriptSources: getScriptSources,
    ns_listScriptDeployments: listScriptDeployments,
    ns_listScripts: listScripts,
  }

  function run(actionRequest) {
    const handler = SCRIPT_OBSERVABILITY_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function listScripts(actionRequest) {
    const payload = actionRequest.payload
    const maxResults = optionalInt(payload, "limit", "pageSize", 100, 1, 1000)
    const filters = []
    addIdFilter(filters, "internalid", "scriptid", payload.scriptId)
    addContainsFilter(filters, "name", payload.query)
    return result(actionRequest, {
      scripts: runSearch(
        "script",
        filters,
        ["internalid", "scriptid", "name", "scripttype", "scriptfile", "owner", "isinactive"],
        maxResults,
      ),
      maxResults,
    })
  }

  function listScriptDeployments(actionRequest) {
    const payload = actionRequest.payload
    const maxResults = optionalInt(payload, "limit", "pageSize", 100, 1, 1000)
    const filters = []
    addIdFilter(filters, "internalid", "scriptid", payload.deploymentId)
    addIdFilter(filters, "script", "script.scriptid", payload.scriptId)
    addContainsFilter(filters, "title", payload.query)
    return result(actionRequest, {
      deployments: runSearch(
        "scriptdeployment",
        filters,
        [
          "internalid",
          "scriptid",
          "title",
          "script",
          "status",
          "isdeployed",
          "allroles",
          "loglevel",
          "runasrole",
        ],
        maxResults,
      ),
      maxResults,
    })
  }

  function getScriptLogs(actionRequest) {
    return executionLogResponse(actionRequest, false)
  }

  function findScriptErrors(actionRequest) {
    return executionLogResponse(actionRequest, true)
  }

  function getScriptObservability(actionRequest) {
    const payload = actionRequest.payload
    const maxExecutions = optionalInt(payload, "maxExecutions", "limit", 100, 1, 1000)
    const scripts = listScripts({
      action: actionRequest.action,
      phase: actionRequest.phase,
      payload: { scriptId: payload.scriptId, limit: 100 },
    }).scripts
    const deployments = listScriptDeployments({
      action: actionRequest.action,
      phase: actionRequest.phase,
      payload: { scriptId: payload.scriptId, deploymentId: payload.deploymentId, limit: 100 },
    }).deployments
    const gaps = []
    const executions = safeSearch(
      "scriptexecutionlog",
      executionFilters(payload, false),
      ["internalid", "script", "scriptdeployment", "type", "title", "detail", "user", "date"],
      maxExecutions,
      gaps,
    )
    const instances = safeSearch(
      "scheduledscriptinstance",
      instanceFilters(payload),
      [
        "internalid",
        "script",
        "scriptdeployment",
        "status",
        "percentcomplete",
        "queue",
        "mapreducestage",
      ],
      maxExecutions,
      gaps,
    )
    return result(actionRequest, {
      scripts,
      deployments,
      executions,
      instances,
      gaps,
      statusSummary: summarizeStatuses(instances),
      governanceUsage: {
        status: "unknown",
        reason: "native execution searches do not expose a reliable per-run governance total",
      },
      stuckAssessment: {
        status: "unknown",
        reason: "no date/time comparison or synthesized execution chronology is performed",
      },
    })
  }

  function getScriptSources(actionRequest) {
    const payload = actionRequest.payload
    const maxScripts = optionalInt(payload, "maxScripts", "limit", 25, 1, 100)
    const maxBytesPerFile = optionalInt(payload, "maxBytesPerFile", null, 1048576, 1, 5242880)
    const filters = []
    if (Array.isArray(payload.scriptIds) && payload.scriptIds.length > 0) {
      const numericIds = payload.scriptIds.filter((value) => isPositiveId(value)).map(String)
      const scriptIds = payload.scriptIds.filter((value) => !isPositiveId(value)).map(String)
      const alternatives = []
      if (numericIds.length > 0) alternatives.push(["internalid", "anyof", numericIds])
      for (const scriptId of scriptIds) alternatives.push(["scriptid", "is", scriptId])
      if (alternatives.length > 0) addFilter(filters, joinWithOr(alternatives))
    } else {
      addIdFilter(filters, "internalid", "scriptid", payload.scriptId)
    }
    if (payload.deploymentId !== undefined && payload.scriptId === undefined) {
      const scriptRef = resolveDeploymentScript(payload.deploymentId)
      addIdFilter(filters, "internalid", "scriptid", scriptRef)
    }
    const rows = runSearch(
      "script",
      filters,
      ["internalid", "scriptid", "name", "scripttype", "scriptfile"],
      maxScripts,
    )
    const sources = []
    const gaps = []
    for (const row of rows) {
      const fileId = scalarValue(row.values.scriptfile)
      if (!fileId) {
        gaps.push({
          scriptId: scalarValue(row.values.scriptid) || row.id,
          reason: "script file is not visible",
        })
        continue
      }
      try {
        const loaded = file.load({ id: fileId })
        if (loaded.size > maxBytesPerFile) {
          gaps.push({
            scriptId: scalarValue(row.values.scriptid) || row.id,
            fileId,
            reason: "source exceeds maxBytesPerFile",
          })
          continue
        }
        sources.push({
          scriptId: scalarValue(row.values.scriptid) || row.id,
          internalId: row.id,
          scriptType: scalarValue(row.values.scripttype),
          deploymentIds: deploymentIdsFor(row.id),
          file: {
            id: String(fileId),
            name: loaded.name,
            path: loaded.path || loaded.url || loaded.name,
          },
          source: loaded.getContents(),
        })
      } catch (error) {
        gaps.push({
          scriptId: scalarValue(row.values.scriptid) || row.id,
          fileId: String(fileId),
          reason: error?.name ? String(error.name) : "source load failed",
        })
      }
    }
    return result(actionRequest, {
      sources,
      gaps,
      maxScripts,
      truncated: rows.length >= maxScripts,
    })
  }

  function executionLogResponse(actionRequest, errorsOnly) {
    const payload = actionRequest.payload
    const maxResults = optionalInt(payload, "limit", "pageSize", 100, 1, 1000)
    const gaps = []
    const logs = safeSearch(
      "scriptexecutionlog",
      executionFilters(payload, errorsOnly),
      ["internalid", "script", "scriptdeployment", "type", "title", "detail", "user", "date"],
      maxResults,
      gaps,
    )
    return result(actionRequest, { logs, gaps, errorsOnly, maxResults })
  }

  function executionFilters(payload, errorsOnly) {
    const filters = []
    addIdFilter(filters, "script", "script.scriptid", payload.scriptId)
    addIdFilter(filters, "scriptdeployment", "scriptdeployment.scriptid", payload.deploymentId)
    if (errorsOnly) addFilter(filters, ["type", "anyof", ["ERROR", "EMERGENCY"]])
    return filters
  }

  function instanceFilters(payload) {
    const filters = []
    addIdFilter(filters, "script", "script.scriptid", payload.scriptId)
    addIdFilter(filters, "scriptdeployment", "scriptdeployment.scriptid", payload.deploymentId)
    return filters
  }

  function resolveDeploymentScript(deploymentId) {
    const filters = []
    addIdFilter(filters, "internalid", "scriptid", deploymentId)
    const matches = runSearch("scriptdeployment", filters, ["script"], 1)
    if (matches.length === 0)
      throw requestError("DEPLOYMENT_NOT_FOUND", "deploymentId was not found")
    return scalarValue(matches[0].values.script)
  }

  function deploymentIdsFor(scriptInternalId) {
    return runSearch(
      "scriptdeployment",
      [["script", "anyof", String(scriptInternalId)]],
      ["scriptid"],
      1000,
    ).map((row) => scalarValue(row.values.scriptid) || row.id)
  }

  function runSearch(type, filters, columns, maxResults) {
    const loaded = search.create({ type, filters, columns })
    return loaded
      .run()
      .getRange({ start: 0, end: maxResults })
      .map((row) => serialize(row, columns))
  }

  function safeSearch(type, filters, columns, maxResults, gaps) {
    try {
      return runSearch(type, filters, columns, maxResults)
    } catch (error) {
      gaps.push({
        source: type,
        reason: error?.name ? String(error.name) : "unsupported or inaccessible",
      })
      return []
    }
  }

  function serialize(row, columns) {
    const values = {}
    for (const column of columns) {
      values[column] = {
        value: row.getValue({ name: column }),
        text: row.getText({ name: column }),
      }
    }
    return { id: String(row.id), recordType: row.recordType, values }
  }

  function scalarValue(entry) {
    if (!entry) return null
    return entry.value === undefined || entry.value === null ? entry.text : entry.value
  }

  function summarizeStatuses(instances) {
    const summary = {}
    for (const row of instances) {
      const status = String(scalarValue(row.values.status) || "unknown")
      summary[status] = (summary[status] || 0) + 1
    }
    return summary
  }

  function addIdFilter(filters, internalField, scriptField, value) {
    if (value === undefined || value === null || value === "") return
    addFilter(
      filters,
      isPositiveId(value)
        ? [internalField, "anyof", String(value)]
        : [scriptField, "is", String(value)],
    )
  }

  function addContainsFilter(filters, field, value) {
    if (typeof value === "string" && value.length > 0)
      addFilter(filters, [field, "contains", value])
  }

  function addFilter(filters, next) {
    if (filters.length > 0) filters.push("AND")
    filters.push(next)
  }

  function joinWithOr(filters) {
    if (filters.length === 1) return filters[0]
    const expression = []
    for (const filter of filters) {
      if (expression.length > 0) expression.push("OR")
      expression.push(filter)
    }
    return expression
  }

  function isPositiveId(value) {
    return (
      (typeof value === "number" && Number.isInteger(value) && value > 0) ||
      /^[1-9]\d*$/.test(String(value))
    )
  }

  function optionalInt(payload, primary, fallback, defaultValue, min, max) {
    const value = payload[primary] === undefined && fallback ? payload[fallback] : payload[primary]
    if (value === undefined || value === null) return defaultValue
    if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max)
      return value
    throw requestError("INVALID_INT", `${primary} must be an integer between ${min} and ${max}`)
  }

  function result(actionRequest, values) {
    return Object.assign({ action: actionRequest.action, phase: actionRequest.phase }, values)
  }

  function requestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

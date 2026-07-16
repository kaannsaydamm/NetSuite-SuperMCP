/**
 * @NApiVersion 2.1
 */
define(["N/error", "N/runtime", "N/search"], (nsError, runtime, search) => {
  const DIAGNOSTIC_ACTIONS = {
    ns_getLoginAuditTrail: getLoginAuditTrail,
    ns_getRoleDiagnosticContext: getRoleDiagnosticContext,
  }

  function run(request) {
    const handler = DIAGNOSTIC_ACTIONS[request.action]
    if (!handler) return null
    if (request.phase !== "preview") {
      throw requestError("READ_ONLY_ACTION", `${request.action} supports preview only`)
    }
    return handler(request)
  }

  function getLoginAuditTrail(request) {
    const limit = boundedInteger(request.payload.limit, 25, 1, 100)
    const filters = []
    if (request.payload.status && request.payload.status !== "either") {
      filters.push(["status", "is", request.payload.status === "success" ? "Success" : "Failure"])
    }
    if (request.payload.userId) {
      if (filters.length > 0) filters.push("AND")
      filters.push(["user", "anyof", String(request.payload.userId)])
    }
    const columns = [
      search.createColumn({ name: "date", sort: search.Sort.DESC }),
      search.createColumn({ name: "user" }),
      search.createColumn({ name: "role" }),
      search.createColumn({ name: "status" }),
      search.createColumn({ name: "emailaddress" }),
      search.createColumn({ name: "ipaddress" }),
      search.createColumn({ name: "requesturi" }),
      search.createColumn({ name: "useragent" }),
      search.createColumn({ name: "detail" }),
    ]
    const auditSearch = search.create({ type: "loginAuditTrail", filters, columns })
    const rows = auditSearch.run().getRange({ start: 0, end: limit + 1 }) || []
    return {
      action: request.action,
      phase: "preview",
      entries: rows.slice(0, limit).map((result) => ({
        date: result.getValue(columns[0]),
        user: result.getText(columns[1]) || result.getValue(columns[1]),
        role: result.getText(columns[2]) || result.getValue(columns[2]),
        status: result.getValue(columns[3]),
        emailAddress: result.getValue(columns[4]),
        ipAddress: result.getValue(columns[5]),
        requestUri: result.getValue(columns[6]),
        userAgent: result.getValue(columns[7]),
        detail: result.getValue(columns[8]),
      })),
      truncated: rows.length > limit,
    }
  }

  function getRoleDiagnosticContext(request) {
    const user = runtime.getCurrentUser()
    const permissionNames = Array.isArray(request.payload.permissions)
      ? request.payload.permissions.slice(0, 50)
      : []
    const featureNames = Array.isArray(request.payload.features)
      ? request.payload.features.slice(0, 50)
      : []
    return {
      action: request.action,
      phase: "preview",
      accountId: runtime.accountId,
      currentUser: {
        id: user.id,
        name: user.name,
        role: user.role,
        roleId: user.roleId,
        roleCenter: user.roleCenter,
      },
      permissions: permissionNames.map((name) => permissionLevel(user, name)),
      features: featureNames.map((name) => ({
        name,
        enabled: runtime.isFeatureInEffect({ feature: name }),
      })),
    }
  }

  function permissionLevel(user, name) {
    try {
      const level = Number(user.getPermission({ name }))
      return { name, level, allowed: level > 0 }
    } catch (error) {
      return { name, level: -1, allowed: false, error: String(error.name || "INVALID_PERMISSION") }
    }
  }

  function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value === undefined ? fallback : value)
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw requestError("INVALID_LIMIT", `limit must be an integer from ${minimum} to ${maximum}`)
    }
    return parsed
  }

  function requestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

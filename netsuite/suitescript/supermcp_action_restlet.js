/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define([
  "N/error",
  "N/runtime",
  "./supermcp_file_actions",
  "./supermcp_integration_actions",
  "./supermcp_mapping_actions",
  "./supermcp_read_actions",
  "./supermcp_transform_actions",
], (
  nsError,
  runtime,
  fileActions,
  integrationActions,
  mappingActions,
  readActions,
  transformActions,
) => {
  const PHASES = ["prepare", "preview", "commit"]
  const SYSTEM_ACTIONS = {
    ns_checkAccountPermissions: checkAccountPermissions,
  }

  function post(request) {
    const actionRequest = parseRequest(request)
    const result =
      runSystemAction(actionRequest) ||
      transformActions.run(actionRequest) ||
      fileActions.run(actionRequest) ||
      readActions.run(actionRequest) ||
      integrationActions.run(actionRequest) ||
      mappingActions.run(actionRequest)
    if (result) {
      return result
    }

    throw createRequestError("UNSUPPORTED_ACTION", `Unsupported action: ${actionRequest.action}`)
  }

  function parseRequest(request) {
    if (!request || typeof request !== "object") {
      throw createRequestError("INVALID_REQUEST", "Request body must be an object")
    }

    const action = requireText(request, "action")
    const phase = requireText(request, "phase")
    if (!PHASES.includes(phase)) {
      throw createRequestError("INVALID_PHASE", `Unsupported phase: ${phase}`)
    }

    const payload = request.payload
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw createRequestError("INVALID_PAYLOAD", "payload must be an object")
    }

    return { action, phase, payload }
  }

  function runSystemAction(actionRequest) {
    const handler = SYSTEM_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function checkAccountPermissions(actionRequest) {
    const currentUser = runtime.getCurrentUser()
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      accountId: runtime.accountId,
      executionContext: runtime.executionContext,
      currentUser: {
        id: currentUser.id,
        name: currentUser.name,
        role: currentUser.role,
        roleId: currentUser.roleId,
        roleCenter: currentUser.roleCenter,
      },
    }
  }

  function requireText(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value !== "string" || value.length === 0) {
      throw createRequestError("MISSING_TEXT", `${fieldId} must be a non-empty string`)
    }
    return value
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { post }
})

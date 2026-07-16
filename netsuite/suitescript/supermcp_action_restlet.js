/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define([
  "N/error",
  "N/runtime",
  "./supermcp_customization_actions",
  "./supermcp_diagnostic_actions",
  "./supermcp_file_actions",
  "./supermcp_inventory_actions",
  "./supermcp_integration_actions",
  "./supermcp_mapping_actions",
  "./supermcp_platform_actions",
  "./supermcp_record_explorer_actions",
  "./supermcp_script_observability_actions",
  "./supermcp_read_actions",
  "./supermcp_report_actions",
  "./supermcp_transform_actions",
], (
  nsError,
  runtime,
  customizationActions,
  diagnosticActions,
  fileActions,
  inventoryActions,
  integrationActions,
  mappingActions,
  platformActions,
  recordExplorerActions,
  scriptObservabilityActions,
  readActions,
  reportActions,
  transformActions,
) => {
  const PHASES = ["prepare", "preview", "commit"]
  const RESTLET_VERSION = "0.1.37"
  const ACTION_MAP_VERSION = "2026-07-16.6"
  const TOOL_COUNT = 165
  const SYSTEM_ACTIONS = {
    ns_getSuperMcpVersion: getSuperMcpVersion,
    ns_checkAccountPermissions: checkAccountPermissions,
  }

  function post(request) {
    const actionRequest = parseRequest(request)
    const result =
      runSystemAction(actionRequest) ||
      customizationActions.run(actionRequest) ||
      diagnosticActions.run(actionRequest) ||
      transformActions.run(actionRequest) ||
      inventoryActions.run(actionRequest) ||
      platformActions.run(actionRequest) ||
      recordExplorerActions.run(actionRequest) ||
      scriptObservabilityActions.run(actionRequest) ||
      reportActions.run(actionRequest) ||
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

  function getSuperMcpVersion(actionRequest) {
    const currentUser = runtime.getCurrentUser()
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      version: RESTLET_VERSION,
      actionMapVersion: ACTION_MAP_VERSION,
      toolCount: TOOL_COUNT,
      accountId: runtime.accountId,
      executionContext: runtime.executionContext,
      currentUser: {
        id: currentUser.id,
        name: currentUser.name,
        role: currentUser.role,
        roleId: currentUser.roleId,
        roleCenter: currentUser.roleCenter,
      },
      systemActions: Object.keys(SYSTEM_ACTIONS),
      actionModules: [
        "transform",
        "customization",
        "diagnostic",
        "inventory",
        "platform",
        "recordExplorer",
        "scriptObservability",
        "report",
        "file",
        "read",
        "integration",
        "mapping",
      ],
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

import { readFile } from "node:fs/promises"
import { ToolName } from "../src/tools/catalog"

const transformPath = "netsuite/suitescript/supermcp_transform_actions.js"
const readPath = "netsuite/suitescript/supermcp_read_actions.js"
const integrationPath = "netsuite/suitescript/supermcp_integration_actions.js"
const mappingPath = "netsuite/suitescript/supermcp_mapping_actions.js"
const actionRestletPath = "netsuite/suitescript/supermcp_action_restlet.js"

const mcpTransformActions = [
  ToolName.TransformRecord,
  ToolName.FulfillSalesOrder,
  ToolName.InvoiceSalesOrder,
  ToolName.ReceivePurchaseOrder,
  ToolName.BillPurchaseOrder,
]

const mcpReadActions = [
  ToolName.RunSavedSearch,
  ToolName.RunReport,
  ToolName.GetFile,
  ToolName.GetIntegrationLogs,
  ToolName.GetScriptLogs,
  ToolName.FindScriptErrors,
  ToolName.ListScripts,
  ToolName.ListScriptDeployments,
  ToolName.GetFailedIntegrationJobs,
  ToolName.ExplainIntegrationError,
]

const mcpIntegrationActions = [ToolName.RetryIntegrationJob]
const mcpMappingActions = [ToolName.GetMapping, ToolName.UpdateMapping]
const mcpSystemRestletActions = [ToolName.CheckAccountPermissions]

const transformSource = await readFile(transformPath, "utf8")
const readSource = await readFile(readPath, "utf8")
const integrationSource = await readFile(integrationPath, "utf8")
const mappingSource = await readFile(mappingPath, "utf8")
const actionRestletSource = await readFile(actionRestletPath, "utf8")
const restletTransformActions = extractRestletActions(transformSource, "TRANSFORM_ACTIONS")
const restletReadActions = extractRestletActions(readSource, "READ_ACTIONS")
const restletIntegrationActions = extractRestletActions(integrationSource, "INTEGRATION_ACTIONS")
const restletMappingActions = extractRestletActions(mappingSource, "MAPPING_ACTIONS")
const restletSystemActions = extractRestletActions(actionRestletSource, "SYSTEM_ACTIONS")

const transformResult = compareActions(mcpTransformActions, restletTransformActions)
const readResult = compareActions(mcpReadActions, restletReadActions)
const integrationResult = compareActions(mcpIntegrationActions, restletIntegrationActions)
const mappingResult = compareActions(mcpMappingActions, restletMappingActions)
const systemResult = compareActions(mcpSystemRestletActions, restletSystemActions)

if (
  !transformResult.ok ||
  !readResult.ok ||
  !integrationResult.ok ||
  !mappingResult.ok ||
  !systemResult.ok
) {
  console.error(
    JSON.stringify(
      {
        actionRestletPath,
        transformPath,
        readPath,
        integrationPath,
        mappingPath,
        system: systemResult,
        transform: transformResult,
        read: readResult,
        integration: integrationResult,
        mapping: mappingResult,
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

console.log(
  `restlet contract ok: ${restletSystemActions.length} system actions, ${restletTransformActions.length} transform actions, ${restletReadActions.length} read actions, ${restletIntegrationActions.length} integration actions, ${restletMappingActions.length} mapping actions`,
)

function compareActions(expected: readonly string[], actual: readonly string[]) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const missing = expected.filter((action) => !actualSet.has(action))
  const unexpected = actual.filter((action) => !expectedSet.has(action))
  return { ok: missing.length === 0 && unexpected.length === 0, missing, unexpected }
}

function extractRestletActions(source: string, objectName: string): readonly string[] {
  const pattern = `const ${objectName} = \\{([\\s\\S]*?)\\n {2}\\}`
  const objectMatch = source.match(new RegExp(pattern))
  if (!objectMatch) {
    throw new Error(`${objectName} object was not found`)
  }

  const body = objectMatch[1]
  if (body === undefined) {
    throw new Error(`${objectName} body was empty`)
  }

  return Array.from(body.matchAll(/\n {4}(ns_[A-Za-z0-9]+): /g), (match) => {
    const action = match[1]
    if (action === undefined) {
      throw new Error("RESTlet action regex returned an empty action")
    }
    return action
  })
}

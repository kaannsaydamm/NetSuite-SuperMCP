import { readFile } from "node:fs/promises"
import { ToolName } from "../src/tools/catalog"

const transformPath = "netsuite/suitescript/supermcp_transform_actions.js"
const inventoryPath = "netsuite/suitescript/supermcp_inventory_actions.js"
const readPath = "netsuite/suitescript/supermcp_read_actions.js"
const filePath = "netsuite/suitescript/supermcp_file_actions.js"
const platformPath = "netsuite/suitescript/supermcp_platform_actions.js"
const reportPath = "netsuite/suitescript/supermcp_report_actions.js"
const integrationPath = "netsuite/suitescript/supermcp_integration_actions.js"
const mappingPath = "netsuite/suitescript/supermcp_mapping_actions.js"
const diagnosticPath = "netsuite/suitescript/supermcp_diagnostic_actions.js"
const actionRestletPath = "netsuite/suitescript/supermcp_action_restlet.js"

const mcpTransformActions = [
  ToolName.TransformRecord,
  ToolName.FulfillSalesOrder,
  ToolName.InvoiceSalesOrder,
  ToolName.ReceivePurchaseOrder,
  ToolName.BillPurchaseOrder,
]

const mcpInventoryActions = ["ns_applyInventoryStockImport"]

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

const mcpFileActions = [
  ToolName.ListFileCabinet,
  ToolName.WriteFile,
  ToolName.CreateFolder,
  ToolName.UpdateFolder,
  ToolName.DeleteFolder,
  ToolName.CopyFile,
  ToolName.MoveFile,
  ToolName.DeleteFile,
]
const mcpPlatformActions = [
  ToolName.ListPlatformObjects,
  ToolName.GetPlatformObject,
  ToolName.SearchRecords,
]
const mcpReportActions = [
  ToolName.ListReportTypes,
  ToolName.ListReports,
  ToolName.RunSearch,
  ToolName.CreateSavedSearch,
  ToolName.UpdateSavedSearch,
  ToolName.DeleteSavedSearch,
]
const mcpIntegrationActions = [ToolName.RetryIntegrationJob]
const mcpMappingActions = [ToolName.GetMapping, ToolName.UpdateMapping]
const mcpSystemRestletActions = [ToolName.GetSuperMcpVersion, ToolName.CheckAccountPermissions]
const mcpDiagnosticActions = [ToolName.GetLoginAuditTrail, "ns_getRoleDiagnosticContext"]

const transformSource = await readFile(transformPath, "utf8")
const inventorySource = await readFile(inventoryPath, "utf8")
const readSource = await readFile(readPath, "utf8")
const fileSource = await readFile(filePath, "utf8")
const platformSource = await readFile(platformPath, "utf8")
const reportSource = await readFile(reportPath, "utf8")
const integrationSource = await readFile(integrationPath, "utf8")
const mappingSource = await readFile(mappingPath, "utf8")
const diagnosticSource = await readFile(diagnosticPath, "utf8")
const actionRestletSource = await readFile(actionRestletPath, "utf8")
const restletTransformActions = extractRestletActions(transformSource, "TRANSFORM_ACTIONS")
const restletInventoryActions = extractRestletActions(inventorySource, "INVENTORY_ACTIONS")
const restletReadActions = extractRestletActions(readSource, "READ_ACTIONS")
const restletFileActions = extractRestletActions(fileSource, "FILE_ACTIONS")
const restletPlatformActions = extractRestletActions(platformSource, "PLATFORM_ACTIONS")
const restletReportActions = extractRestletActions(reportSource, "REPORT_ACTIONS")
const restletIntegrationActions = extractRestletActions(integrationSource, "INTEGRATION_ACTIONS")
const restletMappingActions = extractRestletActions(mappingSource, "MAPPING_ACTIONS")
const restletDiagnosticActions = extractRestletActions(diagnosticSource, "DIAGNOSTIC_ACTIONS")
const restletSystemActions = extractRestletActions(actionRestletSource, "SYSTEM_ACTIONS")

const transformResult = compareActions(mcpTransformActions, restletTransformActions)
const inventoryResult = compareActions(mcpInventoryActions, restletInventoryActions)
const readResult = compareActions(mcpReadActions, restletReadActions)
const fileResult = compareActions(mcpFileActions, restletFileActions)
const platformResult = compareActions(mcpPlatformActions, restletPlatformActions)
const reportResult = compareActions(mcpReportActions, restletReportActions)
const integrationResult = compareActions(mcpIntegrationActions, restletIntegrationActions)
const mappingResult = compareActions(mcpMappingActions, restletMappingActions)
const systemResult = compareActions(mcpSystemRestletActions, restletSystemActions)
const diagnosticResult = compareActions(mcpDiagnosticActions, restletDiagnosticActions)

if (
  !transformResult.ok ||
  !inventoryResult.ok ||
  !readResult.ok ||
  !fileResult.ok ||
  !platformResult.ok ||
  !reportResult.ok ||
  !integrationResult.ok ||
  !mappingResult.ok ||
  !diagnosticResult.ok ||
  !systemResult.ok
) {
  console.error(
    JSON.stringify(
      {
        actionRestletPath,
        transformPath,
        inventoryPath,
        readPath,
        filePath,
        platformPath,
        reportPath,
        integrationPath,
        mappingPath,
        diagnosticPath,
        system: systemResult,
        transform: transformResult,
        inventory: inventoryResult,
        read: readResult,
        file: fileResult,
        platform: platformResult,
        report: reportResult,
        integration: integrationResult,
        mapping: mappingResult,
        diagnostic: diagnosticResult,
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

console.log(
  `restlet contract ok: ${restletSystemActions.length} system actions, ${restletDiagnosticActions.length} diagnostic actions, ${restletTransformActions.length} transform actions, ${restletInventoryActions.length} inventory actions, ${restletReadActions.length} read actions, ${restletFileActions.length} file actions, ${restletPlatformActions.length} platform actions, ${restletReportActions.length} report actions, ${restletIntegrationActions.length} integration actions, ${restletMappingActions.length} mapping actions`,
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

# NetSuite Setup

## OAuth Identity

Choose the NetSuite entity and role that should execute MCP actions. SuperMCP does not require a
specific employee, role, or naming convention; the OAuth Client Credentials mapping determines the
effective NetSuite permissions.

## OAuth 2.0 Authorization Code

For browser login, enable Authorization Code Grant on the NetSuite integration record and set its
redirect URI to the same value as `NETSUITE_REDIRECT_URI`, for example:

```text
https://127.0.0.1:3026/oauth/callback
```

Then set:

- `NETSUITE_OAUTH_FLOW=authorization_code`
- `NETSUITE_AUTHORIZATION_URL`
- `NETSUITE_CLIENT_ID`
- `NETSUITE_CLIENT_SECRET`
- `NETSUITE_REDIRECT_URI`
- `NETSUITE_TOKEN_URL`

Run:

```bash
bun run oauth:login
```

## OAuth 2.0 Client Credentials

For M2M, configure OAuth 2.0 Client Credentials with:

- Integration application.
- Certificate uploaded to NetSuite.
- OAuth Client Credentials mapping for entity + role + application + certificate.
- Separate setup for sandbox and production.

Required environment values:

- `NETSUITE_ACCOUNT_ID`
- `NETSUITE_ENVIRONMENT`
- `NETSUITE_BASE_URL`
- `NETSUITE_RESTLET_URL`
- `NETSUITE_OAUTH_FLOW`
- `NETSUITE_CONSUMER_KEY`
- `NETSUITE_CERTIFICATE_ID`
- `NETSUITE_PRIVATE_KEY_PEM_BASE64`
- `NETSUITE_TOKEN_URL`

## Role Permissions

Give the mapped role the permissions you want MCP clients to have. Common permission groups are:

- REST Web Services
- Log in using Access Tokens
- SuiteAnalytics Workbook
- SuiteScript
- Custom Records and Custom Lists
- Saved Searches and Reports
- File Cabinet / Documents and Files
- Sales Order, Item Fulfillment, Invoice, Credit Memo, Customer Refund
- Purchase Order, Item Receipt, Vendor Bill, Vendor Credit
- Inventory Adjustment, Inventory Transfer, Transfer Order
- Customer, Vendor, Item, Location, Department, Class, Currency

NetSuite permission checks still apply. SuperMCP sends requests as the mapped OAuth account; it
does not bypass NetSuite authorization.

## RESTlet Action Layer

Deploy these SuiteScript files together:

- [supermcp_action_restlet.js](../netsuite/suitescript/supermcp_action_restlet.js)
- [supermcp_customization_actions.js](../netsuite/suitescript/supermcp_customization_actions.js)
- [supermcp_file_actions.js](../netsuite/suitescript/supermcp_file_actions.js)
- [supermcp_diagnostic_actions.js](../netsuite/suitescript/supermcp_diagnostic_actions.js)
- [supermcp_record_explorer_actions.js](../netsuite/suitescript/supermcp_record_explorer_actions.js)
- [supermcp_script_observability_actions.js](../netsuite/suitescript/supermcp_script_observability_actions.js)
- [supermcp_inventory_actions.js](../netsuite/suitescript/supermcp_inventory_actions.js)
- [supermcp_operation_actions.js](../netsuite/suitescript/supermcp_operation_actions.js)
- [supermcp_platform_actions.js](../netsuite/suitescript/supermcp_platform_actions.js)
- [supermcp_report_actions.js](../netsuite/suitescript/supermcp_report_actions.js)
- [supermcp_integration_actions.js](../netsuite/suitescript/supermcp_integration_actions.js)
- [supermcp_mapping_actions.js](../netsuite/suitescript/supermcp_mapping_actions.js)
- [supermcp_transform_actions.js](../netsuite/suitescript/supermcp_transform_actions.js)
- [supermcp_read_actions.js](../netsuite/suitescript/supermcp_read_actions.js)

Deploy `supermcp_action_restlet.js` as the RESTlet entry point and set `NETSUITE_RESTLET_URL`
to its deployment URL. The RESTlet accepts:

```json
{
  "action": "ns_billPurchaseOrder",
  "phase": "commit",
  "payload": {
    "purchaseOrderId": "12345"
  }
}
```

### Supported mapping actions

| Action | Required payload | Behavior |
|---|---|---|
| `ns_getMapping` | `recordType`, `recordId` | Loads one mapping record and returns selected fields |
| `ns_updateMapping` | `recordType`, `recordId`, `values` | Updates one mapping record with `record.submitFields` |

`ns_getMapping` can receive a `fields` array. `ns_updateMapping` can be committed directly by MCP
clients that approve medium-risk tools.

The RESTlet owns `record.transform`, script/log access, retry operations, and channel-specific
actions that cannot be represented cleanly through REST Record CRUD.

Run `ns_getSuperMcpVersion` after deploy. The RESTlet portion should report the deployed RESTlet
version, action map version, account ID, execution context `RESTLET`, current NetSuite user/role,
and `toolCount: 183`.

### Supported transform actions

| Action | Required payload | Transform |
|---|---|---|
| `ns_transformRecord` | `fromType`, `fromId`, `toType` | Generic transform |
| `ns_fulfillSalesOrder` | `salesOrderId` | Sales Order → Item Fulfillment |
| `ns_invoiceSalesOrder` | `salesOrderId` | Sales Order → Invoice |
| `ns_receivePurchaseOrder` | `purchaseOrderId` | Purchase Order → Item Receipt |
| `ns_billPurchaseOrder` | `purchaseOrderId` | Purchase Order → Vendor Bill |

### Supported read actions

| Action | Required payload | Behavior |
|---|---|---|
| `ns_runSavedSearch` | `savedSearchId` | Runs a saved search page and returns serialized result values/text |
| `ns_runReport` | `reportId` | Runs a saved-search-backed report page and returns serialized result values/text |
| `ns_getFile` | `fileId` | Loads a File Cabinet text/source file and returns metadata plus contents |
| `ns_getIntegrationLogs` | `savedSearchId` | Runs the configured integration-log saved search page |
| `ns_getScriptLogs` | `savedSearchId` | Runs the configured script execution log saved search page |
| `ns_findScriptErrors` | `savedSearchId` | Runs the configured script execution error saved search page |
| `ns_listScripts` | `savedSearchId` | Runs the configured script inventory saved search page |
| `ns_listScriptDeployments` | `savedSearchId` | Runs the configured script deployment inventory saved search page |
| `ns_getFailedIntegrationJobs` | `savedSearchId` | Runs the configured failed-integration-jobs saved search page |
| `ns_explainIntegrationError` | `recordType`, `recordId` | Loads one integration job/error record and returns selected fields plus candidate error text |

Optional paging fields:

```json
{
  "limit": 100,
  "pageIndex": 0
}
```

`limit` is accepted as the friendly alias for `pageSize` on paged read actions. If both `limit` and
`pageSize` are supplied, they must match.

`ns_explainIntegrationError` can also receive a `fields` array. If omitted, the RESTlet reads common
integration error fields such as `name`, `custrecord_error`, `custrecord_message`,
`custrecord_details`, and `custrecord_payload`.

`ns_getFile` accepts a numeric internal ID or File Cabinet path in `fileId`. Optional `maxBytes`
defaults to 1 MB and cannot exceed the `File.getContents()` 10 MB in-memory limit.

### Supported platform and report actions

| Action | Required payload | Behavior |
|---|---|---|
| `ns_listPlatformObjects` | optional `category` | Lists platform objects such as scripts, deployments, integrations, files, folders, custom lists, custom record types, and saved searches |
| `ns_getPlatformObject` | `recordType`, `recordId` | Loads a platform record and returns selected fields |
| `ns_searchRecords` | `recordType` | Runs a generic paged `N/search` over any searchable record type |
| `ns_listReportTypes` | none | Returns report/search categories exposed by the RESTlet |
| `ns_listReports` | optional `query` | Lists saved-search-backed reports/searches |
| `ns_runSearch` | `recordType` | Runs an ad hoc paged search with optional `filters` and `columns` |
| `ns_createSavedSearch` | `recordType`, `title`, `confirmation` | Creates a saved search with optional `filters`, `columns`, `searchId`, and `isPublic` |
| `ns_updateSavedSearch` | `searchId`, `values`, `confirmation` | Updates saved search fields through NetSuite permissions |
| `ns_deleteSavedSearch` | `searchId`, `confirmation` | Deletes a saved search |

Read-only platform/report direct tools run as `phase: "preview"`. Mutating saved-search tools
create operation plans and can be committed only with `ns_commitAction`. Direct MCP calls accept either
top-level arguments or `{ "payload": { ... } }`; both shapes are routed to the same RESTlet payload.

### Supported File Cabinet management actions

| Action | Required payload | Behavior |
|---|---|---|
| `ns_listFileCabinet` | optional `folderId` or `path` | Lists File Cabinet folders and files with optional `query` and `limit`/`maxEntries` |
| `ns_writeFile` | `fileId` + `contents` + `confirmation`, or `folderId` + `name` + `contents` + `confirmation` | Writes a text/source file to File Cabinet, including SuiteScript `.js` files |
| `ns_createFolder` | `name`, `confirmation` | Creates a File Cabinet folder, optionally under `parent` |
| `ns_updateFolder` | `folderId`, `confirmation` | Updates a folder `name` and/or `parent` |
| `ns_deleteFolder` | `folderId`, `confirmation` | Deletes a File Cabinet folder |
| `ns_copyFile` | `fileId`, `targetFolderId`, `confirmation` | Copies a File Cabinet file, optionally with a new `name` |
| `ns_moveFile` | `fileId`, `targetFolderId`, `confirmation` | Moves a File Cabinet file to another folder |
| `ns_deleteFile` | `fileId`, `confirmation` | Deletes a File Cabinet file |

`ns_writeFile` uses NetSuite `N/file` and returns a server-side operation plan. Preview that plan,
then commit it through `ns_commitAction`. Existing files can be targeted by internal ID or File Cabinet path in `fileId`;
new files require `folderId`, `name`, and optional `fileType` such as `JAVASCRIPT`.

Examples:

```json
{ "path": "/SuiteScripts", "limit": 10 }
```

```json
{ "folderId": -15, "maxEntries": 10 }
```

`/SuiteScripts` resolves to NetSuite's native SuiteScripts folder ID. Missing folder paths return
`notFound: true` with empty `files` and `folders` arrays instead of failing output validation.

### Supported integration actions

| Action | Required payload | Behavior |
|---|---|---|
| `ns_retryIntegrationJob` | `recordType`, `recordId`, `values` | Commits field updates that mark a configured integration job for retry |

Direct `ns_retryIntegrationJob` MCP calls run as `commit`. To explicitly call the generic commit
wrapper, use `ns_commitAction` with:

```json
{
  "action": "ns_retryIntegrationJob",
  "phase": "commit",
  "payload": {
    "recordType": "customrecord_integration_job",
    "recordId": "456",
    "values": {
      "custrecord_retry_requested": true
    },
    "confirmation": "retry:customrecord_integration_job:456"
  }
}
```

Optional body fields can be set with:

```json
{
  "values": {
    "memo": "Created by NetSuite SuperMCP"
  }
}
```

### Phases

- `prepare`: validates payload and returns the transform plan without loading or saving a target record.
- `preview`: runs `record.transform`, applies optional body fields, summarizes line counts, and does not save.
- `commit`: runs `record.transform`, applies optional body fields, saves the target record, and returns the new record reference.

For non-transform read actions, direct MCP tools use `preview` as the read phase. Use
`ns_prepareAction`, `ns_previewAction`, and `ns_commitAction` when you need explicit phase control
for any RESTlet action.

Run `ns_checkAccountPermissions` after OAuth mapping, role permission, or RESTlet deployment
changes to verify the configured account's effective access.

Run this before deploying RESTlet changes:

```bash
bun run check:restlet-contract
```

To generate a SuiteCloud Account Customization Project for the RESTlet deployment:

```bash
netsuite-supermcp suitecloud
```

Existing SuiteCloud browser-auth IDs can be reused non-interactively:

```bash
netsuite-supermcp suitecloud --deploy --auth-id supermcp-11675047
```

Oracle SuiteCloud CLI requires JDK 17 or 21. If your machine has a newer Java version, install
JDK 17 or 21 and point `JAVA_HOME`/`PATH` to that JDK before running SuiteCloud deploy commands.

# NetSuite SuperMCP

NetSuite SuperMCP is a single MCP endpoint for AI clients to operate NetSuite through the
NetSuite OAuth account and role you configure.

Includes:

- Streamable HTTP MCP endpoint.
- Bearer-token protection for MCP clients.
- Strict Zod config parsing.
- Tool risk metadata and audit logging.
- File-backed audit log.
- NetSuite REST/RESTlet adapter boundaries.
- Read, write, action, audit, capability, platform, File Cabinet, reporting, and account-permission tools.
- Typed record/field discovery, bounded batch reads, transaction graphs, System Notes, snapshots, diffs,
  and redacted evidence bundles.
- Inventory stock import preparation and commit tools for XLS/CSV-derived stock counts.
- Connector-visible version diagnostics with local MCP, npm package, RESTlet, tool-count, account, and execution-context details.

## Local Setup

Install from npm:

```bash
npm install -g netsuite-supermcp
netsuite-supermcp oauth2
netsuite-supermcp install --all-detected
```

`oauth2` is the shortest browser-login path. It asks only for your NetSuite account ID and the
Integration Client ID/Secret when they are not already in `.env`, derives the NetSuite OAuth/REST
URLs, opens the NetSuite OAuth consent screen, saves the refresh token, and runs `doctor`.

Use `setup` when you also want the longer guided wizard with NetSuite Integration instructions and
detected agent-client install prompts.

Useful direct commands:

```bash
netsuite-supermcp oauth2
netsuite-supermcp switch-account
netsuite-supermcp public-url
netsuite-supermcp setup
netsuite-supermcp doctor
netsuite-supermcp suitecloud
netsuite-supermcp suitecloud --deploy --auth-id supermcp-11675047
netsuite-supermcp-public-url
netsuite-supermcp-oauth2
netsuite-supermcp-oauth-login
netsuite-supermcp-install --list
netsuite-supermcp-stdio
```

Run directly with npm/npx:

```bash
npx netsuite-supermcp oauth2
npx netsuite-supermcp switch-account
npx netsuite-supermcp setup
npx netsuite-supermcp doctor
npx netsuite-supermcp suitecloud
npx netsuite-supermcp public-url
npx netsuite-supermcp install --all-detected
npx netsuite-supermcp oauth-login
npx netsuite-supermcp stdio
npx netsuite-supermcp http
```

Install from source:

```bash
bun install
cp .env.example .env
bun run install:clients --list
bun run install:clients --all-detected
bun run typecheck
bun test
bun run smoke
bun run dev
```

Windows setup wrapper:

```powershell
.\setup.ps1 -AllDetected
```

Or run `setup.cmd` from Explorer/terminal. The setup wrapper installs dependencies, creates `.env`
from `.env.example` when missing, and registers detected MCP clients without changing any client
approval settings.

macOS/Linux setup wrapper:

```bash
sh ./setup.sh --all-detected
```

The MCP endpoint is available at:

```text
http://127.0.0.1:3025/mcp
```

Health check:

```text
http://127.0.0.1:3025/health
```

## ChatGPT Server URL With ngrok

For ChatGPT's custom app "Server URL" mode, run:

```bash
netsuite-supermcp public-url
```

The command starts the local MCP server, downloads the ngrok agent into your user profile when it
is not already installed, starts an HTTPS public tunnel, and prints a URL like:

```text
https://example.ngrok-free.app/mcp
```

In ChatGPT, use:

- Connection: `Server URL`
- Authentication: `No auth`
- URL: the printed `/mcp` URL

Keep the terminal open while ChatGPT uses the connector. If ngrok has not been configured on the
machine before, the command opens the ngrok authtoken page and asks you to paste the token once.

## Verification

```bash
bun run typecheck
bun run lint
bun test
bun run check:restlet-contract
bun run probe:live
bun run smoke
```

`bun run smoke` starts the server with sandbox-shaped local config, verifies `/health`,
unauthorized MCP rejection, MCP initialize, and `ns_getEnvironment`, then shuts the server down.

`netsuite-supermcp doctor` uses your real `.env` and runs non-mutating live probes for OAuth,
REST metadata, SuiteQL, and the RESTlet action layer.

Use `ns_getSuperMcpVersion` from any connected MCP client to verify what that client is actually
seeing. It returns the local MCP package/configured version, MCP tool count, deployed RESTlet
version, RESTlet action map version, NetSuite account ID, and RESTlet execution context. If a
client still shows an old tool count after an update, restart that client/server process and call
this tool first.

`configuredVersion` normally follows the installed package version. Leave
`MCP_SERVER_VERSION_OVERRIDE` empty unless you intentionally need a custom server version string in
client metadata.

`bun run probe:live` uses your real `.env` and calls the MCP tool surface with live-safe probes.
Read-only tools are called directly when safe IDs can be discovered; write/delete/transform actions
are exercised through `ns_prepareAction` so NetSuite data is not changed.

SuiteScript source files and File Cabinet folders can be listed with `ns_listFileCabinet`, read
with `ns_getFile`, and managed with `ns_writeFile`, `ns_createFolder`, `ns_updateFolder`,
`ns_deleteFolder`, `ns_copyFile`, `ns_moveFile`, and `ns_deleteFile` through the RESTlet action
layer. Mutating File Cabinet tools return a server-side operation plan without changing NetSuite.
Review it with `ns_previewAction`, then pass its `operationId` and exact `confirmation` to
`ns_commitAction`.

Direct tool calls accept either top-level arguments or a `payload` object. These are equivalent:

```json
{ "path": "/SuiteScripts", "limit": 10 }
```

```json
{ "payload": { "path": "/SuiteScripts", "limit": 10 } }
```

`ns_listFileCabinet` accepts `folderId` or `path`. NetSuite root folders such as `/SuiteScripts`
resolve to their native folder IDs, and missing paths return `notFound: true` with empty lists
instead of failing output validation. Use `limit` as the friendly alias for File Cabinet
`maxEntries`.

Platform/report discovery tools include `ns_listPlatformObjects`, `ns_getPlatformObject`,
`ns_searchRecords`, `ns_listReportTypes`, `ns_listReports`, `ns_runSearch`,
`ns_createSavedSearch`, `ns_updateSavedSearch`, and `ns_deleteSavedSearch`. These run under the
configured NetSuite OAuth role, so NetSuite permissions decide what the agent can see or mutate.
Use `limit` or `pageSize` for paged platform/report reads. Read-only direct calls return
`phase: "preview"`. Mutating direct calls are prepare-only and can change NetSuite only through a
bound, single-use `ns_commitAction` operation plan. The calling harness still owns user approval
and tool availability.

## Record Explorer And Evidence

Record discovery tools expose record types and fields without requiring the model to guess internal
IDs: `ns_listRecordTypes`, `ns_describeRecordType`, `ns_listRecordFields`, `ns_describeField`, and
`ns_findFieldByLabel`. REST metadata is preferred; unsupported record families use the bundled,
permanent read-only SuiteScript fallback.

`ns_batchResolveInternalIds`, `ns_batchGetRecords`, and `ns_getRecordWithSublists` are explicitly
bounded and return per-record gaps instead of discarding successful reads. Transaction inspection
uses `ns_getTransactionChain`, `ns_getSystemNotes`, `ns_explainRecordHistory`,
`ns_getTransactionEventStream`, and `ns_diagnoseTransaction`. System Notes retain NetSuite's raw
values and returned sequence. SuperMCP does not normalize, sort, compare, infer, or rewrite date/time
values.

`ns_createRecordSnapshot`, `ns_diffRecordSnapshots`, and `ns_createEvidenceBundle` produce typed
business-field differences and deterministic, secret-redacted evidence manifests with SHA-256
hashes. Evidence remains read-only and cites its source record, query, log, file, or audit reference.

## Safe SuiteQL And Exports

`ns_buildSuiteQL`, `ns_validateSuiteQL`, and `ns_explainSuiteQL` provide parameterized construction,
tokenized read-only validation, row-cap requirements, cost warnings, and sensitive-field
classification. `ns_runSuiteQLPaged` uses an explicitly selected unique key and a signed opaque
cursor; it does not use offset pagination for large reads. `ns_incrementalExport` exposes the same
cursor as an opaque checkpoint and does not infer or compare date/time fields.

`ns_exportSuiteQL` and `ns_exportSavedSearch` create persistent jobs. Continue them with
`ns_runJobStep`; inspect, cancel, or recover them with `ns_getJobStatus`, `ns_cancelJob`, and
`ns_resumeJob`. Completed CSV/JSONL exports are exposed as `netsuite-supermcp://exports/{resourceId}`
MCP resources and can be gzip-compressed. Deterministic chunk files prevent completed chunks from
being duplicated after resume. Saved Search definition export, diff, and clone preview are also
read-only; a clone is created only through the normal prepare/commit operation-plan flow.

## SuiteScript Observability And Source Audit

`ns_getScriptObservability` reads native script, deployment, execution-log, and scheduled-instance
evidence directly by script or deployment ID; it does not require an account-specific Saved Search.
`ns_analyzeScript`, `ns_findScriptDependencies`, `ns_findRecordWriters`,
`ns_findRecordReaders`, `ns_findFieldUsage`, and `ns_findDuplicateScriptLogic` read bounded source
sets through the permanent RESTlet module. Findings include file, line, rule, severity, confidence,
and redacted evidence. Secret-like literals are represented only by a SHA-256 fingerprint.

Static analysis is deliberately conservative. Dynamic AMD dependencies and unsupported dependency
types are returned as `unknown`; they are never invented. Execution values remain as NetSuite
returns them. SuperMCP does not compare or normalize date/time values to infer stuck executions.

## Integration Reconciliation And Safe Replay

Versioned integration contracts define canonical keys, mappings, field semantics, and invariants.
`ns_reconcileRecords` plus the order, inventory, return, and payment variants classify missing,
extra, duplicate, amount, status, quantity, value, and delayed-processing differences and link
summary totals to record evidence. External-system credentials remain in provider-owned storage;
the harness supplies canonical external records to SuperMCP.

`ns_shadowPayload`, `ns_replayPayload`, and regression execution call only RESTlet `preview` phases
and cannot save NetSuite records. Sandbox replay is rejected unless the configured NetSuite account
is a sandbox. Canary prepare/monitor/promote/abort is bounded by an explicit predicate and record
count. Promotion only validates existing operation plans and returns `requiresHarnessApproval`; it
never commits them.

Synthetic test data and anonymization require explicit templates and field lists. Integration event
subscriptions use a persistent idempotent outbox; SuperMCP does not contact endpoints itself. The
provider polls and delivers events, then acknowledges success or failure for deterministic retry.

## Customization Drift And Deployment Plans

`ns_inventoryCustomizations` uses permanent native NetSuite searches for custom records, fields,
lists, scripts, deployments, workflows, forms, searches, roles, integrations, bundles, SuiteApps,
and files. Objects without a stable script ID are returned as explicit gaps. Environment comparison
uses type, script ID, definition checksum, deployment state, permissions, and dependencies; it never
matches by internal ID alone and excludes date/time fields from drift checks.

`ns_generateSuiteCloudProject` creates a bounded checksum-pinned project from explicitly selected
objects and files. Validate and preview it before `ns_prepareCustomizationDeployment`. Preparation
stores a provider command, changed object list, confirmation, and harness-approval requirement but
does not execute SuiteCloud or mutate NetSuite. After the provider runs the reviewed command,
`ns_recordCustomizationDeploymentResult` records uploaded files, changed objects, validation
warnings, and provider evidence. `ns_verifyCustomizationDeployment` checks the live RESTlet version.

Rollback output includes only files whose previous content and checksum were captured. Migration,
cleanup, technical-debt, orphan, and documentation outputs never invent owners or delete objects;
cleanup remains a proposal for the normal operation-plan flow.

## Business Metrics And Lineage

Business terms and metrics are requester-owned, immutable `id + version` definitions stored in
`SEMANTIC_STORE_PATH`. Define them with `ns_defineBusinessTerm` and `ns_defineMetric`; retrieve and
compare them with `ns_getMetricDefinition` and `ns_compareMetricDefinitions`. Definitions explicitly
name their NetSuite table, fields, aggregation, dimensions, filters, exclusions, currency metadata,
owner, and source references. SuperMCP ships no account-specific meaning for sales, stock, margin,
returns, active items, or other ambiguous business terms.

`ns_planBusinessQuery` and `ns_validateMetricPlan` compile only the selected metric version into a
parameterized, read-only SuiteQL plan and return its table, fields, formula, filters, exclusions,
lineage, and deterministic fingerprint before execution. `ns_runMetric` executes the bounded plan.
Every result row carries its formula, query and plan fingerprints, term references, source table and
fields, and caller-supplied record, integration, Saved Search, or query references.

`ns_generateMetricReport` returns the same evidence-backed rows as a structured report.
`ns_exportMetricResult` writes a bounded JSONL or CSV resource, optionally gzip-compressed, with the
evidence attached. No semantic tool normalizes, converts, compares, infers, or rewrites date/time
values.

## Process Assurance And Simulation

`ns_discoverProcess` builds process variants and edges from explicitly ordered transaction-chain
evidence, calculates bottleneck facts only from caller-supplied durations, and preserves visibility
gaps as `unknown`. `ns_discoverBusinessRules` requires every candidate to be labeled `observed`,
`inferred`, or `configured` with confidence, source location, and evidence.
`ns_analyzeFieldWriteConflicts` groups multiple field writers and reports ordering as `unknown`
unless every writer includes explicit ordering evidence.

`ns_profileDataQuality`, `ns_validateMasterData`, and `ns_evaluateInvariants` run bounded declarative
rules with severity and remediation. Pattern rules use only a literal `*` wildcard, not arbitrary
regular expressions. `ns_evaluatePolicyFacts` returns matches and effects but always reports
`enforced: false`; the provider or agent harness owns enforcement and approval.

`ns_simulateDownstreamImpact`, `ns_simulateInventoryState`, and
`ns_simulateChannelAllocation` require complete scenario inputs and return `mutatesNetSuite: false`.
They never enter an operation commit path and never select a location, status, channel, account, or
policy default. `ns_previewGlImpact` accepts exactly one source: NetSuite-provided GL lines, explicit
caller estimates, or a prepared operation plan. Non-NetSuite sources are always labeled estimated.
`ns_rankRootCauses` ranks explicit hypotheses while retaining supporting evidence, contradicting
evidence, and uncertainty.

## Runbooks, Repairs, And Evidence Memory

`ns_defineRunbook` stores immutable typed steps that reference existing MCP tools and operation
plans. `ns_previewRunbook`, `ns_startRunbook`, `ns_getRunbookExecution`, and
`ns_recordRunbookStep` maintain persistent, resumable, ordered execution state. The provider or
harness executes each referenced tool and records the result. SuperMCP never hides nested tool
execution. Mutating steps require a connection-bound operation plan, preview output, and expected
preview fingerprint; changed evidence stops the runbook before any commit.

`ns_proposeRepair` and `ns_prepareBoundedRepair` never execute a repair. By default no repair class
is low risk. A provider may explicitly list local-only classes in
`RUNBOOK_LOW_RISK_REPAIR_CLASSES`; financial, destructive, and unlisted repairs remain
proposal-only. Existing operation plans are required where the operation protocol applies, and the
harness owns final approval and execution.

`ns_correlateIncidents` groups deterministic identifiers before bounded message similarity.
`ns_measureSla` evaluates caller-supplied durations without deriving or normalizing timestamps.
`ns_buildSupportEvidenceBundle` creates redacted manifests, hashes, and reproducible-query evidence.
`ns_generateLiveDocumentation` fingerprints caller-supplied live architecture, script, field, role,
search, mapping, transaction-flow, and runbook metadata.

`ns_recordEvidenceClaim` stores claim, evidence, confidence, and a content fingerprint. Replacing a
current claim requires its exact `supersedesVersion`; `ns_getEvidenceMemory` returns the full claim
history so a later conversation cannot silently contradict prior evidence.

## Inventory Stock Imports

For stock count files such as Fastmag/Paris stock exports, parse the file into rows and call:

- `ns_prepareInventoryStockImport`
- `ns_commitInventoryStockImport`

Both names prepare the same server-side operation plan; `ns_commitInventoryStockImport` remains as
a compatibility alias and does not commit directly. The planner matches each row to NetSuite items
with `itemMatchField` (`upccode` by default), reads current stock from `inventorybalance` for the
target `locationId`, calculates `targetQuantity - currentQuantity`, and returns rejected rows,
impact details, an opaque `operationId`, and an exact confirmation. It does not change NetSuite.

Commit with `ns_commitAction`. It recomputes and fingerprints the same stock state, rejects stale
plans and plans with missing/duplicate/ambiguous rows, and creates one `inventoryAdjustment` with
`adjustQtyBy` lines through the permanent SuperMCP RESTlet inventory module. It never uploads a
temporary SuiteScript file or modifies the RESTlet at runtime. Required NetSuite IDs are
`locationId` and `adjustmentAccountId`; provide `subsidiaryId` when the account requires it.

When an inventory adjustment needs an Inventory Status assignment, pass its explicitly discovered
`inventoryStatusId`. SuperMCP does not select a default status or adjustment account: use
`ns_findInventoryAdjustmentAccounts` and the relevant NetSuite lookup before committing.

Use `ns_findInventoryAdjustmentAccounts` to find likely `adjustmentAccountId` values from NetSuite
accounts without leaving the agent. Pass `search` or `preferredAccountNumberPrefix` when the user
knows the local chart-of-accounts convention; otherwise it searches generic inventory/stock
adjustment terms and returns candidate internal IDs for review.

## Typed Tool Contracts

Every public tool has a bounded input schema, output schema, risk/effect metadata, permission hints,
phase behavior, and valid/invalid examples. Use `ns_describeTool`, `ns_getToolExample`, and
`ns_validateToolRequest`; validation is local and does not call NetSuite. Generated references are
in [docs/generated/tool-contracts.md](docs/generated/tool-contracts.md) and cached ChatGPT app
guidance is in [docs/generated/chatgpt-compatibility.md](docs/generated/chatgpt-compatibility.md).

Deployment details are in [docs/deployment.md](docs/deployment.md).
Agent client setup details are in [docs/client-setup.md](docs/client-setup.md).

## NetSuite Identity Model

Execution uses the NetSuite OAuth mapping from `.env`. For user-delegated access, run
`netsuite-supermcp oauth2`; it configures `.env`, opens NetSuite in the browser, captures the
authorization callback, exchanges the code for a refresh token, and saves it to `.env`.
`netsuite-supermcp-oauth-login` is still available when `.env` is already configured. For
machine-to-machine access, set `NETSUITE_OAUTH_FLOW=client_credentials` and provide the certificate
values.

Run `netsuite-supermcp auth-diagnose` for offline configuration checks followed by authenticated
metadata/RESTlet probes. Run `netsuite-supermcp logout` to revoke the current authorization-code
refresh token at NetSuite and remove it from `.env`; use `--local-only` when only local removal is
required. Run `netsuite-supermcp switch-account` to clear the local token and immediately start
browser OAuth with NetSuite `prompt=login consent` for another account or role.

Identity diagnostics include `ns_getLoginAuditTrail`, `ns_diagnoseAuthentication`,
`ns_testOAuthCredentials`, `ns_getOAuthTokenMetadata`, `ns_analyzeRoleAccess`,
`ns_compareRoleVisibility`, `ns_explainTokenEligibility`, `ns_getIdentityRelationship`,
`ns_getIntegrationState`, and `ns_analyzeSegregationOfDuties`. The optional
`NETSUITE_MANAGEMENT_*` profile is used only when a diagnostic explicitly selects `management`;
normal NetSuite tools always use the primary OAuth identity.

## SuiteCloud Deploy

`netsuite-supermcp suitecloud --deploy` generates the bundled SuiteCloud project and runs Oracle
SuiteCloud CLI through `npx -y @oracle/suitecloud-cli@3.2.0`. Pass `--auth-id <id>` to reuse an
existing SuiteCloud browser-auth ID without the interactive account picker. When only one matching
auth ID is configured, SuperMCP selects it automatically. On Windows, if Java 17/21 is not
available, it installs a portable Temurin JDK 21 under the user profile and uses it only for that
SuiteCloud process.

SuperMCP does not impose a specific employee, role, or naming convention. It also does not bypass
NetSuite authorization; NetSuite allows or denies actions based on the mapped account's permissions.

## Tool Safety

Tools return risk metadata and write audit events. Client applications, harness settings, or the
user decide approval. Use `ns_checkAccountPermissions` to probe the configured account's effective
REST, SuiteQL, record metadata, and optional RESTlet access.

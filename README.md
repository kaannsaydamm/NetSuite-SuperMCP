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
- Inventory stock import preparation and commit tools for XLS/CSV-derived stock counts.

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

`bun run probe:live` uses your real `.env` and calls the MCP tool surface with live-safe probes.
Read-only tools are called directly when safe IDs can be discovered; write/delete/transform actions
are exercised through `ns_prepareAction` so NetSuite data is not changed.

SuiteScript source files and File Cabinet folders can be listed with `ns_listFileCabinet`, read
with `ns_getFile`, and managed with `ns_writeFile`, `ns_createFolder`, `ns_updateFolder`,
`ns_deleteFolder`, `ns_copyFile`, `ns_moveFile`, and `ns_deleteFile` through the RESTlet action
layer. Use `ns_prepareAction`/`ns_previewAction` first to get the required confirmation string
before committing File Cabinet writes/deletes/moves.

Platform/report discovery tools include `ns_listPlatformObjects`, `ns_getPlatformObject`,
`ns_searchRecords`, `ns_listReportTypes`, `ns_listReports`, `ns_runSearch`,
`ns_createSavedSearch`, `ns_updateSavedSearch`, and `ns_deleteSavedSearch`. These run under the
configured NetSuite OAuth role, so NetSuite permissions decide what the agent can see or mutate.

## Inventory Stock Imports

For stock count files such as Fastmag/Paris stock exports, parse the file into rows and call:

- `ns_prepareInventoryStockImport`
- `ns_commitInventoryStockImport`

The prepare tool matches each row to NetSuite items with `itemMatchField` (`upccode` by default),
reads current stock from `inventorybalance` for the target `locationId`, calculates
`targetQuantity - currentQuantity`, and returns rejected rows plus a confirmation string. It does
not change NetSuite.

The commit tool recomputes the same plan, requires the exact confirmation string, rejects commits
while missing/duplicate/ambiguous rows exist, and creates one `inventoryAdjustment` with
`adjustQtyBy` lines. Required NetSuite IDs are `locationId` and `adjustmentAccountId`; provide
`subsidiaryId` when the account requires it.

Use `ns_findInventoryAdjustmentAccounts` to find likely `adjustmentAccountId` values from NetSuite
accounts without leaving the agent. Pass `search` or `preferredAccountNumberPrefix` when the user
knows the local chart-of-accounts convention; otherwise it searches generic inventory/stock
adjustment terms and returns candidate internal IDs for review.

Deployment details are in [docs/deployment.md](docs/deployment.md).
Agent client setup details are in [docs/client-setup.md](docs/client-setup.md).

## NetSuite Identity Model

Execution uses the NetSuite OAuth mapping from `.env`. For user-delegated access, run
`netsuite-supermcp oauth2`; it configures `.env`, opens NetSuite in the browser, captures the
authorization callback, exchanges the code for a refresh token, and saves it to `.env`.
`netsuite-supermcp-oauth-login` is still available when `.env` is already configured. For
machine-to-machine access, set `NETSUITE_OAUTH_FLOW=client_credentials` and provide the certificate
values.

To leave the current OAuth browser account and connect another NetSuite account or role, run
`netsuite-supermcp switch-account` or `netsuite-supermcp logout`. This clears only the local refresh
token and restarts browser OAuth with NetSuite `prompt=login consent`; it does not revoke the
Integration record or change NetSuite data.

## SuiteCloud Deploy

`netsuite-supermcp suitecloud --deploy` generates the bundled SuiteCloud project and runs Oracle
SuiteCloud CLI through `npx -y @oracle/suitecloud-cli@3.2.0`. On Windows, if Java 17/21 is not
available, it installs a portable Temurin JDK 21 under the user profile and uses it only for that
SuiteCloud process.

SuperMCP does not impose a specific employee, role, or naming convention. It also does not bypass
NetSuite authorization; NetSuite allows or denies actions based on the mapped account's permissions.

## Tool Safety

Tools return risk metadata and write audit events. Client applications, harness settings, or the
user decide approval. Use `ns_checkAccountPermissions` to probe the configured account's effective
REST, SuiteQL, record metadata, and optional RESTlet access.

# Deployment

NetSuite SuperMCP is a Bun HTTP MCP server.

## Build

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run check:restlet-contract
bun run smoke
```

## Run Locally

```bash
bun run dev
```

The local MCP endpoint listens on:

```text
http://127.0.0.1:3025/mcp
```

## OAuth-Protected Public URL

For Claude custom connectors or another OAuth-capable remote MCP client:

```bash
netsuite-supermcp public-url
```

This starts ngrok and then launches SuperMCP in `MCP_AUTH_MODE=oauth`. It prints the public `/mcp`
URL and the NetSuite callback URL. Add the callback URL to the Integration record, then enter only
the `/mcp` URL in Claude; leave Claude's optional Client ID and Client Secret fields blank so DCR
is used. Stop the terminal to close both the local server and ngrok. Use `NGROK_DOMAIN` or
`--domain` for a stable callback URL.

## NetSuite RESTlet Deployment

Browser OAuth, REST metadata, and SuiteQL work after the Integration record and `.env` are
configured. RESTlet-backed tools also require the bundled SuiteScript files to be deployed in
NetSuite:

- `netsuite/suitescript/supermcp_action_restlet.js`
- `netsuite/suitescript/supermcp_customization_actions.js`
- `netsuite/suitescript/supermcp_file_actions.js`
- `netsuite/suitescript/supermcp_diagnostic_actions.js`
- `netsuite/suitescript/supermcp_record_explorer_actions.js`
- `netsuite/suitescript/supermcp_script_observability_actions.js`
- `netsuite/suitescript/supermcp_inventory_actions.js`
- `netsuite/suitescript/supermcp_operation_actions.js`
- `netsuite/suitescript/supermcp_platform_actions.js`
- `netsuite/suitescript/supermcp_report_actions.js`
- `netsuite/suitescript/supermcp_read_actions.js`
- `netsuite/suitescript/supermcp_transform_actions.js`
- `netsuite/suitescript/supermcp_integration_actions.js`
- `netsuite/suitescript/supermcp_mapping_actions.js`

Create a RESTlet script record for `supermcp_action_restlet.js` and a deployment for the OAuth
role that will run SuperMCP. If you keep the default `.env` URL, use these IDs:

- Script ID: `customscript_supermcp_action`
- Deployment ID: `customdeploy_supermcp_action`

Then verify without changing NetSuite business data:

```bash
netsuite-supermcp doctor
```

From any connected MCP client, also run `ns_getSuperMcpVersion`. It should show the same installed
package version and RESTlet version, `restlet.reachable: true`, the expected NetSuite account ID,
and `toolCount: 185`. If npm, the running MCP process, and the deployed RESTlet disagree, restart
the MCP process first and redeploy the RESTlet if `restlet.version` is old.

If you use SuiteCloud CLI instead of the NetSuite UI, Oracle's current CLI package is
`@oracle/suitecloud-cli`; it requires JDK 17 or 21.
The `netsuite-supermcp suitecloud` command prints a Java preflight warning before deploy steps.

Generate a ready-to-deploy Account Customization Project:

```bash
netsuite-supermcp suitecloud
cd .netsuite-supermcp-suitecloud
npx -y @oracle/suitecloud-cli@3.2.0 account:setup -i
npx -y @oracle/suitecloud-cli@3.2.0 project:deploy --validate
```

If an auth ID already exists, SuperMCP can select it without the SuiteCloud interactive picker:

```bash
netsuite-supermcp suitecloud --deploy --auth-id supermcp-11675047
```

## Run As A Service

Use the deployment platform's process manager, systemd, PM2, or a managed Node/Bun service runner
to execute:

```bash
bun run start
```

Set `MCP_HOST=0.0.0.0` only when the process must accept traffic from outside localhost through a
trusted reverse proxy or private network.

## Required Runtime Secrets

Set these through the deployment platform secret manager:

- `MCP_BEARER_TOKEN` for `MCP_AUTH_MODE=bearer`
- `MCP_PUBLIC_URL` and `MCP_OAUTH_SECRET` for `MCP_AUTH_MODE=oauth`
- `NETSUITE_CONSUMER_KEY`
- `NETSUITE_CERTIFICATE_ID`
- `NETSUITE_PRIVATE_KEY_PEM_BASE64`

NetSuite environment and endpoint values:

- `NETSUITE_ACCOUNT_ID`
- `NETSUITE_ENVIRONMENT`
- `NETSUITE_BASE_URL`
- `NETSUITE_RESTLET_URL`
- `NETSUITE_TOKEN_URL`
- `NETSUITE_OAUTH_FLOW`
- `NETSUITE_REFRESH_TOKEN` when using local browser authorization-code OAuth. It is not required at
  process startup in remote MCP OAuth mode; each user authorizes in-browser.

Operational values:

- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION_OVERRIDE` only when you intentionally need to override package-derived
  version metadata.
- `MCP_HOST`
- `MCP_PORT`
- `MCP_AUTH_MODE` (`oauth`, `bearer`, or loopback-only `none`)
- `MCP_OAUTH_STORE_PATH` for DCR registrations and encrypted per-user NetSuite sessions
- `AUDIT_LOG_PATH`
- `JOB_STORE_PATH`
- `EXPORT_DIRECTORY`
- `INTEGRATION_STORE_PATH`
- `CUSTOMIZATION_STORE_PATH`
- `SEMANTIC_STORE_PATH`
- `RUNBOOK_STORE_PATH`
- `COMPOSITE_STORE_PATH`
- `HARNESS_BUDGET_STORE_PATH`
- `MCP_HARNESS_CONTEXT_SECRET` (optional; enables signed harness scopes)
- `RUNBOOK_LOW_RISK_REPAIR_CLASSES` only for explicitly provider-approved local repair classes.
- `CUSTOMIZATION_PROJECT_DIRECTORY`
- `MCP_CURSOR_SECRET` only when cursor signing must be independent from the existing MCP/OAuth
  secret. Otherwise it is derived automatically.

## Production Defaults

- Unsigned production requests use the bounded `preview` harness profile. Reads and prepare-only
  plans remain available; commit and OAuth revocation require a signed `operations` context.
- Map the OAuth client credentials to the exact NetSuite account and role you want SuperMCP to use.
- Run `ns_checkAccountPermissions` after changing OAuth mapping, role permissions, or RESTlet
  deployments.
- Store `AUDIT_LOG_PATH` on persistent storage or send audit output through your platform log
  collector. Audit rows contain metadata/fingerprints rather than full request, record, file, or
  source payloads; legacy full-body rows are compacted when accessed.
- Store `JOB_STORE_PATH`, `EXPORT_DIRECTORY`, `INTEGRATION_STORE_PATH`,
  `CUSTOMIZATION_STORE_PATH`, `SEMANTIC_STORE_PATH`, `RUNBOOK_STORE_PATH`,
  `COMPOSITE_STORE_PATH`, and `HARNESS_BUDGET_STORE_PATH` on persistent storage
  so resumable exports, versioned contracts and metrics, canaries, runbooks, evidence claims, and
  outbox delivery state survive restarts.
  Keep customization deployment state and generated checksum-pinned projects on the same class of
  persistent storage.
- Terminate TLS at a reverse proxy or managed ingress. Do not expose the MCP endpoint over plain
  HTTP outside a private network.
- Persist `MCP_OAUTH_STORE_PATH`, protect `MCP_OAUTH_SECRET` in a secret manager, and keep the
  public URL stable. Losing the secret intentionally invalidates stored NetSuite sessions.
- Use separate deployments and secret sets for sandbox and production.
- Keep generated `.netsuite-supermcp-suitecloud*` folders out of source control; they are deploy
  artifacts and can be regenerated with `netsuite-supermcp suitecloud`.

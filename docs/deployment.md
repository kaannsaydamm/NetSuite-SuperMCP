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

- `MCP_BEARER_TOKEN`
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
- `NETSUITE_REFRESH_TOKEN` when using browser authorization-code OAuth.

Operational values:

- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `MCP_HOST`
- `MCP_PORT`
- `AUDIT_LOG_PATH`

## Production Defaults

- Map the OAuth client credentials to the exact NetSuite account and role you want SuperMCP to use.
- Run `ns_checkAccountPermissions` after changing OAuth mapping, role permissions, or RESTlet
  deployments.
- Store `AUDIT_LOG_PATH` on persistent storage or send audit output through your platform log
  collector.
- Terminate TLS at a reverse proxy or managed ingress. Do not expose the MCP endpoint over plain
  HTTP outside a private network.
- Use separate deployments and secret sets for sandbox and production.

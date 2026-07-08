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
- Read, write, action, audit, capability, and account-permission tools.

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
netsuite-supermcp setup
netsuite-supermcp doctor
netsuite-supermcp suitecloud
netsuite-supermcp-oauth2
netsuite-supermcp-oauth-login
netsuite-supermcp-install --list
netsuite-supermcp-stdio
```

Run directly with npm/npx:

```bash
npx netsuite-supermcp oauth2
npx netsuite-supermcp setup
npx netsuite-supermcp doctor
npx netsuite-supermcp suitecloud
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

Deployment details are in [docs/deployment.md](docs/deployment.md).
Agent client setup details are in [docs/client-setup.md](docs/client-setup.md).

## NetSuite Identity Model

Execution uses the NetSuite OAuth mapping from `.env`. For user-delegated access, run
`netsuite-supermcp oauth2`; it configures `.env`, opens NetSuite in the browser, captures the
authorization callback, exchanges the code for a refresh token, and saves it to `.env`.
`netsuite-supermcp-oauth-login` is still available when `.env` is already configured. For
machine-to-machine access, set `NETSUITE_OAUTH_FLOW=client_credentials` and provide the certificate
values.

SuperMCP does not impose a specific employee, role, or naming convention. It also does not bypass
NetSuite authorization; NetSuite allows or denies actions based on the mapped account's permissions.

## Tool Safety

Tools return risk metadata and write audit events. Client applications, harness settings, or the
user decide approval. Use `ns_checkAccountPermissions` to probe the configured account's effective
REST, SuiteQL, record metadata, and optional RESTlet access.

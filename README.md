# NetSuite SuperMCP

NetSuite SuperMCP is a single MCP endpoint for AI clients to operate NetSuite through the
NetSuite OAuth account and role you configure.

The first slice includes:

- Streamable HTTP MCP endpoint.
- Bearer-token protection for MCP clients.
- Strict Zod config parsing.
- Tool risk metadata and audit logging.
- File-backed audit log.
- NetSuite REST/RESTlet adapter boundaries.
- MVP read/write/action tool catalog.

## Local Setup

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
bun run smoke
```

`bun run smoke` starts the server with sandbox-shaped local config, verifies `/health`,
unauthorized MCP rejection, MCP initialize, and `ns_getEnvironment`, then shuts the server down.

Deployment details are in [docs/deployment.md](docs/deployment.md).
Agent client setup details are in [docs/client-setup.md](docs/client-setup.md).

## NetSuite Identity Model

Execution uses the NetSuite OAuth 2.0 Client Credentials / M2M mapping from `.env`.
Whoever you map in NetSuite is the account and role that performs the work.

SuperMCP does not impose a specific employee, role, or naming convention. It also does not bypass
NetSuite authorization; NetSuite allows or denies actions based on the mapped account's permissions.

## Tool Safety

Tools return risk metadata and write audit events. Client applications, harness settings, or the
user decide approval. Use `ns_checkAccountPermissions` to probe the configured account's effective
REST, SuiteQL, record metadata, and optional RESTlet access.

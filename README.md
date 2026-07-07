# NetSuite SuperMCP

NetSuite SuperMCP is a single MCP endpoint for AI clients to operate NetSuite through a
dedicated integration identity. It does not use the human user's NetSuite role for execution.

The first slice includes:

- Streamable HTTP MCP endpoint.
- Bearer-token protection for MCP clients.
- Strict Zod config parsing.
- Tool risk policy and production write guard.
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

Execution must use:

- `VSP MCP Integration User`
- `VSP MCP Super Integration Role`
- OAuth 2.0 Client Credentials / M2M mapping

This centralizes permission in a custom integration role. It does not bypass NetSuite role or
permission checks.

## Tool Safety

Low-risk tools are read-only. Medium, high, and critical tools return risk metadata and write an
audit event. Production writes are blocked unless `PRODUCTION_WRITES_ENABLED=true`.

# MCP Client Setup

NetSuite SuperMCP supports two local surfaces:

- Streamable HTTP: `bun run start`, endpoint `http://127.0.0.1:3025/mcp`.
- Stdio: `bun run stdio`, used by local agent clients that launch MCP servers as commands.

## Installer

Windows setup wrapper:

```powershell
.\setup.ps1 -AllDetected
.\setup.ps1 -AllKnown
.\setup.ps1 -Target codex
.\setup.ps1 -List
```

`setup.cmd` runs the same PowerShell wrapper for double-click or `cmd.exe` use.

macOS/Linux setup wrapper:

```bash
sh ./setup.sh --all-detected
sh ./setup.sh --all-known
sh ./setup.sh --target codex
sh ./setup.sh --list
```

List detected clients:

```bash
bun run install:clients --list
```

Install into every detected client:

```bash
bun run install:clients --all-detected
```

Install into every known target:

```bash
bun run install:clients --all-known
```

Install one target:

```bash
bun run install:clients --target=codex
bun run install:clients --target=claude-desktop
bun run install:clients --target=cursor
```

Supported targets:

- Codex CLI / Codex desktop app: `~/.codex/config.toml`
- Claude Code: project `.mcp.json`
- Claude Desktop: `%APPDATA%/Claude/claude_desktop_config.json`
- Gemini CLI: `~/.gemini/settings.json`
- Gemini Antigravity: `~/.gemini/antigravity-cli/settings.json`
- Cursor: `~/.cursor/mcp.json`
- Windsurf / Cascade: `~/.codeium/windsurf/mcp_config.json`
- VS Code workspace MCP: `.vscode/mcp.json`
- OpenCode: `~/.config/opencode/mcp.json`
- Hermes Agent: `~/.config/hermes-agent/mcp.json`
- OpenClaw: `~/.config/openclaw/mcp.json`
- Zed / Zcode snippet: `generated/zed-mcp.json`

The installer writes only MCP server registration. It does not set per-tool auto-approval or
permission toggles. Approval remains owned by the client application, harness, or user settings.

## NetSuite OAuth

Fill `.env` with the NetSuite OAuth 2.0 client credentials / M2M values:

```text
NETSUITE_ACCOUNT_ID=...
NETSUITE_ENVIRONMENT=sandbox
NETSUITE_BASE_URL=...
NETSUITE_RESTLET_URL=...
NETSUITE_CONSUMER_KEY=...
NETSUITE_CERTIFICATE_ID=...
NETSUITE_PRIVATE_KEY_PEM_BASE64=...
NETSUITE_TOKEN_URL=...
```

This uses whichever NetSuite entity and role you map in OAuth Client Credentials. SuperMCP does
not require a specific integration user or role name.

## HTTP Clients

HTTP clients must send:

```text
Authorization: Bearer <MCP_BEARER_TOKEN>
```

Optional audit identity headers:

```text
X-SuperMCP-User: kaan
X-SuperMCP-Client: claude
```

## Permissions And Approval

Client-side tool approval remains the UX for mutating tools. SuperMCP writes MCP server
registration only; it does not write client permission toggles or approval settings.

Server-side checks still reject:

- Invalid or unauthenticated MCP requests.
- Invalid tool inputs.

Use `ns_listCapabilities` to inspect each tool's risk level and whether it mutates NetSuite. Use
`ns_checkAccountPermissions` to probe the configured NetSuite account's effective REST, SuiteQL,
record metadata, and optional RESTlet access.

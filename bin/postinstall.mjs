#!/usr/bin/env node

if (process.env["NETSUITE_SUPERMCP_QUIET_POSTINSTALL"] === "1") {
  process.exit(0)
}

console.log("")
console.log("NetSuite SuperMCP installed.")
console.log("Fast path: run `netsuite-supermcp oauth2` for browser OAuth login.")
console.log("Full setup: run `netsuite-supermcp setup` for OAuth plus agent-client install.")
console.log("")

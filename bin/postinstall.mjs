#!/usr/bin/env node

if (process.env["NETSUITE_SUPERMCP_QUIET_POSTINSTALL"] === "1") {
  process.exit(0)
}

console.log("")
console.log("NetSuite SuperMCP installed.")
console.log("Next: run `netsuite-supermcp setup` for guided OAuth and agent-client setup.")
console.log("")

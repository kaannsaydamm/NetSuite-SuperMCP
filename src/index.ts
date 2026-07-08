import { createApp } from "./app"
import { parseConfig } from "./config"
import { formatConfigError } from "./config-help"

const parsedConfig = parseConfig(process.env)

if (!parsedConfig.ok) {
  console.error(formatConfigError(parsedConfig.error))
  process.exit(1)
}

const app = createApp(parsedConfig.value)

Bun.serve({
  hostname: parsedConfig.value.host,
  port: parsedConfig.value.port,
  fetch: app.fetch,
})

console.log(
  `${parsedConfig.value.serverName} listening on http://${parsedConfig.value.host}:${parsedConfig.value.port}`,
)
if (parsedConfig.value.authMode === "none") {
  console.warn("MCP auth disabled for loopback tunnel mode. Do not expose this port directly.")
}

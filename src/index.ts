import { createApp } from "./app"
import { parseConfig } from "./config"

const parsedConfig = parseConfig(process.env)

if (!parsedConfig.ok) {
  console.error(parsedConfig.error.message)
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

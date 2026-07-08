import type { ConfigError } from "./shared/errors"

export function formatConfigError(error: ConfigError): string {
  return [
    error.message,
    "",
    "Run guided setup:",
    "  netsuite-supermcp setup",
    "",
    "Minimum required NetSuite values:",
    "  Account ID, OAuth Client ID, OAuth Client Secret",
    "",
    "NetSuite integration setup:",
    "  Setup > Integration > Manage Integrations > New",
    "  Redirect URI: https://127.0.0.1:3026/oauth/callback",
  ].join("\n")
}

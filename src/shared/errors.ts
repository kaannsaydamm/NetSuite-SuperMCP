export class ConfigError extends Error {
  readonly name = "ConfigError"

  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`)
  }
}

export class PolicyError extends Error {
  readonly name = "PolicyError"

  constructor(readonly reason: string) {
    super(reason)
  }
}

export class NetSuiteNotConfiguredError extends Error {
  readonly name = "NetSuiteNotConfiguredError"

  constructor(readonly missing: readonly string[]) {
    super(`NetSuite credentials are not configured: ${missing.join(", ")}`)
  }
}

export class NetSuiteRequestError extends Error {
  readonly name = "NetSuiteRequestError"

  constructor(
    readonly statusCode: number,
    readonly responseBody: string,
  ) {
    super(`NetSuite request failed with HTTP ${statusCode}`)
  }
}

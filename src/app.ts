import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Hono } from "hono"
import pino from "pino"
import { AuditLog } from "./audit"
import { identityFromHeaders, isAuthorized } from "./auth"
import { CompositeStore } from "./composites/composite-store"
import type { AppConfig } from "./config"
import { CustomizationStore } from "./customizations/customization-store"
import { IntegrationStore } from "./integrations/integration-store"
import { ExportStore } from "./jobs/export-store"
import { JobStore } from "./jobs/job-store"
import type { NetSuiteClient } from "./netsuite/client"
import { OAuthNetSuiteClient } from "./netsuite/client"
import type { OAuthControl } from "./netsuite/oauth"
import { NetSuiteTokenProvider } from "./netsuite/oauth"
import { mountMcpOAuthRoutes } from "./oauth/mcp-oauth-routes"
import { McpOAuthService, type VerifiedMcpAccess } from "./oauth/mcp-oauth-service"
import { NetSuiteAuthorizationCodeExchange } from "./oauth/netsuite-authorization-exchange"
import { OperationStore } from "./operations/operation-store"
import { CursorCodec } from "./query/suiteql"
import { RunbookStore } from "./runbooks/runbook-store"
import { SemanticStore } from "./semantics/semantic-store"
import { type ToolName, toolPolicies } from "./tools/catalog"
import { registerTools } from "./tools/registry"

export type AppDependencies = {
  readonly netsuite?: NetSuiteClient
  readonly auditLog?: AuditLog
  readonly operationStore?: OperationStore
  readonly managementNetsuite?: NetSuiteClient
  readonly oauthControl?: OAuthControl
  readonly managementOauthControl?: OAuthControl
  readonly jobStore?: JobStore
  readonly exportStore?: ExportStore
  readonly cursorCodec?: CursorCodec
  readonly integrationStore?: IntegrationStore
  readonly customizationStore?: CustomizationStore
  readonly semanticStore?: SemanticStore
  readonly runbookStore?: RunbookStore
  readonly compositeStore?: CompositeStore
  readonly mcpOAuthService?: McpOAuthService
}

export function createApp(config: AppConfig, dependencies: AppDependencies = {}): Hono {
  const app = new Hono()
  const logger = pino({ name: "netsuite-supermcp" })
  const auditLog = dependencies.auditLog ?? new AuditLog(config.auditLogPath)
  const tokenProvider = new NetSuiteTokenProvider(config.netsuite)
  const netsuite =
    dependencies.netsuite ??
    new OAuthNetSuiteClient(config.netsuite, () => tokenProvider.getAccessToken())
  const operationStore = dependencies.operationStore ?? new OperationStore()
  const jobStore = dependencies.jobStore ?? new JobStore(config.jobStorePath)
  const exportStore = dependencies.exportStore ?? new ExportStore(config.exportDirectory)
  const cursorCodec = dependencies.cursorCodec ?? new CursorCodec(Buffer.from(config.cursorSecret))
  const integrationStore =
    dependencies.integrationStore ?? new IntegrationStore(config.integrationStorePath)
  const customizationStore =
    dependencies.customizationStore ?? new CustomizationStore(config.customizationStorePath)
  const semanticStore = dependencies.semanticStore ?? new SemanticStore(config.semanticStorePath)
  const runbookStore = dependencies.runbookStore ?? new RunbookStore(config.runbookStorePath)
  const compositeStore =
    dependencies.compositeStore ?? new CompositeStore(config.compositeStorePath)
  const managementTokenProvider =
    config.managementNetsuite === undefined
      ? undefined
      : new NetSuiteTokenProvider(config.managementNetsuite)
  const managementNetsuite =
    dependencies.managementNetsuite ??
    (config.managementNetsuite === undefined || managementTokenProvider === undefined
      ? undefined
      : new OAuthNetSuiteClient(config.managementNetsuite, () =>
          managementTokenProvider.getAccessToken(),
        ))
  const managementOauthControl = dependencies.managementOauthControl ?? managementTokenProvider
  const mcpOAuthService =
    dependencies.mcpOAuthService ??
    (config.authMode === "oauth"
      ? new McpOAuthService({
          publicUrl: requiredOAuthConfig(config.publicUrl, "MCP_PUBLIC_URL"),
          storePath: config.oauthStorePath,
          encryptionSecret: requiredOAuthConfig(config.oauthSecret, "MCP_OAUTH_SECRET"),
          accountId: config.netsuite.accountId,
          upstream: new NetSuiteAuthorizationCodeExchange(config.netsuite),
        })
      : undefined)
  const oauthTokenProviders = new Map<string, NetSuiteTokenProvider>()

  if (mcpOAuthService !== undefined) mountMcpOAuthRoutes(app, mcpOAuthService)

  app.get("/health", (context) =>
    context.json({
      ok: true,
      name: config.serverName,
      version: config.serverVersion,
      environment: config.netsuite.environment,
    }),
  )

  app.all("/mcp", async (context) => {
    if (
      config.authMode === "bearer" &&
      !isAuthorized(context.req.header("authorization") ?? null, config.bearerToken ?? "")
    ) {
      return context.json({ error: "unauthorized" }, 401)
    }

    let identity = identityFromHeaders(context.req.raw.headers)
    let requestNetsuite = netsuite
    let requestOauthControl = dependencies.oauthControl ?? tokenProvider
    let verifiedOAuth: VerifiedMcpAccess | undefined
    if (config.authMode === "oauth") {
      if (mcpOAuthService === undefined) throw new Error("MCP OAuth service is unavailable")
      const bearerToken = bearerTokenFromHeader(context.req.header("authorization"))
      if (bearerToken === undefined) {
        return oauthChallenge(mcpOAuthService.publicUrl)
      }
      try {
        verifiedOAuth = await mcpOAuthService.verifyAccessToken(bearerToken)
      } catch {
        return oauthChallenge(mcpOAuthService.publicUrl, "invalid_token")
      }
      identity = { requester: verifiedOAuth.subject, client: verifiedOAuth.clientId }
      if (dependencies.netsuite === undefined) {
        let requestTokenProvider = oauthTokenProviders.get(verifiedOAuth.sessionId)
        if (requestTokenProvider === undefined) {
          const sessionId = verifiedOAuth.sessionId
          requestTokenProvider = new NetSuiteTokenProvider(
            {
              ...config.netsuite,
              oauthFlow: "authorization_code",
              refreshToken: verifiedOAuth.netSuiteRefreshToken,
            },
            async (refreshToken) => {
              await mcpOAuthService.updateNetSuiteRefreshToken(sessionId, refreshToken)
            },
          )
          oauthTokenProviders.set(sessionId, requestTokenProvider)
        }
        requestNetsuite = new OAuthNetSuiteClient(config.netsuite, () =>
          requestTokenProvider.getAccessToken(),
        )
        requestOauthControl = requestTokenProvider
      }
    }
    const allowedToolNames = new Set(Object.keys(toolPolicies) as ToolName[])
    const server = new McpServer(
      { name: config.serverName, version: config.serverVersion },
      {
        instructions:
          "NetSuite SuperMCP exposes NetSuite read, write, transform, integration, and account permission check tools through the configured NetSuite OAuth account. Client applications own tool approval.",
      },
    )

    registerTools(server, {
      config,
      auditLog,
      netsuite: requestNetsuite,
      ...(managementNetsuite === undefined ? {} : { managementNetsuite }),
      oauthControl: requestOauthControl,
      ...(managementOauthControl === undefined ? {} : { managementOauthControl }),
      operationStore,
      jobStore,
      exportStore,
      cursorCodec,
      integrationStore,
      customizationStore,
      semanticStore,
      runbookStore,
      compositeStore,
      allowedToolNames,
      requester: identity.requester,
      client: identity.client,
    })

    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    })

    try {
      await server.connect(transport)
      return await transport.handleRequest(context.req.raw)
    } catch (error) {
      logger.error({ error }, "mcp request failed")
      return context.json({ error: "mcp request failed" }, 500)
    } finally {
      await server.close()
      await transport.close()
    }
  })

  return app
}

function bearerTokenFromHeader(authorization: string | undefined): string | undefined {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return undefined
  const token = authorization.slice("Bearer ".length)
  return token.length > 0 ? token : undefined
}

function oauthChallenge(publicUrl: string, error?: string): Response {
  const metadata = `${publicUrl.replace(/\/+$/, "")}/.well-known/oauth-protected-resource/mcp`
  const errorParameter = error === undefined ? "" : `, error="${error}"`
  return new Response(JSON.stringify({ error: error ?? "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${metadata}"${errorParameter}`,
    },
  })
}

function requiredOAuthConfig(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required for MCP OAuth`)
  return value
}

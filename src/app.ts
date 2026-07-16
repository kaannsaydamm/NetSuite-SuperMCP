import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Hono } from "hono"
import pino from "pino"
import { AuditLog } from "./audit"
import { identityFromHeaders, isAuthorized } from "./auth"
import type { AppConfig } from "./config"
import { CustomizationStore } from "./customizations/customization-store"
import { IntegrationStore } from "./integrations/integration-store"
import { ExportStore } from "./jobs/export-store"
import { JobStore } from "./jobs/job-store"
import type { NetSuiteClient } from "./netsuite/client"
import { OAuthNetSuiteClient } from "./netsuite/client"
import type { OAuthControl } from "./netsuite/oauth"
import { NetSuiteTokenProvider } from "./netsuite/oauth"
import { OperationStore } from "./operations/operation-store"
import { CursorCodec } from "./query/suiteql"
import { SemanticStore } from "./semantics/semantic-store"
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

    const identity = identityFromHeaders(context.req.raw.headers)
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
      netsuite,
      ...(managementNetsuite === undefined ? {} : { managementNetsuite }),
      oauthControl: dependencies.oauthControl ?? tokenProvider,
      ...(managementOauthControl === undefined ? {} : { managementOauthControl }),
      operationStore,
      jobStore,
      exportStore,
      cursorCodec,
      integrationStore,
      customizationStore,
      semanticStore,
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

import { z } from "zod"
import type { createApp } from "../src/app"

export const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  },
} as const

export const ToolTextResponseSchema = z.object({
  result: z.object({
    content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const CapabilitiesPayloadSchema = z
  .object({
    requestId: z.string().uuid(),
    tools: z.array(
      z.object({
        name: z.string(),
        risk: z.string(),
        mutatesNetSuite: z.boolean(),
        effects: z.array(z.string()),
        requiredPermissions: z.array(z.string()),
        phaseSupport: z.array(z.enum(["prepare", "preview", "commit"])),
      }),
    ),
  })
  .loose()

export async function mcpCall(
  app: ReturnType<typeof createApp>,
  payload: object,
  identity: { readonly client: string; readonly requester: string } = {
    requester: "test-user",
    client: "bun-test",
  },
): Promise<Response> {
  return await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token-12345",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-supermcp-user": identity.requester,
      "x-supermcp-client": identity.client,
    },
    body: JSON.stringify(payload),
  })
}

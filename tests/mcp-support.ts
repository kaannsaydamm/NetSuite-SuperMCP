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
  }),
})

export const CapabilitiesPayloadSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      risk: z.string(),
      mutatesNetSuite: z.boolean(),
    }),
  ),
})

export async function mcpCall(
  app: ReturnType<typeof createApp>,
  payload: object,
): Promise<Response> {
  return await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token-12345",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-supermcp-user": "test-user",
      "x-supermcp-client": "bun-test",
    },
    body: JSON.stringify(payload),
  })
}

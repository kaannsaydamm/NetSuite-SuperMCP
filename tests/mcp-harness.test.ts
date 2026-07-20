import { describe, expect, it } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../src/app"
import { HarnessContextSchema } from "../src/contracts/harness-schemas"
import { encodeHarnessContext } from "../src/harness/context"
import { ToolName } from "../src/tools/catalog"
import { FakeNetSuiteClient, testConfig } from "./test-support"

describe("MCP harness controls", () => {
  it("uses a bounded preview profile by default for unsigned production requests", async () => {
    const app = createApp(
      testConfig({ netsuite: { ...testConfig().netsuite, environment: "production" } }),
      { netsuite: new FakeNetSuiteClient() },
    )
    const listed = await requestUnsigned(app, {
      jsonrpc: "2.0",
      id: 0,
      method: "tools/list",
      params: {},
    })
    const names = listed.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toContain(ToolName.GetRecord)
    expect(names).toContain(ToolName.CreateRecord)
    expect(names).not.toContain(ToolName.CommitAction)
  })
  it("filters the actual catalog and creates only schema-valid composites", async () => {
    const root = await mkdtemp(join(tmpdir(), "supermcp-harness-mcp-"))
    const secret = "harness-verification-secret"
    const config = testConfig({
      harnessContextSecret: secret,
      harnessBudgetStorePath: join(root, "budgets.json"),
      compositeStorePath: join(root, "composites.json"),
    })
    const signed = encodeHarnessContext(
      HarnessContextSchema.parse({
        version: 1,
        scopeId: "task:customer-read",
        provider: "test",
        subject: "user",
        profile: "read",
        allowedRecordTypes: ["customer"],
        budgets: { calls: 20 },
      }),
      secret,
    )
    const app = createApp(config, { netsuite: new FakeNetSuiteClient() })
    const listed = await request(app, signed, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    })
    const names = listed.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toContain(ToolName.GetRecord)
    expect(names).toContain(ToolName.CreateCompositeTool)
    expect(names).not.toContain(ToolName.CreateRecord)
    expect(names).not.toContain(ToolName.CommitAction)

    const created = await request(app, signed, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: ToolName.CreateCompositeTool,
        arguments: {
          id: "customer.read",
          version: "1.0",
          title: "Customer read",
          description: "Reads a selected customer.",
          inputs: [{ name: "customerId", type: "string", example: "123", sensitivity: "internal" }],
          steps: [
            {
              id: "read.customer",
              kind: "tool",
              toolName: ToolName.GetRecord,
              inputTemplate: { type: "customer", id: { $input: "customerId" } },
            },
          ],
        },
      },
    })
    expect(created.result.isError).not.toBe(true)
    expect(created.result.structuredContent.harness.profile).toBe("read")
  })
})

async function requestUnsigned(app: ReturnType<typeof createApp>, body: object) {
  const response = await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token-12345",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { result: { tools: { name: string }[] } }
}

async function request(
  app: ReturnType<typeof createApp>,
  signed: { encoded: string; signature: string },
  body: object,
) {
  const response = await app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token-12345",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-supermcp-context": signed.encoded,
      "x-supermcp-signature": signed.signature,
    },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as {
    result: {
      isError?: boolean
      tools: { name: string }[]
      structuredContent: Record<string, unknown> & {
        harness: { profile: string }
      }
    }
  }
}

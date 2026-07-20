import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AuditLog } from "../src/audit"
import { ToolRisk } from "../src/policy"

describe("AuditLog", () => {
  it("redacts secrets before writing audit events", async () => {
    // Given
    const dir = await mkdtemp(join(tmpdir(), "netsuite-supermcp-"))
    const path = join(dir, "audit.ndjson")
    const auditLog = new AuditLog(path)

    // When
    await auditLog.write({
      timestamp: new Date("2026-07-06T12:00:00.000Z").toISOString(),
      status: "succeeded",
      toolName: "ns_updateMapping",
      risk: ToolRisk.Medium,
      environment: "sandbox",
      requester: "kaan",
      client: "claude",
      requestId: "00000000-0000-4000-8000-000000000001",
      input: { token: "secret-token", mappingId: "123" },
      result: { privateKey: "secret-key", id: "456" },
    })

    // Then
    const content = await readFile(path, "utf8")
    expect(content).toContain("fingerprint")
    expect(content).not.toContain("mappingId")
    expect(content).not.toContain("secret-token")
    expect(content).not.toContain("secret-key")
  })

  it("stores only bounded audit metadata instead of request and response bodies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "netsuite-supermcp-"))
    const path = join(dir, "audit.ndjson")
    const auditLog = new AuditLog(path)

    await auditLog.write({
      timestamp: new Date("2026-07-06T12:00:00.000Z").toISOString(),
      status: "succeeded",
      toolName: "ns_getRecordWithSublists",
      risk: ToolRisk.Low,
      environment: "production",
      requester: "user-1",
      client: "chatgpt",
      requestId: "00000000-0000-4000-8000-000000000004",
      durationMs: 12,
      input: { type: "customer", id: "42" },
      result: {
        record: { id: "42", email: "person@example.com", address: "Example Street" },
        items: [{ id: "1" }],
      },
    })

    const content = await readFile(path, "utf8")
    const event = JSON.parse(content)
    expect(event).toMatchObject({
      toolName: "ns_getRecordWithSublists",
      recordType: "customer",
      recordId: "42",
      resultCount: 1,
      durationMs: 12,
    })
    expect(event.input).toBeUndefined()
    expect(event.result).toBeUndefined()
    expect(content).not.toContain("person@example.com")
    expect(content).not.toContain("Example Street")
  })

  it("reads recent audit events newest first when the log exists", async () => {
    // Given
    const dir = await mkdtemp(join(tmpdir(), "netsuite-supermcp-"))
    const path = join(dir, "audit.ndjson")
    const auditLog = new AuditLog(path)
    await auditLog.write({
      timestamp: new Date("2026-07-06T12:00:00.000Z").toISOString(),
      status: "succeeded",
      toolName: "ns_getEnvironment",
      risk: ToolRisk.Low,
      environment: "sandbox",
      requester: "kaan",
      client: "claude",
      requestId: "00000000-0000-4000-8000-000000000002",
      input: {},
      result: { sequence: 1 },
    })
    await auditLog.write({
      timestamp: new Date("2026-07-06T12:01:00.000Z").toISOString(),
      status: "blocked",
      toolName: "ns_billPurchaseOrder",
      risk: ToolRisk.High,
      environment: "production",
      requester: "kaan",
      client: "claude",
      requestId: "00000000-0000-4000-8000-000000000003",
      input: {},
      result: { sequence: 2 },
    })

    // When
    const events = await auditLog.readRecent(1)

    // Then
    expect(events).toHaveLength(1)
    expect(events[0]?.toolName).toBe("ns_billPurchaseOrder")
  })

  it("returns an empty audit list when the log does not exist", async () => {
    // Given
    const dir = await mkdtemp(join(tmpdir(), "netsuite-supermcp-"))
    const auditLog = new AuditLog(join(dir, "missing.ndjson"))

    // When
    const events = await auditLog.readRecent(20)

    // Then
    expect(events).toEqual([])
  })

  it("compacts legacy full-body audit rows before returning them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "netsuite-supermcp-"))
    const path = join(dir, "audit.ndjson")
    await writeFile(
      path,
      `${JSON.stringify({
        timestamp: "2026-07-06T12:00:00.000Z",
        status: "succeeded",
        toolName: "ns_getRecord",
        risk: "low",
        environment: "production",
        requester: "user",
        requestId: "00000000-0000-4000-8000-000000000005",
        client: "client",
        input: { type: "customer", id: "1" },
        result: { email: "legacy@example.com", address: "Legacy Street" },
      })}\n`,
    )
    const auditLog = new AuditLog(path)

    expect(await auditLog.readRecent(10)).toHaveLength(1)
    const compacted = await readFile(path, "utf8")
    expect(compacted).not.toContain("legacy@example.com")
    expect(compacted).not.toContain("Legacy Street")
  })
})

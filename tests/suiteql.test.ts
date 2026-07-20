import { describe, expect, it } from "bun:test"
import type { SuiteQlRequest } from "../src/netsuite/types"
import { analyzeSuiteQl, buildSuiteQl, CursorCodec, runSuiteQlPage } from "../src/query/suiteql"
import type { JsonObject } from "../src/shared/json"
import { FakeNetSuiteClient } from "./test-support"

class PagedClient extends FakeNetSuiteClient {
  readonly queries: SuiteQlRequest[] = []

  override async runSuiteQl(request: SuiteQlRequest): Promise<JsonObject> {
    this.queries.push(request)
    if (this.queries.length === 1) {
      return { items: [{ id: "1" }, { id: "2" }], hasMore: true }
    }
    return { items: [{ id: 3 }], hasMore: false }
  }
}

describe("safe SuiteQL", () => {
  it("tokenizes strings and comments without treating their contents as statements", () => {
    const analysis = analyzeSuiteQl("SELECT id, 'DELETE' AS note FROM customer -- UPDATE ignored")
    expect(analysis.valid).toBe(true)
    expect(analysis.statementType).toBe("select")
  })

  it("rejects mutation and multiple-statement input", () => {
    expect(analyzeSuiteQl("UPDATE customer SET entityid = 'x'").valid).toBe(false)
    expect(analyzeSuiteQl("SELECT id FROM customer; DELETE FROM customer").valid).toBe(false)
  })

  it("builds parameterized queries from validated identifiers", () => {
    const built = buildSuiteQl({
      table: "customer",
      fields: ["id", "entityid"],
      filters: [{ field: "isinactive", operator: "=", value: "F" }],
      joins: [],
    })
    expect(built.query).toBe("SELECT id, entityid FROM customer WHERE isinactive = ?")
    expect(built.params).toEqual(["F"])
    expect(built.analysis.valid).toBe(true)
  })

  it("uses a signed keyset cursor and rejects tampering", async () => {
    const client = new PagedClient()
    const codec = new CursorCodec(Buffer.from("stable-test-cursor-secret"))
    const first = await runSuiteQlPage(client, codec, {
      query: "SELECT id, entityid FROM customer",
      params: [],
      keyField: "id",
      keyIsUnique: true,
      pageSize: 2,
      rowBudget: 10,
    })
    expect(first.nextCursor).toBeString()
    const second = await runSuiteQlPage(client, codec, {
      query: "SELECT id, entityid FROM customer",
      params: [],
      keyField: "id",
      keyIsUnique: true,
      cursor: first.nextCursor as string,
      pageSize: 2,
      rowBudget: 10,
    })
    expect(second.items).toEqual([{ id: 3 }])
    expect(client.queries[1]?.query).toContain("supermcp_q.id > ?")
    expect(client.queries[1]?.params).toEqual([2])
    expect(() => codec.decode(`${first.nextCursor}x`)).toThrow("INVALID_CURSOR")
  })
})

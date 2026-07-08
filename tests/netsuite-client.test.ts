import { describe, expect, it } from "bun:test"
import { OAuthNetSuiteClient } from "../src/netsuite/client"
import { testConfig } from "./test-support"

type RequestSummary = {
  readonly origin: string
  readonly method: string
  readonly path: string
  readonly search: string
  readonly body: unknown
  readonly accept: string | null
  readonly authorization: string | null
  readonly prefer: string | null
}

describe("OAuthNetSuiteClient", () => {
  it("creates records with REST POST and returns the Location header", async () => {
    // When
    const { result } = await withMockNetSuite(
      (request) =>
        new Response(null, {
          status: 204,
          headers: { location: `${request.origin}${request.path}/987` },
        }),
      (client) => client.createRecord({ type: "customer", values: { companyName: "Acme" } }),
    )

    // Then
    expect(result).toEqual({
      status: 204,
      location: "https://netsuite.test/services/rest/record/v1/customer/987",
    })
  })

  it("updates records with REST PATCH and preserves the request body", async () => {
    // When
    const { result } = await withMockNetSuite(
      (request) =>
        Response.json(
          { method: request.method, path: request.path, body: request.body },
          { headers: { location: `${request.origin}${request.path}` } },
        ),
      (client) =>
        client.updateRecord({
          type: "customer",
          id: "123",
          values: { email: "buyer@example.com" },
        }),
    )

    // Then
    expect(result).toEqual({
      method: "PATCH",
      path: "/services/rest/record/v1/customer/123",
      body: { email: "buyer@example.com" },
    })
  })

  it("deletes records with REST DELETE and handles empty 204 responses", async () => {
    // When
    const { result, requests } = await withMockNetSuite(
      () => new Response(null, { status: 204 }),
      (client) =>
        client.deleteRecord({
          type: "customer",
          id: "123",
          confirmation: "delete:customer:123",
        }),
    )

    // Then
    expect(result).toEqual({ status: 204, location: null })
    expect(requests).toMatchObject([
      { method: "DELETE", path: "/services/rest/record/v1/customer/123" },
    ])
  })

  it("requests record metadata with the selected media type", async () => {
    // When
    const { result } = await withMockNetSuite(
      (request) => Response.json(request),
      (client) =>
        client.getRecordMetadata({
          type: "salesOrder",
          select: [],
          mediaType: "application/schema+json",
        }),
    )

    // Then
    expect(result).toMatchObject({
      path: "/services/rest/record/v1/metadata-catalog/salesOrder",
      search: "",
      accept: "application/schema+json",
      authorization: "Bearer test-access-token",
    })
  })

  it("requests selected metadata catalog entries with a select query", async () => {
    // When
    const { result } = await withMockNetSuite(
      (request) => Response.json(request),
      (client) =>
        client.getRecordMetadata({
          select: ["customer", "vendorBill"],
          mediaType: "application/json",
        }),
    )

    // Then
    expect(result).toMatchObject({
      path: "/services/rest/record/v1/metadata-catalog",
      search: "?select=customer%2CvendorBill",
    })
  })

  it("requests transaction lines through the configured subresource", async () => {
    // When
    const { result } = await withMockNetSuite(
      (request) => Response.json(request),
      (client) =>
        client.getTransactionLines({
          type: "salesOrder",
          id: "123",
          sublist: "item",
        }),
    )

    // Then
    expect(result).toMatchObject({
      path: "/services/rest/record/v1/salesOrder/123/item",
      search: "",
    })
  })

  it("adds SuiteQL limit and offset as query parameters", async () => {
    // When
    const { result } = await withMockNetSuite(
      (request) => Response.json(request),
      (client) =>
        client.runSuiteQl({
          query: "select id from transaction",
          params: [],
          limit: 100,
          offset: 200,
        }),
    )

    // Then
    expect(result).toMatchObject({
      path: "/services/rest/query/v1/suiteql",
      search: "?limit=100&offset=200",
      body: { q: "select id from transaction" },
      prefer: "transient",
    })
  })

  it("sends SuiteQL params only when present", async () => {
    // When
    const { result } = await withMockNetSuite(
      (request) => Response.json(request),
      (client) =>
        client.runSuiteQl({
          query: "select id from transaction where id = ?",
          params: [123],
        }),
    )

    // Then
    expect(result).toMatchObject({
      path: "/services/rest/query/v1/suiteql",
      body: { q: "select id from transaction where id = ?", params: [123] },
    })
  })
})

async function withMockNetSuite(
  responseFor: (request: RequestSummary) => Response | Promise<Response>,
  run: (client: OAuthNetSuiteClient) => Promise<unknown>,
): Promise<{ readonly result: unknown; readonly requests: readonly RequestSummary[] }> {
  const originalFetch = globalThis.fetch
  const requests: RequestSummary[] = []
  const mockFetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request =
        input instanceof Request ? new Request(input, init) : new Request(input.toString(), init)
      const summary = await requestSummary(request)
      requests.push(summary)
      return await responseFor(summary)
    },
    { preconnect: originalFetch.preconnect },
  )

  globalThis.fetch = mockFetch
  try {
    const result = await run(clientForBaseUrl("https://netsuite.test"))
    return { result, requests }
  } finally {
    globalThis.fetch = originalFetch
  }
}

function clientForBaseUrl(baseUrl: string): OAuthNetSuiteClient {
  return new OAuthNetSuiteClient(
    {
      ...testConfig().netsuite,
      baseUrl,
    },
    async () => "test-access-token",
  )
}

async function requestSummary(request: Request): Promise<RequestSummary> {
  const url = new URL(request.url)
  const body = await requestBody(request)
  return {
    origin: url.origin,
    method: request.method,
    path: url.pathname,
    search: url.search,
    body,
    accept: request.headers.get("accept"),
    authorization: request.headers.get("authorization"),
    prefer: request.headers.get("prefer"),
  }
}

async function requestBody(request: Request): Promise<unknown> {
  const text = await request.text()
  return text.length === 0 ? null : JSON.parse(text)
}

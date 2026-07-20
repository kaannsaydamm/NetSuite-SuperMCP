import { describe, expect, it } from "bun:test"
import { toErrorEnvelope } from "../src/shared/error-envelope"
import { NetSuiteRequestError } from "../src/shared/errors"

describe("NetSuite error envelopes", () => {
  it("preserves actionable NetSuite error details while redacting credentials", () => {
    const envelope = toErrorEnvelope(
      new NetSuiteRequestError(
        400,
        JSON.stringify({
          "o:errorDetails": [
            {
              "o:errorCode": "INVALID_RCRD_TYPE",
              detail: "Unsupported record type; token=private-value",
            },
          ],
        }),
      ),
      "123e4567-e89b-42d3-a456-426614174000",
    )

    expect(envelope.error).toMatchObject({
      netsuiteCode: "INVALID_RCRD_TYPE",
      netsuiteMessage: "Unsupported record type; token=[REDACTED]",
    })
    expect(JSON.stringify(envelope)).not.toContain("private-value")
  })
})

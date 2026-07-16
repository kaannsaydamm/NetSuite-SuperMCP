import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeEnvKeys } from "../scripts/env-file"
import { classifyAuthenticationError } from "../src/diagnostics/identity-diagnostics"

describe("identity diagnostics", () => {
  it("classifies authentication failures without returning credential values", () => {
    expect(classifyAuthenticationError(new Error("refresh token revoked abc-secret"))).toEqual({
      classification: "revoked_refresh_token",
      detail: "The refresh token was revoked.",
    })
    expect(classifyAuthenticationError(new Error("invalid_grant expired"))).toMatchObject({
      classification: "expired_authorization",
    })
    expect(classifyAuthenticationError(new Error("HTTP 403 forbidden"))).toMatchObject({
      classification: "role_restriction",
    })
  })

  it("removes refresh tokens while preserving unrelated env lines and comments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "supermcp-auth-"))
    const path = join(directory, ".env")
    await writeFile(
      path,
      "# NetSuite\nNETSUITE_ACCOUNT_ID=123\nNETSUITE_REFRESH_TOKEN=secret\nMCP_PORT=3025\n",
    )

    await removeEnvKeys(path, ["NETSUITE_REFRESH_TOKEN"])

    expect(await readFile(path, "utf8")).toBe(
      "# NetSuite\nNETSUITE_ACCOUNT_ID=123\nMCP_PORT=3025\n",
    )
  })
})

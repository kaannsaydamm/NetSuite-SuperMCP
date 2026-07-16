import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"
import { replaceTomlServer } from "../scripts/client-installer/config"
import { mergeInstallerEnv } from "../scripts/client-installer/targets"

describe("client installer configuration", () => {
  it("replaces a Codex server block together with its environment table", () => {
    // Given
    const current = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.netsuite-supermcp]",
      'command = "bun"',
      "",
      "[mcp_servers.netsuite-supermcp.env]",
      'NETSUITE_ACCOUNT_ID = "placeholder"',
      "",
      "[mcp_servers.netsuite-supermcp.headers]",
      'Authorization = "stale"',
      "",
      "[mcp_servers.other]",
      'command = "other"',
      "# [mcp_servers.netsuite-supermcp.headers]",
      'SHOULD_STAY = "yes"',
    ].join("\n")
    const replacement = [
      "",
      "[mcp_servers.netsuite-supermcp]",
      'command = "bun"',
      "",
      "[mcp_servers.netsuite-supermcp.env]",
      'NETSUITE_ACCOUNT_ID = "11675047"',
      "",
    ].join("\n")

    // When
    const result = replaceTomlServer(current, replacement)

    // Then
    expect(result).toContain('NETSUITE_ACCOUNT_ID = "11675047"')
    expect(result).not.toContain('NETSUITE_ACCOUNT_ID = "placeholder"')
    expect(result).not.toContain('Authorization = "stale"')
    expect(result).toContain('SHOULD_STAY = "yes"')
    expect(result.match(/\[mcp_servers\.netsuite-supermcp\]/g)).toHaveLength(1)
    expect(result.match(/\[mcp_servers\.netsuite-supermcp\.env\]/g)).toHaveLength(1)
    expect(result).toContain("[mcp_servers.other]")
  })

  it("prefers explicit installer environment values over workspace defaults", () => {
    // Given
    const fileEnv = {
      NETSUITE_ACCOUNT_ID: "placeholder",
      NETSUITE_ENVIRONMENT: "sandbox",
      MCP_BEARER_TOKEN: "file-token",
    }
    const processEnv = {
      NETSUITE_ACCOUNT_ID: "11675047",
      NETSUITE_ENVIRONMENT: "production",
      MCP_BEARER_TOKEN: 'unsafe\r\nINJECTED = "value"',
      PATH: "should-not-be-persisted",
    }

    // When
    const result = mergeInstallerEnv(fileEnv, processEnv)

    // Then
    expect(result).toEqual({
      NETSUITE_ACCOUNT_ID: "11675047",
      NETSUITE_ENVIRONMENT: "production",
      MCP_BEARER_TOKEN: "file-token",
    })
  })

  it("rejects an invalid space-separated target without prompting", async () => {
    // Given
    const process = Bun.spawn(
      ["bun", "run", "scripts/install-clients.ts", "--target", "definitely-not-real"],
      {
        cwd: resolve(import.meta.dir, ".."),
        stderr: "pipe",
        stdout: "pipe",
      },
    )

    // When
    const status = await Promise.race([process.exited, Bun.sleep(1_000).then(() => -1)])
    if (status === -1) {
      process.kill()
    }
    const error = await new Response(process.stderr).text()

    // Then
    expect(status).toBe(1)
    expect(error).toContain("Unknown install target: definitely-not-real")
  })
})

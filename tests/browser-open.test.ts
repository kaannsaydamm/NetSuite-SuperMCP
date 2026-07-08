import { describe, expect, test } from "bun:test"
import { browserOpenCommand } from "../scripts/browser-open"

describe("browserOpenCommand", () => {
  test("opens Windows URLs without cmd.exe truncating ampersands", () => {
    const url =
      "https://11675047.app.netsuite.com/app/login/oauth2/authorize.nl?response_type=code&client_id=client-id&redirect_uri=https%3A%2F%2F127.0.0.1%3A3026%2Foauth%2Fcallback"

    const command = browserOpenCommand(url, "win32")

    expect(command.command).not.toBe("cmd")
    expect(command.args.join(" ")).toContain("&client_id=client-id")
  })
})

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

export type BrowserOpenCommand = {
  readonly args: readonly string[]
  readonly command: string
}

const windowsChromePaths = [
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
]

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): BrowserOpenCommand {
  if (platform === "win32") {
    const chromePath = windowsChromePaths.find((path) => existsSync(path))
    if (chromePath !== undefined) {
      return { command: chromePath, args: [url] }
    }
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] }
  }
  return { command: "xdg-open", args: [url] }
}

export async function openBrowser(url: string): Promise<void> {
  const { command, args } = browserOpenCommand(url)
  const child = spawn(command, args, { detached: true, stdio: "ignore" })
  child.unref()
}

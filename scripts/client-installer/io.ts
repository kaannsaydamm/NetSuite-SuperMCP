import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export async function readJson(path: string): Promise<Record<string, unknown>> {
  const text = await readText(path)
  if (text.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(text)
  return isObject(parsed) ? parsed : {}
}

export async function writeJson(path: string, value: Record<string, unknown>): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ""
    }
    throw error
  }
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, "utf8")
}

export function readEnvFile(path: string): Record<string, string> | undefined {
  if (!existsSync(path)) {
    return undefined
  }
  const data: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue
    }
    const index = trimmed.indexOf("=")
    if (index <= 0) {
      continue
    }
    data[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return data
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

import { readFile, writeFile } from "node:fs/promises"

export async function readEnvFile(path: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const text = await readFile(path, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue
    const index = line.indexOf("=")
    if (index > 0) env[line.slice(0, index).trim()] = line.slice(index + 1)
  }
  return env
}

export async function removeEnvKeys(path: string, keys: readonly string[]): Promise<void> {
  const keySet = new Set(keys)
  const text = await readFile(path, "utf8")
  const lines = text.split(/\r?\n/).filter((line) => {
    const index = line.indexOf("=")
    return index <= 0 || !keySet.has(line.slice(0, index).trim())
  })
  while (lines.length > 0 && lines.at(-1) === "") lines.pop()
  await writeFile(path, `${lines.join("\n")}\n`, "utf8")
}

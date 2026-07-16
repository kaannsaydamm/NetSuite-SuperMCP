import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import type { JsonObject, JsonValue } from "../shared/json"

export type ExportFormat = "jsonl" | "csv"
export type ExportCompression = "none" | "gzip"

export class ExportStore {
  constructor(readonly directory: string) {}

  async writeChunk(
    resourceId: string,
    chunkIndex: number,
    rows: readonly JsonValue[],
    format: ExportFormat,
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const path = this.chunkPath(resourceId, format, chunkIndex)
    const contents = format === "jsonl" ? jsonLines(rows) : csv(rows, chunkIndex === 0)
    await writeFile(path, contents, "utf8")
  }

  async finalize(
    resourceId: string,
    format: ExportFormat,
    compression: ExportCompression,
    chunksCompleted: number,
  ): Promise<{ uri: string; mimeType: string; bytes: number }> {
    await mkdir(this.directory, { recursive: true })
    const chunks: Buffer[] = []
    for (let index = 0; index < chunksCompleted; index += 1) {
      chunks.push(await readFile(this.chunkPath(resourceId, format, index)))
    }
    const contents = Buffer.concat(chunks)
    const extension = `${format === "jsonl" ? "jsonl" : "csv"}${compression === "gzip" ? ".gz" : ""}`
    const final = join(this.directory, `${resourceId}.${extension}`)
    if (compression === "gzip") {
      await writeFile(final, gzipSync(contents))
    } else {
      await writeFile(final, contents)
    }
    const metadata = await stat(final)
    return {
      uri: `netsuite-supermcp://exports/${resourceId}`,
      mimeType:
        compression === "gzip"
          ? "application/gzip"
          : format === "csv"
            ? "text/csv"
            : "application/x-ndjson",
      bytes: metadata.size,
    }
  }

  async read(resourceId: string): Promise<{ blob?: string; text?: string; mimeType: string }> {
    const files = await this.findResource(resourceId)
    const match = files[0]
    if (!match) throw new Error("EXPORT_NOT_FOUND")
    const contents = await readFile(match.path)
    return match.gzip
      ? { blob: contents.toString("base64"), mimeType: "application/gzip" }
      : {
          text: contents.toString("utf8"),
          mimeType: match.csv ? "text/csv" : "application/x-ndjson",
        }
  }

  private async findResource(resourceId: string) {
    const candidates = [
      { name: `${resourceId}.jsonl`, gzip: false, csv: false },
      { name: `${resourceId}.csv`, gzip: false, csv: true },
      { name: `${resourceId}.jsonl.gz`, gzip: true, csv: false },
      { name: `${resourceId}.csv.gz`, gzip: true, csv: true },
    ]
    const result: { path: string; gzip: boolean; csv: boolean }[] = []
    for (const candidate of candidates) {
      const path = join(this.directory, candidate.name)
      try {
        await stat(path)
        result.push({ path, gzip: candidate.gzip, csv: candidate.csv })
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
    return result
  }

  private chunkPath(resourceId: string, format: ExportFormat, chunkIndex: number): string {
    return join(
      this.directory,
      `${resourceId}.${format}.chunk-${String(chunkIndex).padStart(6, "0")}`,
    )
  }
}

function jsonLines(rows: readonly JsonValue[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "")
}

function csv(rows: readonly JsonValue[], includeHeader: boolean): string {
  const objects = rows.filter(isObject)
  if (objects.length === 0) return ""
  const headers = [...new Set(objects.flatMap((row) => Object.keys(row)))].sort()
  const lines = objects.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  return `${[...(includeHeader ? [headers.map(csvCell).join(",")] : []), ...lines].join("\n")}\n`
}

function csvCell(value: JsonValue | undefined): string {
  const text =
    value === undefined || value === null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

import { createHash } from "node:crypto"

export type ScriptSource = {
  readonly scriptId: string
  readonly deploymentIds: readonly string[]
  readonly file: { readonly id: string; readonly name: string; readonly path?: string }
  readonly source: string
}

export type SourceEvidence = {
  readonly file: string
  readonly line: number
  readonly excerpt: string
}

export type AuditFinding = {
  readonly rule: string
  readonly severity: "low" | "medium" | "high" | "critical"
  readonly confidence: "confirmed" | "conservative"
  readonly evidence: SourceEvidence
  readonly fingerprint?: string
}

export type DependencyEdge = {
  readonly from: string
  readonly to: string
  readonly type: "module" | "recordRead" | "recordWrite" | "fieldRead" | "fieldWrite"
  readonly status: "resolved" | "unknown"
  readonly evidence: SourceEvidence
}

const SECRET_ASSIGNMENT =
  /\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret|authorization)\b\s*[:=]\s*(["'`])([^"'`]{4,})\1/i

const STATIC_RULES: ReadonlyArray<{
  readonly rule: string
  readonly severity: AuditFinding["severity"]
  readonly pattern: RegExp
}> = [
  { rule: "destructive-record-delete", severity: "high", pattern: /\brecord\s*\.\s*delete\s*\(/ },
  {
    rule: "ignored-mandatory-fields",
    severity: "high",
    pattern: /ignoreMandatoryFields\s*:\s*true/,
  },
  {
    rule: "unbounded-loop",
    severity: "medium",
    pattern: /\b(?:while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;)/,
  },
  {
    rule: "direct-external-request",
    severity: "medium",
    pattern: /\bhttps?\s*\.\s*(?:request|get|post|put|delete)\s*\(/,
  },
]

export function analyzeScriptSource(script: ScriptSource) {
  const findings: AuditFinding[] = []
  const lines = script.source.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const secret = line.match(SECRET_ASSIGNMENT)
    if (secret !== null) {
      const value = secret[2] ?? ""
      findings.push({
        rule: "hardcoded-secret-like-value",
        severity: "critical",
        confidence: "conservative",
        fingerprint: fingerprint(value),
        evidence: evidence(script, index, line.replace(value, "[REDACTED]")),
      })
    }
    for (const rule of STATIC_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          rule: rule.rule,
          severity: rule.severity,
          confidence: "conservative",
          evidence: evidence(script, index, redactLine(line)),
        })
      }
    }
  }

  if (
    /\brecord\s*\.\s*create\s*\(/.test(script.source) &&
    !/externalid|duplicate|search\s*\./i.test(script.source)
  ) {
    findings.push({
      rule: "duplicate-creation-risk",
      severity: "medium",
      confidence: "conservative",
      evidence: firstEvidence(script, /\brecord\s*\.\s*create\s*\(/),
    })
  }
  if (
    /\b(?:for|while)\s*\(/.test(script.source) &&
    /\brecord\s*\./.test(script.source) &&
    !/getRemainingUsage/.test(script.source)
  ) {
    findings.push({
      rule: "missing-governance-check",
      severity: "medium",
      confidence: "conservative",
      evidence: firstEvidence(script, /\b(?:for|while)\s*\(/),
    })
  }

  return {
    scriptId: script.scriptId,
    file: script.file,
    findings,
    dependencies: dependencyEdges(script),
  }
}

export function dependencyEdges(script: ScriptSource): readonly DependencyEdge[] {
  const edges: DependencyEdge[] = []
  const define = script.source.match(/define\s*\(\s*\[([\s\S]*?)\]/)
  if (define === null) {
    edges.push({
      from: script.scriptId,
      to: "dynamic-or-unsupported-define",
      type: "module",
      status: "unknown",
      evidence: {
        file: script.file.path ?? script.file.name,
        line: 1,
        excerpt: "AMD dependency array not statically resolved",
      },
    })
  } else {
    const startLine = script.source.slice(0, define.index ?? 0).split(/\r?\n/).length
    for (const match of define[1]?.matchAll(/["']([^"']+)["']/g) ?? []) {
      edges.push({
        from: script.scriptId,
        to: match[1] ?? "unknown",
        type: "module",
        status: "resolved",
        evidence: {
          file: script.file.path ?? script.file.name,
          line: startLine,
          excerpt: match[0],
        },
      })
    }
  }
  scanApiUsage(script, edges)
  return edges
}

export function findDuplicateLogic(scripts: readonly ScriptSource[]) {
  const groups = new Map<string, ScriptSource[]>()
  for (const script of scripts) {
    const normalized = script.source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
    if (normalized.length < 80) continue
    const digest = fingerprint(normalized)
    groups.set(digest, [...(groups.get(digest) ?? []), script])
  }
  return [...groups.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([fingerprintValue, matches]) => ({
      fingerprint: fingerprintValue,
      scripts: matches.map((entry) => ({ scriptId: entry.scriptId, file: entry.file })),
      confidence: "confirmed" as const,
    }))
}

function scanApiUsage(script: ScriptSource, edges: DependencyEdge[]): void {
  const patterns: ReadonlyArray<{ type: DependencyEdge["type"]; pattern: RegExp }> = [
    {
      type: "recordWrite",
      pattern:
        /record\s*\.\s*(?:create|delete|submitFields|transform)\s*\(\s*\{[\s\S]*?type\s*:\s*(["'])([^"']+)\1/g,
    },
    {
      type: "recordRead",
      pattern: /record\s*\.\s*load\s*\(\s*\{[\s\S]*?type\s*:\s*(["'])([^"']+)\1/g,
    },
    { type: "fieldWrite", pattern: /setValue\s*\(\s*\{[\s\S]*?fieldId\s*:\s*(["'])([^"']+)\1/g },
    {
      type: "fieldRead",
      pattern: /get(?:Value|Text)\s*\(\s*\{[\s\S]*?fieldId\s*:\s*(["'])([^"']+)\1/g,
    },
  ]
  for (const entry of patterns) {
    for (const match of script.source.matchAll(entry.pattern)) {
      edges.push({
        from: script.scriptId,
        to: match[2] ?? "unknown",
        type: entry.type,
        status: "resolved",
        evidence: evidenceAtOffset(script, match.index ?? 0, match[0]),
      })
    }
  }
}

function firstEvidence(script: ScriptSource, pattern: RegExp): SourceEvidence {
  const match = pattern.exec(script.source)
  return evidenceAtOffset(script, match?.index ?? 0, match?.[0] ?? "")
}

function evidenceAtOffset(script: ScriptSource, offset: number, excerpt: string): SourceEvidence {
  return {
    file: script.file.path ?? script.file.name,
    line: script.source.slice(0, offset).split(/\r?\n/).length,
    excerpt: redactLine(excerpt).slice(0, 240),
  }
}

function evidence(script: ScriptSource, index: number, excerpt: string): SourceEvidence {
  return {
    file: script.file.path ?? script.file.name,
    line: index + 1,
    excerpt: excerpt.trim().slice(0, 240),
  }
}

function redactLine(line: string): string {
  return line.replace(SECRET_ASSIGNMENT, (match, quote: string, value: string) =>
    match.replace(`${quote}${value}${quote}`, `${quote}[REDACTED]${quote}`),
  )
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

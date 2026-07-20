import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"

describe("permanent RESTlet operation contract", () => {
  it("captures source state and applies explicit line selection without date handling", async () => {
    const operationSource = await readFile(
      "netsuite/suitescript/supermcp_operation_actions.js",
      "utf8",
    )
    const transformSource = await readFile(
      "netsuite/suitescript/supermcp_transform_actions.js",
      "utf8",
    )
    const projectSource = await readFile("scripts/suitecloud-project.ts", "utf8")

    expect(operationSource).toContain("record.load")
    expect(operationSource).toMatch(/search\s*\.create/)
    expect(operationSource).toContain("relatedTransactions")
    expect(operationSource).toContain("applyLineSelection")
    expect(operationSource).toContain("findExistingTarget")
    expect(operationSource).toContain('fieldId: "externalid"')
    expect(operationSource).not.toMatch(/tranDate|timestamp|lastModifiedDate|timezone/i)
    expect(transformSource).toContain('"./supermcp_operation_actions"')
    expect(transformSource).toContain("operationActions.buildSourceSnapshot")
    expect(transformSource).toContain("operationActions.applyLineSelection")
    expect(projectSource).toContain('"supermcp_operation_actions.js"')
  })

  it("uses the System Note result id instead of the unsupported internalid column", async () => {
    const source = await readFile(
      "netsuite/suitescript/supermcp_record_explorer_actions.js",
      "utf8",
    )
    const systemNotes = source.slice(
      source.indexOf("function getSystemNotes"),
      source.indexOf("function transactionSummary"),
    )
    expect(systemNotes).not.toContain('"internalid"')
    expect(systemNotes).not.toContain('["record",')
    expect(systemNotes).toContain('["recordid",')
    expect(systemNotes).toContain("canonicalSystemNoteRecordType")
    expect(systemNotes).not.toContain('["recordtype", "is", recordType]')
    expect(systemNotes).toContain("String(result.id)")
  })
})

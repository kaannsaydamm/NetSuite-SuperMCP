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
})

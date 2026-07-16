/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/record"], (nsError, record) => {
  const INVENTORY_ACTIONS = {
    ns_applyInventoryStockImport: runInventoryStockImport,
  }

  function run(actionRequest) {
    const handler = INVENTORY_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function runInventoryStockImport(actionRequest) {
    const adjustment = readAdjustment(actionRequest.payload)
    if (actionRequest.phase !== "commit") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        preview: summarizeAdjustment(adjustment),
      }
    }

    const adjustmentRecord = record.create({
      type: record.Type.INVENTORY_ADJUSTMENT,
      isDynamic: true,
    })
    adjustmentRecord.setValue({ fieldId: "account", value: adjustment.accountId })
    adjustmentRecord.setValue({ fieldId: "adjlocation", value: adjustment.locationId })
    setOptionalValue(adjustmentRecord, "subsidiary", adjustment.subsidiaryId)
    setOptionalValue(adjustmentRecord, "trandate", adjustment.tranDate)
    setOptionalValue(adjustmentRecord, "externalid", adjustment.externalId)
    setOptionalValue(adjustmentRecord, "memo", adjustment.memo)

    for (const line of adjustment.lines) {
      adjustmentRecord.selectNewLine({ sublistId: "inventory" })
      adjustmentRecord.setCurrentSublistValue({
        sublistId: "inventory",
        fieldId: "item",
        value: line.itemId,
      })
      adjustmentRecord.setCurrentSublistValue({
        sublistId: "inventory",
        fieldId: "location",
        value: adjustment.locationId,
      })
      adjustmentRecord.setCurrentSublistValue({
        sublistId: "inventory",
        fieldId: "adjustqtyby",
        value: line.delta,
      })
      adjustmentRecord.setCurrentSublistValue({
        sublistId: "inventory",
        fieldId: "memo",
        value: `Stock import ${line.itemKey}: ${line.currentQuantity} -> ${line.targetQuantity}`,
      })
      if (adjustment.inventoryStatusId !== null) {
        setInventoryAssignment(adjustmentRecord, adjustment.inventoryStatusId, line.delta)
      }
      adjustmentRecord.commitLine({ sublistId: "inventory" })
    }

    const id = adjustmentRecord.save({ enableSourcing: true, ignoreMandatoryFields: false })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      record: { type: "inventoryAdjustment", id: String(id) },
      summary: summarizeAdjustment(adjustment),
    }
  }

  function setInventoryAssignment(adjustmentRecord, inventoryStatusId, delta) {
    const detail = adjustmentRecord.getCurrentSublistSubrecord({
      sublistId: "inventory",
      fieldId: "inventorydetail",
    })
    detail.selectNewLine({ sublistId: "inventoryassignment" })
    detail.setCurrentSublistValue({
      sublistId: "inventoryassignment",
      fieldId: "inventorystatus",
      value: inventoryStatusId,
    })
    detail.setCurrentSublistValue({
      sublistId: "inventoryassignment",
      fieldId: "quantity",
      value: delta,
    })
    detail.commitLine({ sublistId: "inventoryassignment" })
  }

  function readAdjustment(payload) {
    const lines = requireLines(payload)
    return {
      accountId: requireId(payload, "adjustmentAccountId"),
      locationId: requireId(payload, "locationId"),
      inventoryStatusId: optionalId(payload, "inventoryStatusId"),
      subsidiaryId: optionalId(payload, "subsidiaryId"),
      tranDate: optionalText(payload, "tranDate"),
      externalId: optionalText(payload, "externalId"),
      memo: optionalText(payload, "memo"),
      lines,
    }
  }

  function requireLines(payload) {
    if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
      throw createRequestError("INVALID_LINES", "payload.lines must be a non-empty array")
    }
    return payload.lines.map((line, index) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) {
        throw createRequestError("INVALID_LINE", `payload.lines[${index}] must be an object`)
      }
      const delta = line.delta
      if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0) {
        throw createRequestError(
          "INVALID_DELTA",
          `payload.lines[${index}].delta must be a non-zero number`,
        )
      }
      return {
        itemId: requireId(line, "itemId"),
        itemKey: requireText(line, "itemKey"),
        currentQuantity: requireFiniteNumber(line, "currentQuantity"),
        targetQuantity: requireFiniteNumber(line, "targetQuantity"),
        delta,
      }
    })
  }

  function summarizeAdjustment(adjustment) {
    const signedDelta = adjustment.lines.reduce((total, line) => total + line.delta, 0)
    const absoluteDelta = adjustment.lines.reduce((total, line) => total + Math.abs(line.delta), 0)
    return {
      accountId: String(adjustment.accountId),
      locationId: String(adjustment.locationId),
      inventoryStatusId:
        adjustment.inventoryStatusId === null ? null : String(adjustment.inventoryStatusId),
      lineCount: adjustment.lines.length,
      signedDelta,
      absoluteDelta,
    }
  }

  function setOptionalValue(adjustmentRecord, fieldId, value) {
    if (value !== null) {
      adjustmentRecord.setValue({ fieldId, value })
    }
  }

  function requireText(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value !== "string" || value.trim().length === 0) {
      throw createRequestError("MISSING_TEXT", `${fieldId} must be a non-empty string`)
    }
    return value.trim()
  }

  function optionalText(payload, fieldId) {
    if (payload[fieldId] === undefined) {
      return null
    }
    return requireText(payload, fieldId)
  }

  function requireFiniteNumber(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw createRequestError("INVALID_NUMBER", `${fieldId} must be a finite number`)
    }
    return value
  }

  function requireId(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value
    }
    if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
      return Number(value)
    }
    throw createRequestError("MISSING_ID", `${fieldId} must be a positive internal ID`)
  }

  function optionalId(payload, fieldId) {
    return payload[fieldId] === undefined ? null : requireId(payload, fieldId)
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/record", "N/search"], (nsError, record, search) => {
  const BODY_FIELDS = [
    "tranid",
    "status",
    "orderstatus",
    "entity",
    "subsidiary",
    "location",
    "currency",
    "externalid",
  ]
  const LINE_FIELDS = [
    "lineuniquekey",
    "item",
    "quantity",
    "quantityremaining",
    "quantityfulfilled",
    "quantityreceived",
    "quantitybilled",
    "isclosed",
    "location",
  ]

  function buildSourceSnapshot(source, payload) {
    const sourceRecord = record.load({ type: source.fromType, id: source.fromId, isDynamic: false })
    const body = readBody(sourceRecord, payload.snapshotFields)
    return {
      source: {
        type: source.fromType,
        id: String(source.fromId),
        targetType: source.toType,
      },
      body,
      lines: readLines(sourceRecord),
      relatedTransactions: findRelatedTransactions(source.fromId),
    }
  }

  function applyLineSelection(transformedRecord, selection) {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw createRequestError("MISSING_SELECTION", "selection must be explicit")
    }
    const lineCount = transformedRecord.getLineCount({ sublistId: "item" })
    if (selection.mode === "allOpen") {
      return selectedLineSummary(transformedRecord, lineCount)
    }
    if (
      selection.mode !== "selected" ||
      !Array.isArray(selection.lines) ||
      selection.lines.length === 0
    ) {
      throw createRequestError(
        "INVALID_SELECTION",
        'selection.mode must be "allOpen" or "selected" with at least one line',
      )
    }

    const selected = new Map()
    for (const requested of selection.lines) {
      const line = requested?.line
      if (!Number.isInteger(line) || line < 0 || line >= lineCount) {
        throw createRequestError(
          "INVALID_LINE",
          `selected line ${line} is outside the item sublist`,
        )
      }
      if (selected.has(line)) {
        throw createRequestError("DUPLICATE_LINE", `selected line ${line} appears more than once`)
      }
      selected.set(line, requested)
    }

    for (let line = 0; line < lineCount; line += 1) {
      transformedRecord.selectLine({ sublistId: "item", line })
      const request = selected.get(line)
      setSelectionFlag(transformedRecord, request !== undefined)
      if (request !== undefined) {
        applySelectedLine(transformedRecord, request, line)
      }
      transformedRecord.commitLine({ sublistId: "item" })
    }
    return selectedLineSummary(transformedRecord, lineCount)
  }

  function summarizeTarget(transformedRecord, source, selectedLines) {
    return {
      source,
      targetType: source.toType,
      selectedLines,
      lineCounts: lineCounts(transformedRecord),
    }
  }

  function findExistingTarget(targetType, idempotencyKey) {
    if (idempotencyKey === undefined) {
      return null
    }
    requireIdempotencyKey(idempotencyKey)
    let existingId = null
    search
      .create({
        type: targetType,
        filters: [["externalid", "is", idempotencyKey]],
        columns: ["internalid"],
      })
      .run()
      .each((result) => {
        existingId = String(result.getValue({ name: "internalid" }))
        return false
      })
    return existingId
  }

  function applyIdempotencyKey(transformedRecord, idempotencyKey) {
    if (idempotencyKey !== undefined) {
      requireIdempotencyKey(idempotencyKey)
      transformedRecord.setValue({ fieldId: "externalid", value: idempotencyKey })
    }
  }

  function requireIdempotencyKey(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 255) {
      throw createRequestError(
        "INVALID_IDEMPOTENCY_KEY",
        "idempotencyKey must be a non-empty string",
      )
    }
  }

  function readBody(sourceRecord, requestedFields) {
    const fields = BODY_FIELDS.concat(validateSnapshotFields(requestedFields))
    const result = {}
    for (const fieldId of fields) {
      const value = safeGetValue(sourceRecord, fieldId)
      if (value !== null && value !== undefined) {
        result[fieldId] = value
      }
    }
    return result
  }

  function validateSnapshotFields(value) {
    if (value === undefined) {
      return []
    }
    if (!Array.isArray(value) || value.length > 25) {
      throw createRequestError(
        "INVALID_SNAPSHOT_FIELDS",
        "snapshotFields must contain at most 25 field IDs",
      )
    }
    return value.map((fieldId) => {
      if (typeof fieldId !== "string" || fieldId.length === 0 || /date|time/i.test(fieldId)) {
        throw createRequestError(
          "INVALID_SNAPSHOT_FIELD",
          "snapshotFields must be non-empty field IDs and cannot request calendar or clock fields",
        )
      }
      return fieldId
    })
  }

  function readLines(sourceRecord) {
    const count = sourceRecord.getLineCount({ sublistId: "item" })
    const lines = []
    for (let line = 0; line < count; line += 1) {
      const values = { line }
      for (const fieldId of LINE_FIELDS) {
        const value = safeGetSublistValue(sourceRecord, fieldId, line)
        if (value !== null && value !== undefined) {
          values[fieldId] = value
        }
      }
      lines.push(values)
    }
    return lines
  }

  function findRelatedTransactions(sourceId) {
    const results = []
    search
      .create({
        type: search.Type.TRANSACTION,
        filters: [["createdfrom", "anyof", sourceId], "and", ["mainline", "is", "T"]],
        columns: ["internalid", "type", "statusref", "tranid"],
      })
      .run()
      .each((result) => {
        results.push({
          id: String(result.getValue({ name: "internalid" })),
          type: result.getValue({ name: "type" }),
          status: result.getValue({ name: "statusref" }),
          transactionNumber: result.getValue({ name: "tranid" }),
        })
        return results.length < 100
      })
    return results
  }

  function applySelectedLine(transformedRecord, request, line) {
    if (request.quantity !== undefined) {
      if (typeof request.quantity !== "number" || request.quantity <= 0) {
        throw createRequestError("INVALID_QUANTITY", `quantity for line ${line} must be positive`)
      }
      const available = Number(
        transformedRecord.getCurrentSublistValue({ sublistId: "item", fieldId: "quantity" }),
      )
      if (!Number.isFinite(available) || request.quantity > available) {
        throw createRequestError(
          "QUANTITY_EXCEEDS_OPEN",
          `quantity for line ${line} exceeds the currently transformable quantity`,
        )
      }
      transformedRecord.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "quantity",
        value: request.quantity,
      })
    }
    if (request.locationId !== undefined) {
      transformedRecord.setCurrentSublistValue({
        sublistId: "item",
        fieldId: "location",
        value: request.locationId,
      })
    }
  }

  function setSelectionFlag(transformedRecord, selected) {
    for (const fieldId of ["itemreceive", "apply"]) {
      try {
        transformedRecord.setCurrentSublistValue({
          sublistId: "item",
          fieldId,
          value: selected,
        })
        return
      } catch (error) {
        if (!isUnavailableFieldError(error)) {
          throw error
        }
      }
    }
    if (!selected) {
      throw createRequestError(
        "LINE_SELECTION_UNSUPPORTED",
        "target transaction cannot deselect item lines",
      )
    }
  }

  function selectedLineSummary(transformedRecord, lineCount) {
    const lines = []
    for (let line = 0; line < lineCount; line += 1) {
      const selected = readSelectionFlag(transformedRecord, line)
      if (selected) {
        lines.push({
          line,
          item: safeGetSublistValue(transformedRecord, "item", line),
          quantity: safeGetSublistValue(transformedRecord, "quantity", line),
          location: safeGetSublistValue(transformedRecord, "location", line),
          inventoryDetailRequired: safeGetSublistValue(
            transformedRecord,
            "inventorydetailreq",
            line,
          ),
        })
      }
    }
    return lines
  }

  function readSelectionFlag(transformedRecord, line) {
    for (const fieldId of ["itemreceive", "apply"]) {
      const value = safeGetSublistValue(transformedRecord, fieldId, line)
      if (typeof value === "boolean") {
        return value
      }
    }
    return true
  }

  function lineCounts(transformedRecord) {
    const counts = {}
    for (const sublistId of ["item", "expense", "apply"]) {
      try {
        counts[sublistId] = transformedRecord.getLineCount({ sublistId })
      } catch (error) {
        if (!isUnavailableFieldError(error)) {
          throw error
        }
      }
    }
    return counts
  }

  function safeGetValue(sourceRecord, fieldId) {
    try {
      return sourceRecord.getValue({ fieldId })
    } catch (error) {
      if (isUnavailableFieldError(error)) {
        return null
      }
      throw error
    }
  }

  function safeGetSublistValue(sourceRecord, fieldId, line) {
    try {
      return sourceRecord.getSublistValue({ sublistId: "item", fieldId, line })
    } catch (error) {
      if (isUnavailableFieldError(error)) {
        return null
      }
      throw error
    }
  }

  function isUnavailableFieldError(error) {
    return Boolean(
      error &&
        [
          "SSS_INVALID_SUBLIST_OPERATION",
          "SSS_MISSING_REQD_ARGUMENT",
          "INVALID_FLD_VALUE",
        ].includes(error.name),
    )
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return {
    applyIdempotencyKey,
    applyLineSelection,
    buildSourceSnapshot,
    findExistingTarget,
    summarizeTarget,
  }
})

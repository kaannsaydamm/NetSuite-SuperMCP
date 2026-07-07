/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/record"], (nsError, record) => {
  const TRANSFORM_ACTIONS = {
    ns_transformRecord: {
      source: readGenericSource,
    },
    ns_fulfillSalesOrder: {
      source: (payload) => ({
        fromType: record.Type.SALES_ORDER,
        fromId: requireId(payload, "salesOrderId"),
        toType: record.Type.ITEM_FULFILLMENT,
      }),
    },
    ns_invoiceSalesOrder: {
      source: (payload) => ({
        fromType: record.Type.SALES_ORDER,
        fromId: requireId(payload, "salesOrderId"),
        toType: record.Type.INVOICE,
      }),
    },
    ns_receivePurchaseOrder: {
      source: (payload) => ({
        fromType: record.Type.PURCHASE_ORDER,
        fromId: requireId(payload, "purchaseOrderId"),
        toType: record.Type.ITEM_RECEIPT,
      }),
    },
    ns_billPurchaseOrder: {
      source: (payload) => ({
        fromType: record.Type.PURCHASE_ORDER,
        fromId: requireId(payload, "purchaseOrderId"),
        toType: record.Type.VENDOR_BILL,
      }),
    },
  }

  function run(actionRequest) {
    const handler = TRANSFORM_ACTIONS[actionRequest.action]
    return handler ? runTransformAction(actionRequest, handler) : null
  }

  function runTransformAction(actionRequest, handler) {
    const source = handler.source(actionRequest.payload)

    if (actionRequest.phase === "prepare") {
      return { action: actionRequest.action, phase: actionRequest.phase, willTransform: source }
    }

    const transformedRecord = record.transform({
      fromType: source.fromType,
      fromId: source.fromId,
      toType: source.toType,
      isDynamic: true,
    })

    applyBodyFields(transformedRecord, actionRequest.payload)

    if (actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        preview: summarizeRecord(transformedRecord, source),
      }
    }

    const id = transformedRecord.save({ enableSourcing: true, ignoreMandatoryFields: false })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      record: { type: source.toType, id: String(id) },
    }
  }

  function readGenericSource(payload) {
    return {
      fromType: requireText(payload, "fromType"),
      fromId: requireId(payload, "fromId"),
      toType: requireText(payload, "toType"),
    }
  }

  function applyBodyFields(transformedRecord, payload) {
    const values = payload.values
    if (!values) {
      return
    }

    if (typeof values !== "object" || Array.isArray(values)) {
      throw createRequestError("INVALID_VALUES", "payload.values must be an object")
    }

    for (const fieldId of Object.keys(values)) {
      transformedRecord.setValue({ fieldId, value: values[fieldId] })
    }
  }

  function summarizeRecord(transformedRecord, source) {
    return {
      fromType: source.fromType,
      fromId: String(source.fromId),
      toType: source.toType,
      lineCounts: lineCounts(transformedRecord),
    }
  }

  function lineCounts(transformedRecord) {
    const sublists = ["item", "expense", "apply"]
    const counts = {}

    for (const sublistId of sublists) {
      try {
        counts[sublistId] = transformedRecord.getLineCount({ sublistId })
      } catch (error) {
        if (error && error.name === "SSS_INVALID_SUBLIST_OPERATION") {
          continue
        }
        throw error
      }
    }

    return counts
  }

  function requireText(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value !== "string" || value.length === 0) {
      throw createRequestError("MISSING_TEXT", `${fieldId} must be a non-empty string`)
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

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

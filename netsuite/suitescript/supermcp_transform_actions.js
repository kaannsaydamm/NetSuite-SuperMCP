/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/record", "./supermcp_operation_actions"], (
  nsError,
  record,
  operationActions,
) => {
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
    const snapshot = operationActions.buildSourceSnapshot(source, actionRequest.payload)

    if (actionRequest.phase === "prepare") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        willTransform: source,
        snapshot,
      }
    }

    if (actionRequest.phase === "commit") {
      const existingId = operationActions.findExistingTarget(
        source.toType,
        actionRequest.payload.idempotencyKey,
      )
      if (existingId !== null) {
        return {
          action: actionRequest.action,
          phase: actionRequest.phase,
          record: { type: source.toType, id: existingId },
          idempotent: true,
        }
      }
    }

    const transformedRecord = record.transform({
      fromType: source.fromType,
      fromId: source.fromId,
      toType: source.toType,
      isDynamic: true,
    })

    applyBodyFields(transformedRecord, actionRequest.payload)
    operationActions.applyIdempotencyKey(transformedRecord, actionRequest.payload.idempotencyKey)
    const selectedLines = operationActions.applyLineSelection(
      transformedRecord,
      actionRequest.payload.selection,
    )

    if (actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        snapshot,
        preview: operationActions.summarizeTarget(transformedRecord, source, selectedLines),
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

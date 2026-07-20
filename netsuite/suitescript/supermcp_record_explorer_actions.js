/**
 * @NApiVersion 2.1
 */
define(["N/error", "N/record", "N/search"], (nsError, record, search) => {
  const RECORD_EXPLORER_ACTIONS = {
    ns_describeRecordTypeFallback: describeRecordTypeFallback,
    ns_getRecordWithSublists: getRecordWithSublists,
    ns_getTransactionChain: getTransactionChain,
    ns_getSystemNotes: getSystemNotes,
  }

  function run(actionRequest) {
    const handler = RECORD_EXPLORER_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function describeRecordTypeFallback(actionRequest) {
    requirePreview(actionRequest)
    const recordType = identifier(actionRequest.payload, "recordType")
    const instance = record.create({ type: recordType, isDynamic: false })
    const fields = instance.getFields().map((fieldId) => describeField(instance, fieldId))
    return {
      action: actionRequest.action,
      phase: "preview",
      source: "suiteScriptRecordCreateIntrospection",
      recordType,
      fields,
      sublists: instance.getSublists(),
    }
  }

  function getRecordWithSublists(actionRequest) {
    requirePreview(actionRequest)
    const payload = actionRequest.payload
    const recordType = identifier(payload, "recordType")
    const recordId = text(payload, "recordId")
    const sublists = stringArray(payload, "sublists", 20)
    const lineLimit = boundedInteger(payload.lineLimit, 1, 1000, 250)
    const instance = record.load({ type: recordType, id: recordId, isDynamic: false })
    const body = {}
    instance.getFields().forEach((fieldId) => {
      try {
        body[fieldId] = instance.getValue({ fieldId })
      } catch (_) {
        // A field can be listed but unavailable for this form or role.
      }
    })
    const result = {}
    const gaps = []
    sublists.forEach((sublistId) => {
      try {
        const count = instance.getLineCount({ sublistId })
        const fields = instance.getSublistFields({ sublistId })
        const lines = []
        for (let line = 0; line < Math.min(count, lineLimit); line += 1) {
          const values = {}
          fields.forEach((fieldId) => {
            try {
              values[fieldId] = instance.getSublistValue({ sublistId, fieldId, line })
            } catch (_) {
              // Preserve partial visibility per line instead of failing the whole record.
            }
          })
          lines.push({ line, values })
        }
        result[sublistId] = { count, truncated: count > lineLimit, lines }
      } catch (error) {
        gaps.push({ sublistId, error: errorText(error) })
      }
    })
    return {
      action: actionRequest.action,
      phase: "preview",
      record: { type: recordType, id: String(instance.id), fields: body },
      sublists: result,
      gaps,
      partial: gaps.length > 0,
    }
  }

  function getTransactionChain(actionRequest) {
    requirePreview(actionRequest)
    const payload = actionRequest.payload
    const rootType = identifier(payload, "recordType")
    const rootId = text(payload, "recordId")
    const maxNodes = boundedInteger(payload.maxNodes, 1, 250, 100)
    const integrationReferences = array(payload.integrationReferences).slice(0, 10)
    const nodes = []
    const edges = []
    const gaps = []
    const seen = new Set()
    const queue = [{ type: rootType, id: rootId }]

    while (queue.length > 0 && nodes.length < maxNodes) {
      const current = queue.shift()
      const key = `${current.type}:${current.id}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const summary = transactionSummary(current.id)
        nodes.push({ ...current, ...summary })
        if (summary.createdFrom) {
          const parent = { type: "transaction", id: String(summary.createdFrom) }
          edges.push({
            from: key,
            to: `${parent.type}:${parent.id}`,
            relation: "createdFrom",
          })
          if (!seen.has(`${parent.type}:${parent.id}`)) queue.push(parent)
        }
        relationshipProbes(current.id).forEach((relationship) => {
          const target = { type: relationship.type || "transaction", id: relationship.id }
          edges.push({
            from: key,
            to: `${target.type}:${target.id}`,
            relation: relationship.relation,
          })
          if (!seen.has(`${target.type}:${target.id}`)) queue.push(target)
        })
      } catch (error) {
        gaps.push({ ref: current, error: errorText(error) })
      }
    }

    integrationReferences.forEach((reference) => {
      try {
        const recordType = identifier(reference, "recordType")
        const transactionField = identifier(reference, "transactionField")
        search
          .create({
            type: recordType,
            filters: [[transactionField, "anyof", rootId]],
            columns: ["internalid", transactionField],
          })
          .run()
          .each((result) => {
            if (nodes.length >= maxNodes) return false
            const id = String(result.id)
            nodes.push({ type: recordType, id, integrationReference: transactionField })
            edges.push({
              from: `${rootType}:${rootId}`,
              to: `${recordType}:${id}`,
              relation: "integrationReference",
            })
            return true
          })
      } catch (error) {
        gaps.push({ reference, error: errorText(error) })
      }
    })

    return {
      action: actionRequest.action,
      phase: "preview",
      root: { type: rootType, id: rootId },
      nodes,
      edges,
      tree: edges.map((edge) => `${edge.from} --${edge.relation}--> ${edge.to}`),
      gaps,
      partial: gaps.length > 0,
      truncated: queue.length > 0 || nodes.length >= maxNodes,
    }
  }

  function getSystemNotes(actionRequest) {
    requirePreview(actionRequest)
    const payload = actionRequest.payload
    const recordType = identifier(payload, "recordType")
    const recordId = text(payload, "recordId")
    const limit = boundedInteger(payload.limit, 1, 1000, 250)
    const events = []
    const gaps = []
    const expectedRecordType = canonicalSystemNoteRecordType(recordType)
    let scanned = 0
    try {
      search
        .create({
          type: "systemnote",
          filters: [["recordid", "equalto", recordId]],
          columns: [
            "recordtype",
            "recordid",
            "field",
            "oldvalue",
            "newvalue",
            "type",
            "context",
            "role",
            "name",
            "date",
          ],
        })
        .run()
        .each((result) => {
          if (events.length >= limit) return false
          scanned += 1
          const resultRecordType =
            result.getText({ name: "recordtype" }) || result.getValue({ name: "recordtype" })
          if (canonicalSystemNoteRecordType(resultRecordType) !== expectedRecordType) {
            return scanned < 5000
          }
          events.push({
            id: String(result.id),
            recordType: resultRecordType,
            recordId: result.getValue({ name: "recordid" }),
            field: result.getValue({ name: "field" }),
            oldValue: result.getValue({ name: "oldvalue" }),
            newValue: result.getValue({ name: "newvalue" }),
            changeType: result.getValue({ name: "type" }),
            context: result.getValue({ name: "context" }),
            role: result.getValue({ name: "role" }),
            user: result.getText({ name: "name" }) || result.getValue({ name: "name" }),
            rawDate: result.getValue({ name: "date" }),
          })
          return true
        })
    } catch (error) {
      gaps.push({ source: "systemnote-search", error: errorText(error) })
    }
    return {
      action: actionRequest.action,
      phase: "preview",
      record: { type: recordType, id: recordId },
      recordTypeDiscriminant: expectedRecordType,
      events,
      count: events.length,
      gaps,
      partial: gaps.length > 0,
      truncated: events.length >= limit,
      ordering: "netsuite-returned-sequence",
    }
  }

  function canonicalSystemNoteRecordType(value) {
    const normalized = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
    if (isTransactionRecordType(normalized)) return "transaction"
    return normalized
  }

  function isTransactionRecordType(value) {
    return [
      "transaction",
      "salesorder",
      "salesord",
      "invoice",
      "custinvc",
      "itemfulfillment",
      "itemship",
      "purchaseorder",
      "purchord",
      "itemreceipt",
      "itemrcpt",
      "vendorbill",
      "vendbill",
      "creditmemo",
      "custcred",
      "cashsale",
      "cashrefund",
      "customerpayment",
      "vendorpayment",
      "inventoryadjustment",
      "inventorytransfer",
      "transferorder",
      "returnauthorization",
      "vendorreturnauthorization",
    ].includes(value)
  }

  function transactionSummary(id) {
    let summary = { id: String(id), type: "transaction" }
    search
      .create({
        type: search.Type.TRANSACTION,
        filters: [["internalid", "anyof", id], "AND", ["mainline", "is", "T"]],
        columns: ["internalid", "type", "tranid", "statusref", "createdfrom"],
      })
      .run()
      .each((result) => {
        summary = {
          id: String(result.id),
          type: String(result.getValue({ name: "type" }) || "transaction"),
          tranId: result.getValue({ name: "tranid" }),
          status: result.getValue({ name: "statusref" }),
          createdFrom: result.getValue({ name: "createdfrom" }),
        }
        return false
      })
    return summary
  }

  function relationshipProbes(id) {
    const relationships = []
    const probes = [
      { field: "createdfrom", relation: "createdFrom" },
      { field: "appliedtotransaction", relation: "appliedTo" },
      { field: "applyingtransaction", relation: "appliedBy" },
    ]
    probes.forEach((probe) => {
      try {
        search
          .create({
            type: search.Type.TRANSACTION,
            filters: [[probe.field, "anyof", id], "AND", ["mainline", "is", "T"]],
            columns: ["internalid", "type"],
          })
          .run()
          .each((result) => {
            relationships.push({
              id: String(result.id),
              type: String(result.getValue({ name: "type" }) || "transaction"),
              relation: probe.relation,
            })
            return relationships.length < 250
          })
      } catch (_) {
        // Unsupported joins vary by account; available probes still form a partial graph.
      }
    })
    return uniqueRelationships(relationships)
  }

  function describeField(instance, fieldId) {
    const field = instance.getField({ fieldId })
    return {
      id: fieldId,
      label: field ? field.label : fieldId,
      type: field ? field.type : null,
      mandatory: field ? field.isMandatory : null,
      displayType: field ? field.displayType : null,
    }
  }

  function uniqueRelationships(values) {
    const seen = new Set()
    return values.filter((value) => {
      const key = `${value.relation}:${value.type}:${value.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function requirePreview(actionRequest) {
    if (actionRequest.phase !== "preview") {
      throw createError("INVALID_PHASE", `${actionRequest.action} only supports preview`)
    }
  }

  function identifier(payload, fieldId) {
    const value = text(payload, fieldId)
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
      throw createError("INVALID_IDENTIFIER", `${fieldId} is not a valid NetSuite identifier`)
    }
    return value
  }

  function text(payload, fieldId) {
    const value = payload?.[fieldId]
    if (typeof value !== "string" || value.length === 0) {
      throw createError("MISSING_TEXT", `${fieldId} must be a non-empty string`)
    }
    return value
  }

  function stringArray(payload, fieldId, max) {
    const values = array(payload[fieldId])
    if (
      values.length === 0 ||
      values.length > max ||
      values.some((value) => typeof value !== "string")
    ) {
      throw createError("INVALID_ARRAY", `${fieldId} must contain 1-${max} strings`)
    }
    return values.map((value) => identifier({ value }, "value"))
  }

  function array(value) {
    return Array.isArray(value) ? value : []
  }

  function boundedInteger(value, min, max, fallback) {
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback
  }

  function errorText(error) {
    return error?.message ? String(error.message) : String(error)
  }

  function createError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

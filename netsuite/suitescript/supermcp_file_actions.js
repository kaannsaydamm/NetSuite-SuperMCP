/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/file", "N/record", "N/search"], (nsError, file, record, search) => {
  const FILE_ACTIONS = {
    ns_copyFile: copyFileAction,
    ns_createFolder: createFolder,
    ns_deleteFile: deleteFileAction,
    ns_deleteFolder: deleteFolder,
    ns_listFileCabinet: listFileCabinet,
    ns_moveFile: moveFile,
    ns_updateFolder: updateFolder,
    ns_writeFile: writeFile,
  }

  function run(actionRequest) {
    const handler = FILE_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
  }

  function listFileCabinet(actionRequest) {
    const payload = actionRequest.payload
    const folderRef = resolveListFolder(payload)
    const maxEntries = optionalLimit(payload, "maxEntries", "limit", 200, 1, 1000)
    const query = optionalText(payload, "query")
    if (folderRef.notFound) {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        folder: null,
        path: folderRef.path,
        notFound: true,
        files: [],
        folders: [],
        maxEntries,
      }
    }

    const folderId = folderRef.id
    const folderFilters = folderId === null ? [] : [["parent", "anyof", String(folderId)]]
    const fileFilters = folderId === null ? [] : [["folder", "anyof", String(folderId)]]
    const folderQueryFilters = query ? [["name", "contains", query]] : []
    const fileQueryFilters = query ? [["name", "contains", query]] : []
    const folders = runObjectSearch(
      "folder",
      combineFilters(folderFilters, folderQueryFilters),
      ["internalid", "name", "parent"],
      maxEntries,
    )
    const files = runObjectSearch(
      "file",
      combineFilters(fileFilters, fileQueryFilters),
      ["internalid", "name", "folder", "filetype", "documentsize", "url", "modified"],
      maxEntries,
    )

    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      folder: folderId === null ? null : { id: String(folderId), path: folderRef.path },
      files,
      folders,
      maxEntries,
    }
  }

  function createFolder(actionRequest) {
    const payload = actionRequest.payload
    const name = requireText(payload, "name")
    const parent = optionalPositiveInt(payload, "parent")
    const confirmation = `createFolder:${parent === null ? "root" : parent}:${name}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        folder: { name, parent },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    const folder = record.create({ type: record.Type.FOLDER })
    folder.setValue({ fieldId: "name", value: name })
    if (parent !== null) {
      folder.setValue({ fieldId: "parent", value: parent })
    }
    const id = folder.save()
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      folder: { id: String(id), name, parent },
      confirmation,
    }
  }

  function updateFolder(actionRequest) {
    const payload = actionRequest.payload
    const folderId = requirePositiveInt(payload, "folderId")
    const confirmation = `updateFolder:${folderId}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        folder: { id: String(folderId) },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    const values = {}
    const name = optionalText(payload, "name")
    const parent = optionalPositiveInt(payload, "parent")
    if (name !== null) {
      values.name = name
    }
    if (parent !== null) {
      values.parent = parent
    }
    if (Object.keys(values).length === 0) {
      throw createRequestError("INVALID_VALUES", "name or parent must be provided")
    }
    record.submitFields({ type: record.Type.FOLDER, id: folderId, values })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      folder: { id: String(folderId), values },
      confirmation,
    }
  }

  function deleteFolder(actionRequest) {
    const payload = actionRequest.payload
    const folderId = requirePositiveInt(payload, "folderId")
    const confirmation = `deleteFolder:${folderId}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        folder: { id: String(folderId) },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    record.delete({ type: record.Type.FOLDER, id: folderId })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      deleted: true,
      folder: { id: String(folderId) },
      confirmation,
    }
  }

  function writeFile(actionRequest) {
    const payload = actionRequest.payload
    const target = resolveTarget(payload)
    const contents = requireText(payload, "contents")
    const description = optionalText(payload, "description")
    const encoding = optionalText(payload, "encoding")
    const isOnline = optionalBoolean(payload, "isOnline")
    const confirmation = writeConfirmation(target)

    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        file: target.file,
        contentLength: contents.length,
        confirmation,
      }
    }

    const requestedConfirmation = requireText(payload, "confirmation")
    if (requestedConfirmation !== confirmation) {
      throw createRequestError("CONFIRMATION_MISMATCH", `confirmation must match ${confirmation}`)
    }

    const nextFile = file.create({
      name: target.file.name,
      fileType: target.file.fileType,
      contents,
      folder: Number(target.file.folder),
      ...(description === null ? {} : { description }),
      ...(encoding === null ? {} : { encoding }),
      ...(isOnline === null ? {} : { isOnline }),
    })
    const id = nextFile.save()
    const savedFile = file.load({ id })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      saved: true,
      file: {
        id: String(id),
        name: savedFile.name,
        fileType: savedFile.fileType,
        folder: savedFile.folder,
        size: savedFile.size,
      },
      contentLength: contents.length,
      confirmation,
    }
  }

  function copyFileAction(actionRequest) {
    const payload = actionRequest.payload
    const sourceId = requireFileId(payload, "fileId")
    const loadedFile = file.load({ id: sourceId })
    const targetFolder = requirePositiveInt(payload, "targetFolderId")
    const name = optionalText(payload, "name") || loadedFile.name
    const confirmation = `copyFile:${sourceId}:${targetFolder}:${name}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        file: { id: String(sourceId), name: loadedFile.name, targetFolder, targetName: name },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    const copiedFile = file.create({
      name,
      fileType: loadedFile.fileType,
      contents: loadedFile.getContents(),
      folder: targetFolder,
    })
    const id = copiedFile.save()
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      file: { id: String(id), name },
      confirmation,
    }
  }

  function moveFile(actionRequest) {
    const payload = actionRequest.payload
    const fileId = requireFileId(payload, "fileId")
    const loadedFile = file.load({ id: fileId })
    const targetFolder = requirePositiveInt(payload, "targetFolderId")
    const confirmation = `moveFile:${fileId}:${targetFolder}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        file: {
          id: String(fileId),
          name: loadedFile.name,
          folder: loadedFile.folder,
          targetFolder,
        },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    loadedFile.folder = targetFolder
    const id = loadedFile.save()
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      file: { id: String(id), targetFolder },
      confirmation,
    }
  }

  function deleteFileAction(actionRequest) {
    const payload = actionRequest.payload
    const fileId = requireFileId(payload, "fileId")
    const loadedFile = file.load({ id: fileId })
    const confirmation = `deleteFile:${fileId}`
    if (actionRequest.phase === "prepare" || actionRequest.phase === "preview") {
      return {
        action: actionRequest.action,
        phase: actionRequest.phase,
        file: { id: String(fileId), name: loadedFile.name, folder: loadedFile.folder },
        confirmation,
      }
    }
    requireConfirmation(payload, confirmation)
    file.delete({ id: fileId })
    return {
      action: actionRequest.action,
      phase: actionRequest.phase,
      deleted: true,
      file: { id: String(fileId) },
      confirmation,
    }
  }

  function resolveTarget(payload) {
    const fileId = optionalFileId(payload, "fileId")
    if (fileId !== null) {
      const loadedFile = file.load({ id: fileId })
      return {
        file: {
          id: String(fileId),
          name: loadedFile.name,
          fileType: loadedFile.fileType,
          folder: loadedFile.folder,
          size: loadedFile.size,
        },
      }
    }

    const name = requireText(payload, "name")
    const folder = requirePositiveInt(payload, "folderId")
    const fileTypeName = optionalText(payload, "fileType") || "JAVASCRIPT"
    const fileType = file.Type[fileTypeName]
    if (!fileType) {
      throw createRequestError("INVALID_FILE_TYPE", `Unsupported fileType: ${fileTypeName}`)
    }
    return {
      file: {
        name,
        fileType,
        folder,
      },
    }
  }

  function writeConfirmation(target) {
    const idOrName = target.file.id || `${target.file.folder}:${target.file.name}`
    return `writeFile:${idOrName}`
  }

  function resolveListFolder(payload) {
    const folderId = optionalSignedInt(payload, "folderId")
    const path = optionalText(payload, "path")
    if (folderId !== null && path !== null) {
      throw createRequestError("INVALID_FOLDER_TARGET", "Use either folderId or path, not both")
    }
    if (path === null || path.length === 0 || path === "/") {
      return { id: folderId, path: path || null, notFound: false }
    }
    const resolvedId = resolveFolderPath(path)
    if (resolvedId === null) {
      return { id: null, path, notFound: true }
    }
    return { id: resolvedId, path, notFound: false }
  }

  function resolveFolderPath(path) {
    const parts = path
      .split(/[\\/]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
    if (parts.length === 0) {
      return null
    }
    let parentId = null
    for (const part of parts) {
      const nextId = findChildFolderId(parentId, part)
      if (nextId === null) {
        return null
      }
      parentId = nextId
    }
    return parentId
  }

  function findChildFolderId(parentId, name) {
    const filters = [["name", "is", name]]
    if (parentId !== null) {
      filters.push("AND", ["parent", "anyof", String(parentId)])
    }
    const rows = runObjectSearch("folder", filters, ["internalid", "name", "parent"], 1)
    return rows.length === 0 ? null : Number(rows[0].id)
  }

  function runObjectSearch(type, filters, columns, maxEntries) {
    const loadedSearch = search.create({ type, filters, columns })
    const rows = []
    loadedSearch.run().each((result) => {
      rows.push(serializeSearchResult(result, loadedSearch.columns))
      return rows.length < maxEntries
    })
    return rows
  }

  function combineFilters(left, right) {
    if (left.length === 0) {
      return right
    }
    if (right.length === 0) {
      return left
    }
    return [left[0], "AND", right[0]]
  }

  function serializeSearchResult(result, columns) {
    const values = {}
    for (const column of columns) {
      values[columnKey(column)] = { value: result.getValue(column), text: result.getText(column) }
    }
    return { id: result.id, recordType: result.recordType, values }
  }

  function columnKey(column) {
    return [column.join, column.name, column.summary, column.label].filter(Boolean).join(".")
  }

  function requireText(payload, fieldId) {
    const value = payload[fieldId]
    if (typeof value !== "string" || value.length === 0) {
      throw createRequestError("MISSING_TEXT", `${fieldId} must be a non-empty string`)
    }
    return value
  }

  function optionalText(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return null
    }
    if (typeof value !== "string") {
      throw createRequestError("INVALID_TEXT", `${fieldId} must be a string`)
    }
    return value
  }

  function optionalBoolean(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return null
    }
    if (typeof value !== "boolean") {
      throw createRequestError("INVALID_BOOLEAN", `${fieldId} must be a boolean`)
    }
    return value
  }

  function optionalFileId(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return null
    }
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value
    }
    if (typeof value === "string" && value.length > 0) {
      return value
    }
    throw createRequestError("INVALID_FILE_ID", `${fieldId} must be a file internal ID or path`)
  }

  function requireFileId(payload, fieldId) {
    const value = optionalFileId(payload, fieldId)
    if (value !== null) {
      return value
    }
    throw createRequestError("MISSING_FILE_ID", `${fieldId} must be a file internal ID or path`)
  }

  function optionalPositiveInt(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return null
    }
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value
    }
    if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
      return Number(value)
    }
    throw createRequestError("INVALID_ID", `${fieldId} must be a positive internal ID`)
  }

  function optionalSignedInt(payload, fieldId) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return null
    }
    if (typeof value === "number" && Number.isInteger(value) && value !== 0) {
      return value
    }
    if (typeof value === "string" && /^-?[1-9]\d*$/.test(value)) {
      return Number(value)
    }
    throw createRequestError("INVALID_ID", `${fieldId} must be a non-zero internal ID`)
  }

  function requirePositiveInt(payload, fieldId) {
    const value = optionalPositiveInt(payload, fieldId)
    if (value !== null) {
      return value
    }
    throw createRequestError("MISSING_ID", `${fieldId} must be a positive internal ID`)
  }

  function optionalIntInRange(payload, fieldId, defaultValue, minValue, maxValue) {
    const value = payload[fieldId]
    if (value === undefined || value === null) {
      return defaultValue
    }
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= minValue &&
      value <= maxValue
    ) {
      return value
    }
    throw createRequestError(
      "INVALID_INT",
      `${fieldId} must be an integer between ${minValue} and ${maxValue}`,
    )
  }

  function optionalLimit(payload, primaryFieldId, aliasFieldId, defaultValue, minValue, maxValue) {
    const primaryValue = payload[primaryFieldId]
    const aliasValue = payload[aliasFieldId]
    if (primaryValue !== undefined && aliasValue !== undefined && primaryValue !== aliasValue) {
      throw createRequestError(
        "INVALID_LIMIT",
        `${primaryFieldId} and ${aliasFieldId} must match when both are provided`,
      )
    }
    return optionalIntInRange(
      { [primaryFieldId]: primaryValue === undefined ? aliasValue : primaryValue },
      primaryFieldId,
      defaultValue,
      minValue,
      maxValue,
    )
  }

  function requireConfirmation(payload, expected) {
    if (payload.confirmation !== expected) {
      throw createRequestError("INVALID_CONFIRMATION", `confirmation must match ${expected}`)
    }
  }

  function createRequestError(name, message) {
    return nsError.create({ name, message, notifyOff: false })
  }

  return { run }
})

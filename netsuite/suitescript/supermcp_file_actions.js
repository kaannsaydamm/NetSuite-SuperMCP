/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(["N/error", "N/file"], (nsError, file) => {
  const FILE_ACTIONS = {
    ns_writeFile: writeFile,
  }

  function run(actionRequest) {
    const handler = FILE_ACTIONS[actionRequest.action]
    return handler ? handler(actionRequest) : null
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

  function requirePositiveInt(payload, fieldId) {
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

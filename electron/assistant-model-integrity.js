export function hasValidAssistantModelIntegrityMetadata(model) {
  return Number.isSafeInteger(model?.size)
    && model.size > 0
    && typeof model.sha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(model.sha256)
    && !/^0+$/.test(model.sha256);
}

export function assistantModelIntegrityMatches(model, size, sha256) {
  return hasValidAssistantModelIntegrityMetadata(model)
    && size === model.size
    && sha256 === model.sha256;
}

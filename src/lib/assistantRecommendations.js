const GB = 1024 ** 3;

export function assessAssistantModel(model, hardware, webGPUAvailable) {
  if (!hardware || !Number.isFinite(hardware.totalMemory)) return 'unknown';
  if (model.requiresWebGPU && !webGPUAvailable) return 'unsupported';

  const totalGb = hardware.totalMemory / GB;
  const freeGb = Number.isFinite(hardware.freeMemory)
    ? hardware.freeMemory / GB
    : totalGb;
  if (totalGb < model.minRamGb) return 'unsupported';
  if (freeGb < model.minFreeRamGb || totalGb < model.recommendedRamGb) return 'caution';
  return 'recommended';
}

export function getBestAssistantModel(models, hardware, webGPUAvailable) {
  const qualityOrder = ['qwen3-1.7b', 'qwen3-0.6b', 'smollm2-360m'];
  return qualityOrder.find((key) => {
    const model = models[key];
    return model && assessAssistantModel(model, hardware, webGPUAvailable) === 'recommended';
  }) || qualityOrder.find((key) => {
    const model = models[key];
    return model && assessAssistantModel(model, hardware, webGPUAvailable) === 'caution';
  }) || null;
}

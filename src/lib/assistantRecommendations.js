const GB = 1024 ** 3;

// Modèles locaux supportés avec leurs exigences matérielles estimées.
// Ces valeurs sont basées sur les exigences recommandées de Hugging Face
// et les tests de performance sur des configurations typiques.
// Les modèles sont classés par qualité décroissante.
const MODEL_SPECS = {
  // Modèles 3B+ : peuvent tourner en WASM/WebGPU selon l'environnement
  'qwen3-1.7b': {
    minRamGb: 2,
    recommendedRamGb: 4,
    requiresWebGPU: false,
    quality: 'excellent',
  },
  'phi3': {
    minRamGb: 2,
    recommendedRamGb: 4,
    requiresWebGPU: false,
    quality: 'excellent',
  },
  'llama3-8b': {
    minRamGb: 2.5,
    recommendedRamGb: 5,
    requiresWebGPU: false,
    quality: 'excellent',
  },
  'gemma2-9b': {
    minRamGb: 2.5,
    recommendedRamGb: 5,
    requiresWebGPU: false,
    quality: 'excellent',
  },
  // Modèles 1-2B : peuvent tourner sur WASM seul ou WebGPU optionnel
  'qwen3-0.6b': {
    minRamGb: 0.8,
    recommendedRamGb: 1.5,
    requiresWebGPU: false,
    quality: 'bon',
  },
  'smollm2-360m': {
    minRamGb: 0.4,
    recommendedRamGb: 0.8,
    requiresWebGPU: false,
    quality: 'basique',
  },
  // Nouveaux modèles ajoutés ci-dessous
  'llama2-7b': {
    minRamGb: 2,
    recommendedRamGb: 4,
    requiresWebGPU: false,
    quality: 'bon',
  },
  'gemma-2b': {
    minRamGb: 1.5,
    recommendedRamGb: 3,
    requiresWebGPU: false,
    quality: 'bon',
  },
};

// Nom humain lisible pour chaque modèle (utilisé aussi bien que labelKey i18n)
const MODEL_LABELS = {
  'qwen3-1.7b': 'Qwen3 1.7B',
  'phi3': 'Phi 3',
  'llama3-8b': 'Llama 3 8B',
  'gemma2-9b': 'Gemma 2 9B',
  'qwen3-0.6b': 'Qwen3 0.6B',
  'smollm2-360m': 'SmolLM2 360M',
  'llama2-7b': 'Llama 2 7B',
  'gemma-2b': 'Gemma 2B',
};

// Ordre de qualité pour le choix automatique du meilleur modèle
const QUALITY_ORDER = [
  'qwen3-1.7b',
  'phi3',
  'llama3-8b',
  'gemma2-9b',
  'llama2-7b',
  'qwen3-0.6b',
  'gemma-2b',
  'smollm2-360m',
];

// Nouveaux helpers
export function getModelSpec(modelKey) {
  return MODEL_SPECS[modelKey] || null;
}

export function getModelLabel(modelKey) {
  return MODEL_LABELS[modelKey] || modelKey;
}

export function getModelInfo(modelKey) {
  const spec = getModelSpec(modelKey);
  if (!spec) return null;
  return {
    key: modelKey,
    label: getModelLabel(modelKey),
    quality: spec?.quality,
    minRamGb: spec?.minRamGb,
    recommendedRamGb: spec?.recommendedRamGb,
    requiresWebGPU: spec?.requiresWebGPU,
  };
}

// Évalue un modèle selon ses spécifications matérielles.
// Accepte deux formats de modèle :
// 1. Objet avec propriété .key ou .id ou .modelKey correspondant à une clé MODEL_SPECS
// 2. Objet brut avec minRamGb, recommendedRamGb, minFreeRamGb, requiresWebGPU directement dedans
export function assessAssistantModel(model, hardware, webGPUAvailable) {
  if (!model || !hardware || !Number.isFinite(hardware.totalMemory)) return 'unknown';

  // Essayer d'abord avec la nouvelle spécification par clé
  const specKey = model.key || model.id || model.modelKey;
  const spec = (specKey && getModelSpec(specKey)) || model;
  const totalGb = hardware.totalMemory / GB;
  const freeGb = Number.isFinite(hardware.freeMemory)
    ? hardware.freeMemory / GB
    : totalGb;

  if (spec.requiresWebGPU && !webGPUAvailable) return 'unsupported';
  if (spec.minRamGb !== undefined && totalGb < spec.minRamGb * 0.7) return 'unsupported';

  if (
    (spec.minFreeRamGb !== undefined && freeGb < spec.minFreeRamGb) ||
    (spec.recommendedRamGb !== undefined && totalGb < spec.recommendedRamGb)
  ) {
    return 'caution';
  }

  return 'recommended';
}

// Trouve le meilleur modèle installé selon la qualité
export function getBestAssistantModel(models, hardware, webGPUAvailable) {
  if (!models) return null;
  // Essayer d'abord par ordre de qualité
  const recommended = QUALITY_ORDER.find((key) => {
    const model = models[key];
    return (
      model &&
      assessAssistantModel(model, hardware, webGPUAvailable) === 'recommended'
    );
  });
  if (recommended) return recommended;

  // En dernier recours, préférer le modèle de plus faible exigence mémoire.
  return QUALITY_ORDER.filter(
    (key) =>
      models[key] &&
      assessAssistantModel(models[key], hardware, webGPUAvailable) === 'caution'
  ).sort((a, b) => {
    const aSpec = getModelSpec(a) || models[a];
    const bSpec = getModelSpec(b) || models[b];
    return (aSpec.minRamGb ?? Infinity) - (bSpec.minRamGb ?? Infinity);
  })[0] || null;
}

// Nouveau : trouve un modèle compatible avec les contraintes actuelles
export function getCompatibleAssistantModel(models, hardware, webGPUAvailable) {
  if (!models) return null;
  return QUALITY_ORDER.find((key) => {
    const model = models[key];
    return (
      model &&
      assessAssistantModel(model, hardware, webGPUAvailable) !== 'unsupported'
    );
  }) || null;
}

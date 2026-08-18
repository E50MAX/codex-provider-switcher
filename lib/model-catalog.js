'use strict';

const CUSTOM_MODEL_IDS = Object.freeze([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna'
]);
const DEFAULT_CUSTOM_MODEL = 'gpt-5.6-sol';
const CUSTOM_DISPLAY_PREFIX = '中转 · ';

function isCatalogModel(model) {
  return model
    && typeof model === 'object'
    && !Array.isArray(model)
    && typeof model.slug === 'string'
    && CUSTOM_MODEL_IDS.includes(model.slug);
}

function supportedEfforts(model) {
  if (!Array.isArray(model?.supported_reasoning_levels)) {
    return [];
  }
  return model.supported_reasoning_levels
    .map((level) => level?.effort)
    .filter((effort) => typeof effort === 'string' && effort.length > 0);
}

function buildCustomModelCatalog(cache) {
  if (!cache || typeof cache !== 'object' || !Array.isArray(cache.models)) {
    throw new Error('Codex 官方模型缓存格式无效');
  }

  const sourceModels = cache.models.filter(isCatalogModel);
  if (sourceModels.length === 0) {
    throw new Error('官方模型缓存中没有可用于中转站的 Sol、Terra 或 Luna 模型');
  }

  const models = sourceModels.map((template, index) => {
    const model = JSON.parse(JSON.stringify(template));
    const displayName = String(template.display_name || template.slug)
      .replace(/^(?:中转 · )+/, '');
    model.display_name = `${CUSTOM_DISPLAY_PREFIX}${displayName}`;
    model.description = `通过当前自定义 Responses API 使用 ${template.slug}`;
    model.visibility = 'list';
    model.supported_in_api = true;
    model.priority = index + 1;
    model.additional_speed_tiers = [];
    model.service_tiers = [];
    model.availability_nux = null;
    model.upgrade = null;
    return model;
  });

  return { models };
}

function resolveAccountSelection(cache, existing = {}) {
  const models = Array.isArray(cache?.models)
    ? cache.models.filter((model) => model && typeof model === 'object' && !Array.isArray(model))
    : [];
  const requestedModel = typeof existing.model === 'string' ? existing.model : undefined;
  const selectedModel = models.find((model) => model.slug === requestedModel);

  if (!selectedModel) {
    return {
      selection: {
        model: undefined,
        reviewModel: undefined,
        modelReasoningEffort: undefined,
        serviceTier: undefined,
        modelCatalogJson: existing.modelCatalogJson
      },
      adjusted: Boolean(
        existing.model
        || existing.reviewModel
        || existing.modelReasoningEffort
        || existing.serviceTier
      )
    };
  }

  const reviewModel = models.some((model) => model.slug === existing.reviewModel)
    ? existing.reviewModel
    : selectedModel.slug;
  const efforts = supportedEfforts(selectedModel);
  const requestedEffort = typeof existing.modelReasoningEffort === 'string'
    ? existing.modelReasoningEffort.toLowerCase()
    : undefined;
  const defaultEffort = typeof selectedModel.default_reasoning_level === 'string'
    ? selectedModel.default_reasoning_level.toLowerCase()
    : undefined;
  const modelReasoningEffort = efforts.includes(requestedEffort)
    ? requestedEffort
    : efforts.includes(defaultEffort)
      ? defaultEffort
      : undefined;
  const supportedServiceTiers = new Set(['default']);
  for (const tier of Array.isArray(selectedModel.service_tiers) ? selectedModel.service_tiers : []) {
    const id = typeof tier === 'string' ? tier : tier?.id;
    if (typeof id === 'string' && id.length > 0) {
      supportedServiceTiers.add(id);
    }
  }
  const serviceTier = typeof existing.serviceTier === 'string'
    && supportedServiceTiers.has(existing.serviceTier)
    ? existing.serviceTier
    : undefined;
  const selection = {
    model: selectedModel.slug,
    reviewModel,
    modelReasoningEffort,
    serviceTier,
    modelCatalogJson: existing.modelCatalogJson
  };

  return {
    selection,
    adjusted: selection.model !== existing.model
      || selection.reviewModel !== existing.reviewModel
      || selection.modelReasoningEffort !== existing.modelReasoningEffort
      || selection.serviceTier !== existing.serviceTier
  };
}

function resolveCustomSelection(catalog, existing = {}) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  if (models.length === 0) {
    throw new Error('自定义模型目录为空');
  }

  const requestedModel = typeof existing.model === 'string' ? existing.model : undefined;
  const selectedModel = models.find((model) => model.slug === requestedModel)
    || models.find((model) => model.slug === DEFAULT_CUSTOM_MODEL)
    || models[0];
  const efforts = supportedEfforts(selectedModel);
  const requestedEffort = typeof existing.modelReasoningEffort === 'string'
    ? existing.modelReasoningEffort.toLowerCase()
    : undefined;
  const defaultEffort = typeof selectedModel.default_reasoning_level === 'string'
    ? selectedModel.default_reasoning_level.toLowerCase()
    : undefined;
  const modelReasoningEffort = efforts.includes(requestedEffort)
    ? requestedEffort
    : efforts.includes(defaultEffort)
      ? defaultEffort
      : undefined;

  return {
    model: selectedModel.slug,
    reviewModel: selectedModel.slug,
    modelReasoningEffort
  };
}

module.exports = {
  CUSTOM_MODEL_IDS,
  DEFAULT_CUSTOM_MODEL,
  buildCustomModelCatalog,
  resolveAccountSelection,
  resolveCustomSelection,
  supportedEfforts
};

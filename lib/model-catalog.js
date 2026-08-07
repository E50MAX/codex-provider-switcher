'use strict';

const CUSTOM_MODEL_IDS = Object.freeze([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna'
]);
const DEFAULT_CUSTOM_MODEL = 'gpt-5.6-sol';
const DEFAULT_REASONING_EFFORT = 'max';
const REASONING_FALLBACK_ORDER = Object.freeze([
  'max',
  'xhigh',
  'high',
  'medium',
  'low',
  'minimal',
  'ultra'
]);

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
    model.display_name = `中转 · ${template.display_name || template.slug}`;
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
  const modelReasoningEffort = efforts.includes(requestedEffort)
    ? requestedEffort
    : REASONING_FALLBACK_ORDER.find((effort) => efforts.includes(effort));

  return {
    model: selectedModel.slug,
    reviewModel: selectedModel.slug,
    modelReasoningEffort: modelReasoningEffort || DEFAULT_REASONING_EFFORT
  };
}

module.exports = {
  CUSTOM_MODEL_IDS,
  DEFAULT_CUSTOM_MODEL,
  DEFAULT_REASONING_EFFORT,
  buildCustomModelCatalog,
  resolveCustomSelection,
  supportedEfforts
};

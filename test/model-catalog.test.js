'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCustomModelCatalog,
  resolveAccountSelection,
  resolveCustomSelection,
  supportedEfforts
} = require('../lib/model-catalog');

function model(slug, efforts, visibility = 'list') {
  return {
    slug,
    display_name: slug.toUpperCase(),
    visibility,
    supported_in_api: false,
    context_window: 272000,
    max_context_window: 272000,
    effective_context_window_percent: 95,
    supported_reasoning_levels: efforts.map((effort) => ({ effort, description: effort })),
    service_tiers: [{ slug: 'fast' }],
    upgrade: { model: 'other' }
  };
}

test('builds a visible custom catalog for the three supported relay models', () => {
  const catalog = buildCustomModelCatalog({
    models: [
      model('gpt-5.6-sol', ['low', 'medium', 'max', 'ultra']),
      model('gpt-5.6-sol-wm', ['low', 'max'], 'hide'),
      model('gpt-5.6-terra', ['medium', 'high', 'max']),
      model('gpt-5.6-luna', ['low', 'high', 'max']),
      model('gpt-5.5', ['medium', 'high'])
    ]
  });

  assert.deepEqual(catalog.models.map((item) => item.slug), [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna'
  ]);
  assert.ok(catalog.models.every((item) => item.visibility === 'list'));
  assert.ok(catalog.models.every((item) => item.supported_in_api === true));
  assert.ok(catalog.models.every((item) => item.display_name.startsWith('中转 · ')));
  assert.deepEqual(catalog.models[0].service_tiers, []);
  assert.equal(catalog.models[0].upgrade, null);
  assert.equal(catalog.models[0].context_window, 272000);
  assert.equal(catalog.models[0].effective_context_window_percent, 95);
  assert.deepEqual(supportedEfforts(catalog.models[0]), ['low', 'medium', 'max', 'ultra']);
});

test('keeps the selected model and effort when supported', () => {
  const catalog = buildCustomModelCatalog({
    models: [
      model('gpt-5.6-sol', ['low', 'medium', 'max', 'ultra']),
      model('gpt-5.6-terra', ['low', 'high', 'max'])
    ]
  });
  assert.deepEqual(resolveCustomSelection(catalog, {
    model: 'gpt-5.6-terra',
    modelReasoningEffort: 'high'
  }), {
    model: 'gpt-5.6-terra',
    reviewModel: 'gpt-5.6-terra',
    modelReasoningEffort: 'high'
  });
});

test('defaults to Sol and Max without asking for model text', () => {
  const catalog = buildCustomModelCatalog({
    models: [
      model('gpt-5.6-terra', ['low', 'high', 'max']),
      model('gpt-5.6-sol', ['low', 'medium', 'max', 'ultra'])
    ]
  });
  assert.deepEqual(resolveCustomSelection(catalog), {
    model: 'gpt-5.6-sol',
    reviewModel: 'gpt-5.6-sol',
    modelReasoningEffort: 'max'
  });
});

test('rejects an empty or incompatible model cache', () => {
  assert.throws(() => buildCustomModelCatalog({ models: [] }));
  assert.throws(() => buildCustomModelCatalog({ models: [model('gpt-5.5', ['high'])] }));
});

test('reuses a saved relay catalog without duplicating its display prefix', () => {
  const first = buildCustomModelCatalog({
    models: [model('gpt-5.6-sol', ['low', 'max'])]
  });
  const second = buildCustomModelCatalog(first);
  assert.equal(second.models[0].display_name, first.models[0].display_name);
});

test('keeps account model settings only when the current account catalog supports them', () => {
  const cache = {
    models: [{
      ...model('gpt-5.6-terra', ['low', 'high']),
      default_reasoning_level: 'low',
      service_tiers: [{ id: 'priority' }]
    }]
  };
  assert.deepEqual(resolveAccountSelection(cache, {
    model: 'gpt-5.6-terra',
    reviewModel: 'gpt-5.6-terra',
    modelReasoningEffort: 'high',
    serviceTier: 'priority'
  }), {
    selection: {
      model: 'gpt-5.6-terra',
      reviewModel: 'gpt-5.6-terra',
      modelReasoningEffort: 'high',
      serviceTier: 'priority',
      modelCatalogJson: undefined
    },
    adjusted: false
  });
});

test('drops stale account-only settings after login changes', () => {
  const cache = {
    models: [{
      ...model('gpt-5.6-sol', ['low', 'medium']),
      default_reasoning_level: 'medium',
      service_tiers: []
    }]
  };
  assert.deepEqual(resolveAccountSelection(cache, {
    model: 'gpt-5.6-sol',
    reviewModel: 'gpt-5.6-terra',
    modelReasoningEffort: 'max',
    serviceTier: 'priority'
  }), {
    selection: {
      model: 'gpt-5.6-sol',
      reviewModel: 'gpt-5.6-sol',
      modelReasoningEffort: 'medium',
      serviceTier: undefined,
      modelCatalogJson: undefined
    },
    adjusted: true
  });

  assert.deepEqual(resolveAccountSelection(cache, {
    model: 'gpt-5.6-terra',
    reviewModel: 'gpt-5.6-terra',
    modelReasoningEffort: 'high',
    serviceTier: 'priority',
    modelCatalogJson: 'account-models.json'
  }), {
    selection: {
      model: undefined,
      reviewModel: undefined,
      modelReasoningEffort: undefined,
      serviceTier: undefined,
      modelCatalogJson: 'account-models.json'
    },
    adjusted: true
  });
});

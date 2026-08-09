'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { patchSharedHistorySource } = require('../lib/history-patch');

test('patches direct and conditional provider history filters', () => {
  const source = [
    'thread/list',
    'modelProviders:null',
    'modelProviders:e?[PR]:null',
    'modelProviders:[]'
  ].join(';');
  const result = patchSharedHistorySource(source);

  assert.equal(result.status, 'patched');
  assert.equal(result.replacementCount, 2);
  assert.equal(
    result.source,
    'thread/list;modelProviders:[];modelProviders:[];modelProviders:[]'
  );
});

test('recognizes native all-provider queries', () => {
  assert.deepEqual(patchSharedHistorySource('thread/list;modelProviders:[]'), {
    status: 'already-supported',
    supportedCount: 1
  });
});

test('normalizes a partially repaired conditional query to all providers', () => {
  const result = patchSharedHistorySource('thread/list;modelProviders:e?[PR]:[]');
  assert.equal(result.status, 'patched');
  assert.equal(result.replacementCount, 1);
  assert.equal(result.source, 'thread/list;modelProviders:[]');
});

test('refuses unknown history query structures', () => {
  assert.equal(patchSharedHistorySource('modelProviders:null').status, 'unsupported');
  assert.equal(patchSharedHistorySource('thread/list;modelProviders:activeProviders').status, 'unsupported');
  assert.equal(
    patchSharedHistorySource('thread/list;modelProviders:[];modelProviders:e?[PR]:undefined').status,
    'unsupported'
  );
  assert.equal(
    patchSharedHistorySource('thread/list;modelProviders:null;modelProviders:[PR]').status,
    'unsupported'
  );
  assert.equal(
    patchSharedHistorySource(`thread/list;${'modelProviders:null;'.repeat(65)}`).status,
    'unsupported'
  );
});

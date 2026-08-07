'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { patchMaxVisibilitySource } = require('../lib/max-patch');

const marker = 'hasModelSupportingMaxReasoningEffort';
const unpatchedFilter = '.filter(({reasoningEffort:e})=>cr(e)&&i.has(e))';
const patchedFilter = '.filter(({reasoningEffort:e})=>cr(e)&&(i.has(e)||e===`max`))';

test('patches exactly one known Max filter', () => {
  const result = patchMaxVisibilitySource(`${marker};${unpatchedFilter}`);
  assert.equal(result.status, 'patched');
  assert.equal(result.source, `${marker};${patchedFilter}`);
});

test('recognizes an already patched filter', () => {
  assert.deepEqual(patchMaxVisibilitySource(`${marker};${patchedFilter}`), {
    status: 'already-patched'
  });
});

test('refuses unknown or ambiguous upstream structures', () => {
  assert.equal(patchMaxVisibilitySource(unpatchedFilter).status, 'unsupported');
  assert.equal(
    patchMaxVisibilitySource(`${marker};${unpatchedFilter};${unpatchedFilter}`).status,
    'unsupported'
  );
});

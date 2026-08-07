'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTopLevelValue } = require('../lib/config-text');

const managedBegin = '# >>> codex-provider-switcher: lab_relay >>>';

test('inserts top-level values before a leading managed provider block', () => {
  const original = [
    '',
    managedBegin,
    '[model_providers.lab_relay]',
    'base_url = "https://gateway.example.com/v1"',
    '# <<< codex-provider-switcher: lab_relay <<<',
    ''
  ].join('\n');
  let updated = setTopLevelValue(original, 'model_provider', 'lab_relay', managedBegin);
  updated = setTopLevelValue(updated, 'model', 'gpt-5.6-sol', managedBegin);

  assert.ok(updated.indexOf('model_provider = "lab_relay"') < updated.indexOf(managedBegin));
  assert.ok(updated.indexOf('model = "gpt-5.6-sol"') < updated.indexOf(managedBegin));
});

test('updates and removes only values in the real top-level section', () => {
  const original = [
    'model = "gpt-5.6-sol"',
    '',
    managedBegin,
    '[model_providers.lab_relay]',
    'model = "nested-value"',
    '# <<< codex-provider-switcher: lab_relay <<<'
  ].join('\n');
  const changed = setTopLevelValue(original, 'model', 'gpt-5.6-terra', managedBegin);
  const removed = setTopLevelValue(changed, 'model', undefined, managedBegin);

  assert.match(changed, /^model = "gpt-5\.6-terra"/);
  assert.doesNotMatch(removed, /^model =/);
  assert.match(removed, /model = "nested-value"/);
});

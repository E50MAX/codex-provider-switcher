'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { removeManagedBlock, setTopLevelValue } = require('../lib/config-text');

const managedBegin = '# >>> codex-provider-switcher: lab_relay >>>';
const managedEnd = '# <<< codex-provider-switcher: lab_relay <<<';

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

test('removes exactly one complete managed block without matching marker text inside values', () => {
  const original = [
    'note = "# >>> codex-provider-switcher: lab_relay >>>"',
    '',
    managedBegin,
    '[model_providers.lab_relay]',
    'base_url = "https://gateway.example.com/v1"',
    managedEnd,
    '',
    '[features]',
    'example = true'
  ].join('\n');
  const removed = removeManagedBlock(original, managedBegin, managedEnd);

  assert.match(removed, /^note = /);
  assert.doesNotMatch(removed, /^\s*\[model_providers\.lab_relay\]/m);
  assert.match(removed, /\[features\]/);
});

test('refuses missing, reversed, or duplicate managed markers', () => {
  assert.throws(
    () => removeManagedBlock(managedBegin, managedBegin, managedEnd),
    /标记异常/
  );
  assert.throws(
    () => removeManagedBlock(`${managedEnd}\n${managedBegin}`, managedBegin, managedEnd),
    /标记异常/
  );
  assert.throws(
    () => removeManagedBlock(
      `${managedBegin}\n${managedEnd}\n${managedBegin}\n${managedEnd}`,
      managedBegin,
      managedEnd
    ),
    /标记异常/
  );
});

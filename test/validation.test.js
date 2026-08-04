'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeApiKey,
  normalizeHeaderMap,
  normalizeHttpsBaseUrl,
  normalizeModelId
} = require('../lib/validation');

test('normalizes an HTTPS Base URL', () => {
  assert.deepEqual(normalizeHttpsBaseUrl(' https://gateway.example.com/v1/ '), {
    baseUrl: 'https://gateway.example.com/v1',
    host: 'gateway.example.com',
    origin: 'https://gateway.example.com'
  });
});
test('rejects insecure or ambiguous Base URLs', () => {
  const invalidUrls = [
    'http://gateway.example.com/v1',
    'https://user:password@gateway.example.com/v1',
    'https://gateway.example.com/v1?token=value',
    'https://gateway.example.com/v1#fragment',
    'https://gateway.example.com./v1'
  ];
  for (const value of invalidUrls) {
    assert.throws(() => normalizeHttpsBaseUrl(value));
  }
});

test('validates API keys without logging or transforming them', () => {
  assert.equal(normalizeApiKey('  test_key_123456  '), 'test_key_123456');
  assert.throws(() => normalizeApiKey('test key'));
  assert.throws(() => normalizeApiKey('test\nkey'));
  assert.throws(() => normalizeApiKey(''));
  assert.equal(normalizeApiKey('', { required: false }), '');
});

test('validates model IDs and header maps', () => {
  assert.equal(normalizeModelId('provider/model-v1'), 'provider/model-v1');
  assert.throws(() => normalizeModelId('provider model'));
  assert.deepEqual(normalizeHeaderMap({ 'X-Feature': 'enabled' }), { 'X-Feature': 'enabled' });
  assert.throws(() => normalizeHeaderMap({ 'Bad Header': 'value' }));
  assert.throws(() => normalizeHeaderMap({ 'X-Test': 'value\r\ninjected: true' }));
});

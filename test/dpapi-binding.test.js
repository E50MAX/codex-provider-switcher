'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const windowsTest = process.platform === 'win32' ? test : test.skip;

function runPowerShell(script, args, input = '') {
  return spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', script, ...args],
    { input, encoding: 'utf8', windowsHide: true }
  );
}

windowsTest('DPAPI key is bound to the configured HTTPS Base URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-provider-switcher-'));
  const saveScript = path.join(__dirname, '..', 'scripts', 'save-secret.ps1');
  const getScript = path.join(__dirname, '..', 'scripts', 'get-secret.ps1');
  const secretPath = path.join(root, 'api-key.v2.dpapi');
  const configPath = path.join(root, 'config.toml');
  const providerId = 'lab_relay';
  const trustedBaseUrl = 'https://gateway.example.com/v1';
  const otherBaseUrl = 'https://other.example.com/v1';
  const apiKey = 'test_key_1234567890';

  try {
    fs.writeFileSync(configPath, [
      `[model_providers.${providerId}]`,
      `base_url = ${JSON.stringify(trustedBaseUrl)}`,
      'wire_api = "responses"',
      ''
    ].join('\n'));

    const save = runPowerShell(
      saveScript,
      ['-SecretPath', secretPath, '-Binding', trustedBaseUrl],
      apiKey
    );
    assert.equal(save.status, 0, save.stderr);

    const read = runPowerShell(getScript, [
      '-SecretPath', secretPath,
      '-Binding', trustedBaseUrl,
      '-ConfigPath', configPath,
      '-ProviderId', providerId
    ]);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.stdout, apiKey);

    fs.writeFileSync(configPath, [
      `[model_providers.${providerId}]`,
      `base_url = ${JSON.stringify(otherBaseUrl)}`,
      'wire_api = "responses"',
      ''
    ].join('\n'));

    const tamperedConfig = runPowerShell(getScript, [
      '-SecretPath', secretPath,
      '-Binding', trustedBaseUrl,
      '-ConfigPath', configPath,
      '-ProviderId', providerId
    ]);
    assert.notEqual(tamperedConfig.status, 0);
    assert.equal(tamperedConfig.stdout, '');

    const changedBinding = runPowerShell(getScript, [
      '-SecretPath', secretPath,
      '-Binding', otherBaseUrl,
      '-ConfigPath', configPath,
      '-ProviderId', providerId
    ]);
    assert.notEqual(changedBinding.status, 0);
    assert.equal(changedBinding.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

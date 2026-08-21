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
  const managedBegin = `# >>> codex-provider-switcher: ${providerId} >>>`;
  const managedEnd = `# <<< codex-provider-switcher: ${providerId} <<<`;

  const writeConfig = (activeProvider, baseUrl, extraLines = []) => {
    fs.writeFileSync(configPath, [
      `model_provider = ${JSON.stringify(activeProvider)}`,
      '',
      managedBegin,
      `[model_providers.${providerId}]`,
      `base_url = ${JSON.stringify(baseUrl)}`,
      'wire_api = "responses"',
      ...extraLines,
      managedEnd,
      ''
    ].join('\n'));
  };

  try {
    writeConfig(providerId, trustedBaseUrl);

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

    const replacementApiKey = 'replacement_test_key_0987654321';
    const replace = runPowerShell(
      saveScript,
      ['-SecretPath', secretPath, '-Binding', trustedBaseUrl],
      replacementApiKey
    );
    assert.equal(replace.status, 0, replace.stderr);

    const readReplacement = runPowerShell(getScript, [
      '-SecretPath', secretPath,
      '-Binding', trustedBaseUrl,
      '-ConfigPath', configPath,
      '-ProviderId', providerId
    ]);
    assert.equal(readReplacement.status, 0, readReplacement.stderr);
    assert.equal(readReplacement.stdout, replacementApiKey);
    assert.deepEqual(
      fs.readdirSync(root).filter((name) => name.endsWith('.tmp') || name.endsWith('.bak')),
      []
    );

    writeConfig(providerId, otherBaseUrl);

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

    writeConfig('openai', trustedBaseUrl);
    const inactiveProvider = runPowerShell(getScript, [
      '-SecretPath', secretPath,
      '-Binding', trustedBaseUrl,
      '-ConfigPath', configPath,
      '-ProviderId', providerId
    ]);
    assert.notEqual(inactiveProvider.status, 0);
    assert.equal(inactiveProvider.stdout, '');

    writeConfig(providerId, trustedBaseUrl, [managedBegin]);
    const ambiguousMarkers = runPowerShell(getScript, [
      '-SecretPath', secretPath,
      '-Binding', trustedBaseUrl,
      '-ConfigPath', configPath,
      '-ProviderId', providerId
    ]);
    assert.notEqual(ambiguousMarkers.status, 0);
    assert.equal(ambiguousMarkers.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

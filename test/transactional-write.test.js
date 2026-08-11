'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { replaceVerified, writeVerifiedBatch } = require('../lib/transactional-write');

test('single verified write rolls back after post-write verification fails', async () => {
  let source = 'original';
  let writes = 0;
  let corruptNextRead = false;

  await assert.rejects(
    replaceVerified({
      filePath: 'asset',
      originalSource: 'original',
      patchedSource: 'patched',
      async readFile() {
        if (corruptNextRead) {
          corruptNextRead = false;
          return 'simulated-corrupt-read';
        }
        return source;
      },
      async writeFile(_filePath, nextSource) {
        source = nextSource;
        writes += 1;
        if (writes === 1) {
          corruptNextRead = true;
        }
      },
      verify: (value) => value === 'patched',
      verificationError: 'verification failed',
      rollbackConflictError: 'rollback conflict'
    }),
    /verification failed/
  );

  assert.equal(source, 'original');
  assert.equal(writes, 2);
});

test('verified batch rolls back earlier files when a later write fails', async () => {
  const sources = new Map([
    ['host', 'host-original'],
    ['webview', 'webview-original']
  ]);

  await assert.rejects(
    writeVerifiedBatch({
      targets: [
        { filePath: 'host', originalSource: 'host-original', patchedSource: 'host-patched' },
        { filePath: 'webview', originalSource: 'webview-original', patchedSource: 'webview-patched' }
      ],
      async readFile(filePath) {
        return sources.get(filePath);
      },
      async writeFile(filePath, nextSource) {
        if (filePath === 'webview') {
          throw new Error('simulated locked resource');
        }
        sources.set(filePath, nextSource);
      },
      verify: (value, target) => value === target.patchedSource,
      changedBeforeWriteError: 'changed before write',
      verificationError: 'verification failed',
      rollbackConflictError: 'rollback conflict'
    }),
    /simulated locked resource/
  );

  assert.equal(sources.get('host'), 'host-original');
  assert.equal(sources.get('webview'), 'webview-original');
});

test('verified batch refuses to overwrite an external change during rollback', async () => {
  const sources = new Map([
    ['host', 'host-original'],
    ['webview', 'webview-original']
  ]);

  await assert.rejects(
    writeVerifiedBatch({
      targets: [
        { filePath: 'host', originalSource: 'host-original', patchedSource: 'host-patched' },
        { filePath: 'webview', originalSource: 'webview-original', patchedSource: 'webview-patched' }
      ],
      async readFile(filePath) {
        return sources.get(filePath);
      },
      async writeFile(filePath, nextSource) {
        if (filePath === 'webview') {
          sources.set('host', 'external-change');
          throw new Error('simulated locked resource');
        }
        sources.set(filePath, nextSource);
      },
      verify: (value, target) => value === target.patchedSource,
      changedBeforeWriteError: 'changed before write',
      verificationError: 'verification failed',
      rollbackConflictError: 'rollback conflict'
    }),
    /回滚失败：rollback conflict/
  );

  assert.equal(sources.get('host'), 'external-change');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const extensionModulePath = require.resolve('../extension');
const ORIGINAL_HOST_SOURCE = 'thread/list;modelProviders:e?[PR]:null;modelProviders:[]';
const ORIGINAL_WEBVIEW_SOURCE = 'thread/list;modelProviders:null;modelProviders:null';

async function createFixture() {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-history-integration-'));
  const codexHome = path.join(temporaryRoot, 'codex-home');
  const officialRoot = path.join(temporaryRoot, 'official-codex');
  const hostPath = path.join(officialRoot, 'out', 'extension.js');
  const assetsPath = path.join(officialRoot, 'webview', 'assets');
  const webviewPath = path.join(assetsPath, 'app-initial-fixture.js');
  await fs.promises.mkdir(path.dirname(hostPath), { recursive: true });
  await fs.promises.mkdir(assetsPath, { recursive: true });
  await fs.promises.writeFile(hostPath, ORIGINAL_HOST_SOURCE, 'utf8');
  await fs.promises.writeFile(webviewPath, ORIGINAL_WEBVIEW_SOURCE, 'utf8');
  return { temporaryRoot, codexHome, officialRoot, hostPath, webviewPath };
}

function createGlobalState() {
  const values = new Map();
  return {
    values,
    get(key) {
      return values.get(key);
    },
    async update(key, value) {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
    }
  };
}

function createVscodeMock(fixture) {
  const commands = new Map();
  const warnings = [];
  const information = [];
  const settings = {
    autoPatchSharedHistory: true,
    autoReloadAfterSharedHistoryPatch: false,
    autoPatchMax: false
  };

  return {
    commands,
    warnings,
    information,
    api: {
      StatusBarAlignment: { Right: 1 },
      commands: {
        registerCommand(command, handler) {
          commands.set(command, handler);
          return { dispose() {} };
        },
        async executeCommand() {}
      },
      extensions: {
        getExtension(id) {
          if (id !== 'openai.chatgpt') {
            return undefined;
          }
          return {
            extensionPath: fixture.officialRoot,
            packageJSON: { version: 'fixture' }
          };
        },
        onDidChange() {
          return { dispose() {} };
        }
      },
      workspace: {
        getConfiguration() {
          return {
            get(key, fallback) {
              return Object.hasOwn(settings, key) ? settings[key] : fallback;
            }
          };
        }
      },
      window: {
        createStatusBarItem() {
          return { show() {}, dispose() {} };
        },
        setStatusBarMessage() {},
        async showWarningMessage(message) {
          warnings.push(message);
          if (message.includes('共享本地历史')) {
            return '共享历史并重载';
          }
          return undefined;
        },
        async showInformationMessage(message) {
          information.push(message);
          return undefined;
        },
        async showErrorMessage() {},
        async showInputBox() {},
        async showQuickPick() {}
      }
    }
  };
}

async function withActivatedFixture(run) {
  const fixture = await createFixture();
  const vscode = createVscodeMock(fixture);
  const globalState = createGlobalState();
  const context = {
    extensionPath: path.resolve(__dirname, '..'),
    globalState,
    subscriptions: []
  };
  const originalCodeHome = process.env.CODEX_HOME;
  const originalLoad = Module._load;
  let extension;

  try {
    process.env.CODEX_HOME = fixture.codexHome;
    Module._load = function loadWithVscodeMock(request, parent, isMain) {
      if (request === 'vscode') {
        return vscode.api;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[extensionModulePath];
    extension = require('../extension');
    await extension.activate(context);
    await run({ fixture, vscode, globalState });
  } finally {
    extension?.deactivate();
    delete require.cache[extensionModulePath];
    Module._load = originalLoad;
    if (originalCodeHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodeHome;
    }
    await fs.promises.rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
}

test('shared-history activation repair', async (t) => {
  await t.test('patches both validated Codex resources after consent', async () => {
    await withActivatedFixture(async ({ fixture, vscode, globalState }) => {
      const hostSource = await fs.promises.readFile(fixture.hostPath, 'utf8');
      const webviewSource = await fs.promises.readFile(fixture.webviewPath, 'utf8');

      assert.equal(hostSource, 'thread/list;modelProviders:[];modelProviders:[]');
      assert.equal(webviewSource, 'thread/list;modelProviders:[];modelProviders:[]');
      assert.equal(globalState.get('shared-history-patch-consent-v1'), true);
      assert.ok(vscode.commands.has('labCodex.repairSharedHistory'));
      assert.equal(vscode.warnings.length, 1);
    });
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const extensionModulePath = require.resolve('../extension');
const LEGACY_EXTENSION_ID = 'lab-local.codex-provider-switcher';

function createGlobalState(initialValues = {}) {
  const values = new Map();
  for (const [key, value] of Object.entries(initialValues)) {
    values.set(key, value);
  }
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

async function loadExtensionWithMock(codexHome, vscodeApi, run, runtimeFs = fs) {
  const originalCodexHome = process.env.CODEX_HOME;
  const originalLoad = Module._load;
  let extension;
  try {
    process.env.CODEX_HOME = codexHome;
    Module._load = function loadWithVscodeMock(request, parent, isMain) {
      if (request === 'vscode') {
        return vscodeApi;
      }
      if (request === 'fs') {
        return runtimeFs;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[extensionModulePath];
    extension = require('../extension');
    await run(extension);
  } finally {
    extension?.deactivate();
    delete require.cache[extensionModulePath];
    Module._load = originalLoad;
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
  }
}

function baseVscodeMock({ getExtension, settings = {}, warningHandler, informationHandler, inputHandler }) {
  const commands = new Map();
  const warnings = [];
  const information = [];
  const executedCommands = [];
  return {
    commands,
    warnings,
    information,
    executedCommands,
    api: {
      StatusBarAlignment: { Right: 1 },
      commands: {
        registerCommand(command, handler) {
          commands.set(command, handler);
          return { dispose() {} };
        },
        async executeCommand(...args) {
          executedCommands.push(args);
        }
      },
      extensions: {
        getExtension,
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
        async showWarningMessage(message, ...args) {
          warnings.push(message);
          return warningHandler?.(message, args);
        },
        async showInformationMessage(message, ...args) {
          information.push(message);
          return informationHandler?.(message, args);
        },
        async showErrorMessage() {},
        async showInputBox(options) {
          return inputHandler?.(options);
        },
        async showQuickPick() {}
      }
    }
  };
}

test('activation safety and switching regressions', async (t) => {
  await t.test('stops before mutations when the conflicting legacy extension is installed', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-legacy-guard-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const vscode = baseVscodeMock({
      getExtension(id) {
        return id === LEGACY_EXTENSION_ID ? { packageJSON: { version: '1.2.0' } } : undefined;
      }
    });
    const context = {
      extensionPath: path.resolve(__dirname, '..'),
      globalState: createGlobalState(),
      subscriptions: []
    };

    try {
      await loadExtensionWithMock(codexHome, vscode.api, async (extension) => {
        await extension.activate(context);
      });
      assert.equal(vscode.commands.size, 0);
      assert.equal(fs.existsSync(codexHome), false);
      assert.ok(vscode.warnings.some((message) => message.includes('旧版')));
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('rolls back the Max asset if post-write verification fails', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-max-rollback-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const officialRoot = path.join(temporaryRoot, 'official-codex');
    const assetsPath = path.join(officialRoot, 'webview', 'assets');
    const assetPath = path.join(assetsPath, 'app-initial-fixture.js');
    const originalSource = 'hasModelSupportingMaxReasoningEffort;.filter(({reasoningEffort:e})=>a(e)&&b.has(e))';
    await fs.promises.mkdir(assetsPath, { recursive: true });
    await fs.promises.writeFile(assetPath, originalSource, 'utf8');

    const vscode = baseVscodeMock({
      getExtension(id) {
        if (id === 'openai.chatgpt') {
          return { extensionPath: officialRoot, packageJSON: { version: 'fixture' } };
        }
        return undefined;
      },
      settings: {
        autoPatchSharedHistory: false,
        autoPatchMax: true,
        autoReloadAfterMaxPatch: false
      },
      warningHandler(message) {
        return message.includes('Max 推理等级') ? '修复 Max 并重载' : undefined;
      }
    });
    const context = {
      extensionPath: path.resolve(__dirname, '..'),
      globalState: createGlobalState(),
      subscriptions: []
    };
    const originalRename = fs.promises.rename;
    const originalReadFile = fs.promises.readFile;
    let assetWriteCount = 0;
    let failNextVerificationRead = false;
    const runtimeFs = Object.create(fs);
    Object.defineProperty(runtimeFs, 'promises', {
      value: {
        ...fs.promises,
        async rename(source, destination) {
          await originalRename(source, destination);
          if (path.resolve(destination) === path.resolve(assetPath)) {
            assetWriteCount += 1;
            if (assetWriteCount === 1) {
              failNextVerificationRead = true;
            }
          }
        },
        async readFile(filePath, ...args) {
          if (failNextVerificationRead && path.resolve(filePath) === path.resolve(assetPath)) {
            failNextVerificationRead = false;
            return 'simulated-corrupt-read';
          }
          return originalReadFile(filePath, ...args);
        }
      }
    });

    try {
      await loadExtensionWithMock(codexHome, vscode.api, async (extension) => {
        await extension.activate(context);
      }, runtimeFs);
      assert.equal(await originalReadFile(assetPath, 'utf8'), originalSource);
      assert.equal(assetWriteCount, 2);
      assert.ok(vscode.warnings.some((message) => message.includes('Max 修复写入失败')));
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('offers an immediate real switch after saving API configuration', {
    skip: process.platform !== 'win32'
  }, async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-configure-switch-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    await fs.promises.mkdir(codexHome, { recursive: true });
    await fs.promises.writeFile(path.join(codexHome, 'models_cache.json'), JSON.stringify({
      models: [{
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6-Sol',
        supported_reasoning_levels: [{ effort: 'max' }]
      }]
    }), 'utf8');

    const inputs = ['https://gateway.example.com/v1', 'test_key_1234567890'];
    const vscode = baseVscodeMock({
      getExtension() {
        return undefined;
      },
      settings: {
        autoReload: false,
        autoPatchSharedHistory: false,
        autoPatchMax: false
      },
      warningHandler(message) {
        return message.includes('确认自定义 API 主机') ? '信任并继续' : undefined;
      },
      informationHandler(message) {
        return message.includes('当前连接仍是 ChatGPT 账户') ? '立即切换到自定义 API' : undefined;
      },
      inputHandler() {
        return inputs.shift();
      }
    });
    const context = {
      extensionPath: path.resolve(__dirname, '..'),
      globalState: createGlobalState(),
      subscriptions: []
    };

    try {
      await loadExtensionWithMock(codexHome, vscode.api, async (extension) => {
        await extension.activate(context);
        await vscode.commands.get('labCodex.configureLab')();
      });
      const configText = await fs.promises.readFile(path.join(codexHome, 'config.toml'), 'utf8');
      assert.match(configText, /^model_provider = "lab_relay"/m);
      assert.doesNotMatch(configText, /^service_tier\s*=/m);
      assert.ok(vscode.information.some((message) => message.includes('当前连接仍是 ChatGPT 账户')));
      assert.deepEqual(context.globalState.get('pending-fresh-chat-after-provider-switch-v1'), {
        provider: 'lab_relay',
        label: '自定义 API'
      });
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('opens a fresh provider-bound chat after the switched window activates', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-fresh-chat-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    await fs.promises.mkdir(codexHome, { recursive: true });
    await fs.promises.writeFile(
      path.join(codexHome, 'config.toml'),
      'model_provider = "lab_relay"\n',
      'utf8'
    );

    const vscode = baseVscodeMock({
      getExtension() {
        return undefined;
      },
      settings: {
        autoPatchSharedHistory: false,
        autoPatchMax: false
      }
    });
    const globalState = createGlobalState({
      'pending-fresh-chat-after-provider-switch-v1': {
        provider: 'lab_relay',
        label: '自定义 API'
      }
    });
    const context = {
      extensionPath: path.resolve(__dirname, '..'),
      globalState,
      subscriptions: []
    };

    try {
      await loadExtensionWithMock(codexHome, vscode.api, async (extension) => {
        await extension.activate(context);
      });
      assert.ok(vscode.executedCommands.some(([command]) => command === 'chatgpt.newChat'));
      assert.equal(globalState.get('pending-fresh-chat-after-provider-switch-v1'), undefined);
      assert.ok(vscode.information.some((message) => message.includes('旧会话的 Provider 不会被迁移')));
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

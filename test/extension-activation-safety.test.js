'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { patchProviderTakeoverSource } = require('../lib/provider-takeover-patch');

const extensionModulePath = require.resolve('../extension');
const LEGACY_EXTENSION_ID = 'lab-local.codex-provider-switcher';
const ORIGINAL_PROVIDER_WEBVIEW_SOURCE = [
  'function isWriterConflict(e){return String(e).toLowerCase().includes(`already has an active writer`)}',
  'const px={get(){return null}};',
  'async function resumeFixture(e,n,H,V){',
  'let te=e.sendRequest(`thread/resume`,{threadId:n,history:null,model:null,modelProvider:H.modelProvider},V);',
  'px.get(e)?.get(n);',
  'let ne=()=>null,re=await te,ie=null;',
  'e.updateConversationState(n,t=>{e.canonicalTurnHistory?t.resumeState=`canonical`:t.resumeState=`legacy`,t.sessionId=re.thread.sessionId});',
  'return{re,ie,ne:ne()}',
  '}'
].join('');

async function createPatchedOfficialCodex(temporaryRoot) {
  const officialRoot = path.join(temporaryRoot, 'official-codex');
  const assetsPath = path.join(officialRoot, 'webview', 'assets');
  await fs.promises.mkdir(assetsPath, { recursive: true });
  const patched = patchProviderTakeoverSource(ORIGINAL_PROVIDER_WEBVIEW_SOURCE);
  assert.equal(patched.status, 'patched');
  await fs.promises.writeFile(
    path.join(assetsPath, 'app-initial-provider-fixture.js'),
    patched.source,
    'utf8'
  );
  await fs.promises.writeFile(
    path.join(assetsPath, 'use-resume-conversation-if-needed-fixture.js'),
    'import"./app-initial-provider-fixture.js";const gate={isWriterConflict:true,retryResume:true,id:"localTaskRow.resumeLiveWriterError"};',
    'utf8'
  );
  await fs.promises.writeFile(
    path.join(assetsPath, 'local-conversation-thread-fixture.js'),
    'import"./use-resume-conversation-if-needed-fixture.js";function view(s){const {isResuming:p,isWriterConflict:m,retryResume:h}=resume();let v=!s||m,y=p&&!m,x=s&&!m;return render({isReadOnly:v,isResuming:y,showComposer:x,retry:"localConversation.writerConflict.retry",title:"This is open in another app"})}',
    'utf8'
  );
  return officialRoot;
}

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

async function loadExtensionWithMock(codexHome, vscodeApi, run) {
  const originalCodexHome = process.env.CODEX_HOME;
  const originalLoad = Module._load;
  let extension;
  try {
    process.env.CODEX_HOME = codexHome;
    Module._load = function loadWithVscodeMock(request, parent, isMain) {
      if (request === 'vscode') {
        return vscodeApi;
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
  const statusBar = { text: '', tooltip: '', show() {}, dispose() {} };
  return {
    commands,
    warnings,
    information,
    executedCommands,
    statusBar,
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
          return statusBar;
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

  await t.test('offers an immediate real switch after saving API configuration', {
    skip: process.platform !== 'win32'
  }, async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-configure-switch-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
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
      getExtension(id) {
        return id === 'openai.chatgpt'
          ? { extensionPath: officialRoot, packageJSON: { version: 'fixture' } }
          : undefined;
      },
      settings: {
        autoReload: false,
        autoPatchProviderTakeover: false,
        autoPatchSharedHistory: false,
        autoPatchMax: false
      },
      warningHandler(message) {
        if (message.includes('确认自定义 API 主机')) {
          return '信任并继续';
        }
        return message.includes('必须重载 VS Code 窗口') ? '切换并重载' : undefined;
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
      assert.deepEqual(context.globalState.get('pending-provider-switch-v2'), {
        provider: 'lab_relay',
        label: '自定义 API'
      });
      assert.match(vscode.statusBar.text, /Codex 默认: API/);
      assert.ok(vscode.executedCommands.some(([command]) => command === 'workbench.action.reloadWindow'));

      await fs.promises.writeFile(path.join(codexHome, 'models_cache.json'), JSON.stringify({
        models: [{
          slug: 'gpt-5.5',
          display_name: 'GPT-5.5',
          supported_reasoning_levels: [{ effort: 'high' }]
        }]
      }), 'utf8');
      await vscode.commands.get('labCodex.useLab')();
      const fallbackCatalog = JSON.parse(await fs.promises.readFile(
        path.join(codexHome, 'lab-provider-switcher', 'models.json'),
        'utf8'
      ));
      assert.deepEqual(fallbackCatalog.models.map((model) => model.slug), ['gpt-5.6-sol']);
      assert.equal(fallbackCatalog.models[0].display_name, '中转 · GPT-5.6-Sol');
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('drops stale account model settings after a different account logs in', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-account-change-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const dataDir = path.join(codexHome, 'lab-provider-switcher');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(codexHome, 'config.toml'),
      [
        'model_provider = "lab_relay"',
        'model = "gpt-5.6-terra"',
        'review_model = "gpt-5.6-terra"',
        'model_reasoning_effort = "max"',
        ''
      ].join('\n'),
      'utf8'
    );
    await fs.promises.writeFile(path.join(codexHome, 'models_cache.json'), JSON.stringify({
      models: [{
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6-Sol',
        default_reasoning_level: 'low',
        supported_reasoning_levels: [{ effort: 'low' }],
        service_tiers: []
      }]
    }), 'utf8');
    await fs.promises.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
      account: {
        model: 'gpt-5.6-terra',
        reviewModel: 'gpt-5.6-terra',
        modelReasoningEffort: 'max',
        serviceTier: 'priority'
      },
      lab: {
        name: 'Custom Responses API',
        baseUrl: 'https://gateway.example.com/v1',
        model: 'gpt-5.6-terra',
        reviewModel: 'gpt-5.6-terra',
        modelReasoningEffort: 'max',
        httpHeaders: {}
      }
    }), 'utf8');

    const vscode = baseVscodeMock({
      getExtension(id) {
        return id === 'openai.chatgpt'
          ? { extensionPath: officialRoot, packageJSON: { version: 'fixture' } }
          : undefined;
      },
      settings: {
        autoReload: false,
        autoPatchSharedHistory: false,
        autoPatchMax: false
      },
      warningHandler(message) {
        return message.includes('必须重载 VS Code 窗口') ? '切换并重载' : undefined;
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
        await vscode.commands.get('labCodex.useAccount')();
      });
      const configText = await fs.promises.readFile(path.join(codexHome, 'config.toml'), 'utf8');
      assert.match(configText, /^model_provider = "openai"/m);
      assert.doesNotMatch(configText, /^model\s*=/m);
      assert.doesNotMatch(configText, /^review_model\s*=/m);
      assert.doesNotMatch(configText, /^model_reasoning_effort\s*=/m);
      assert.doesNotMatch(configText, /^service_tier\s*=/m);
      assert.deepEqual(context.globalState.get('pending-provider-switch-v2'), {
        provider: 'openai',
        label: 'ChatGPT 账户',
        accountSelectionAdjusted: true
      });
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('keeps the current thread and reports provider takeover after the switched window activates', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-provider-takeover-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    await fs.promises.mkdir(codexHome, { recursive: true });
    await fs.promises.writeFile(
      path.join(codexHome, 'config.toml'),
      'model_provider = "lab_relay"\n',
      'utf8'
    );

    const vscode = baseVscodeMock({
      getExtension(id) {
        return id === 'openai.chatgpt'
          ? { extensionPath: officialRoot, packageJSON: { version: 'fixture' } }
          : undefined;
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
      assert.equal(vscode.executedCommands.some(([command]) => command === 'chatgpt.newChat'), false);
      assert.equal(globalState.get('pending-fresh-chat-after-provider-switch-v1'), undefined);
      assert.match(vscode.statusBar.text, /Codex 当前: API/);
      assert.ok(vscode.information.some((message) => message.includes('保留原 thread ID')));
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

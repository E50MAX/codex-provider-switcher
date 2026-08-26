'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const {
  patchProviderTakeoverConversationUiSource,
  patchProviderTakeoverResumeUiSource,
  patchProviderTakeoverSource
} = require('../lib/provider-takeover-patch');

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
  const resumeUi = patchProviderTakeoverResumeUiSource([
    'import"./app-initial-provider-fixture.js";',
    'function ce(e,t){let n=W(t);return n==null?f(t)?e.formatMessage({id:`localTaskRow.resumeLiveWriterError`}):e.formatMessage({id:`resumeError`}):e.formatMessage({id:`configError`})}',
    'function hook(e){try{return null}catch(t){let n=t,l=true,h=f(n);h&&(close(),set(e));let g=false,m=false,T={current:false};!h&&ue({hasShownResumeError:T.current,isSubagentChildThread:m,shouldAutoRetry:g})&&danger(ce(intl,n))}}',
    'const gate={isWriterConflict:true,retryResume:true};'
  ].join(''));
  assert.equal(resumeUi.status, 'patched');
  const conversationUi = patchProviderTakeoverConversationUiSource([
    'import"./use-resume-conversation-if-needed-fixture.js";',
    'const title={id:`localConversation.writerConflict.title`,defaultMessage:`This is open in another app`,description:`Title shown when a conversation is already active elsewhere`};',
    'const description={id:`localConversation.writerConflict.description`,defaultMessage:`Close it there to continue here.`,description:`Explanation shown when a conversation can be read but is actively being used elsewhere`};',
    'function view(s){const {isResuming:p,isWriterConflict:m,retryResume:h}=resume();let v=!s||m,y=p&&!m,x=s&&!m;return render({isReadOnly:v,isResuming:y,showComposer:x,retry:`localConversation.writerConflict.retry`,title})}'
  ].join(''));
  assert.equal(conversationUi.status, 'patched');
  await fs.promises.writeFile(
    path.join(assetsPath, 'app-initial-provider-fixture.js'),
    patched.source,
    'utf8'
  );
  await fs.promises.writeFile(
    path.join(assetsPath, 'use-resume-conversation-if-needed-fixture.js'),
    resumeUi.source,
    'utf8'
  );
  await fs.promises.writeFile(
    path.join(assetsPath, 'local-conversation-thread-fixture.js'),
    conversationUi.source,
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

function baseVscodeMock({
  getExtension,
  settings = {},
  chatgptSettings = {},
  remoteName,
  warningHandler,
  informationHandler,
  errorHandler,
  inputHandler,
  quickPickHandler,
  executeCommandHandler
}) {
  const commands = new Map();
  const warnings = [];
  const information = [];
  const errors = [];
  const executedCommands = [];
  const quickPicks = [];
  const statusBar = { text: '', tooltip: '', show() {}, dispose() {} };
  return {
    commands,
    warnings,
    information,
    errors,
    executedCommands,
    quickPicks,
    statusBar,
    api: {
      env: { remoteName },
      StatusBarAlignment: { Right: 1 },
      commands: {
        registerCommand(command, handler) {
          commands.set(command, handler);
          return { dispose() {} };
        },
        async executeCommand(...args) {
          executedCommands.push(args);
          return executeCommandHandler?.(...args);
        }
      },
      extensions: {
        getExtension,
        onDidChange() {
          return { dispose() {} };
        }
      },
      workspace: {
        getConfiguration(section) {
          const values = section === 'chatgpt' ? chatgptSettings : settings;
          return {
            get(key, fallback) {
              return Object.hasOwn(values, key) ? values[key] : fallback;
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
        async showErrorMessage(message, ...args) {
          errors.push(message);
          return errorHandler?.(message, args);
        },
        async showInputBox(options) {
          return inputHandler?.(options);
        },
        async showQuickPick(items, options) {
          quickPicks.push({ items, options });
          return quickPickHandler?.(items, options);
        }
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

  await t.test('preselects the provider saved in the active Codex config', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-saved-provider-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    await fs.promises.mkdir(codexHome, { recursive: true });
    await fs.promises.writeFile(
      path.join(codexHome, 'config.toml'),
      'model_provider = "lab_relay"\nmodel_reasoning_effort = "high"\n',
      'utf8'
    );
    const vscode = baseVscodeMock({
      getExtension(id) {
        return id === 'openai.chatgpt'
          ? { extensionPath: officialRoot, packageJSON: { version: 'fixture' } }
          : undefined;
      },
      settings: {
        autoPatchProviderTakeover: false,
        autoPatchSharedHistory: false,
        autoPatchMax: false
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
        await vscode.commands.get('labCodex.switchConnection')();
      });
      const [{ items }] = vscode.quickPicks;
      assert.equal(items.find((item) => item.target === 'account').picked, false);
      assert.equal(items.find((item) => item.target === 'custom').picked, true);
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
        return message.includes('当前连接仍为 OpenAI 官方连接') ? '立即切换到自定义 API' : undefined;
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
      assert.ok(vscode.information.some((message) => message.includes('当前连接仍为 OpenAI 官方连接')));
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
        label: 'OpenAI 官方连接',
        accountSelectionAdjusted: true
      });
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('carries the most recent reasoning effort across provider switches', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-recent-effort-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const dataDir = path.join(codexHome, 'lab-provider-switcher');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(codexHome, 'config.toml'),
      [
        'model_provider = "lab_relay"',
        'model = "gpt-5.6-sol"',
        'model_reasoning_effort = "xhigh"',
        ''
      ].join('\n'),
      'utf8'
    );
    await fs.promises.writeFile(path.join(codexHome, 'models_cache.json'), JSON.stringify({
      models: [{
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6-Sol',
        default_reasoning_level: 'low',
        supported_reasoning_levels: [
          { effort: 'low' },
          { effort: 'high' },
          { effort: 'xhigh' }
        ],
        service_tiers: []
      }]
    }), 'utf8');
    await fs.promises.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
      account: {
        model: 'gpt-5.6-sol',
        reviewModel: 'gpt-5.6-sol',
        modelReasoningEffort: 'high'
      },
      lab: {
        name: 'Custom Responses API',
        baseUrl: 'https://gateway.example.com/v1',
        model: 'gpt-5.6-sol',
        reviewModel: 'gpt-5.6-sol',
        modelReasoningEffort: 'xhigh',
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
      assert.match(configText, /^model_reasoning_effort = "xhigh"/m);
      const savedSettings = JSON.parse(await fs.promises.readFile(
        path.join(dataDir, 'settings.json'),
        'utf8'
      ));
      assert.equal(savedSettings.lastReasoningEffort, 'xhigh');
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('keeps the current thread and reports provider takeover after the switched window activates', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-provider-takeover-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    const dataDir = path.join(codexHome, 'lab-provider-switcher');
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(codexHome, 'config.toml'),
      'model_provider = "lab_relay"\n',
      'utf8'
    );
    await fs.promises.writeFile(path.join(dataDir, 'api-key.v2.dpapi'), 'encrypted-fixture');

    const vscode = baseVscodeMock({
      getExtension(id) {
        return id === 'openai.chatgpt'
          ? { extensionPath: officialRoot, packageJSON: { version: 'fixture' } }
          : undefined;
      },
      settings: {
        autoPatchProviderTakeover: false,
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

  await t.test('does not report a completed custom switch when the encrypted key vanished before reload', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-missing-key-reload-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    await fs.promises.mkdir(codexHome, { recursive: true });
    await fs.promises.writeFile(path.join(codexHome, 'config.toml'), 'model_provider = "lab_relay"\n');
    const vscode = baseVscodeMock({
      getExtension(id) {
        return id === 'openai.chatgpt'
          ? { extensionPath: officialRoot, packageJSON: { version: 'fixture' } }
          : undefined;
      },
      settings: {
        autoPatchProviderTakeover: false,
        autoPatchSharedHistory: false,
        autoPatchMax: false
      }
    });
    const globalState = createGlobalState({
      'pending-provider-switch-v2': { provider: 'lab_relay', label: '自定义 API' }
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
      assert.match(vscode.statusBar.text, /API: 缺少密钥/);
      assert.ok(vscode.warnings.some((message) => message.includes('加密 API Key 缺失')));
      assert.equal(vscode.information.some((message) => message.includes('已切换到自定义 API')), false);
      assert.equal(globalState.get('pending-provider-switch-v2'), undefined);
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('stops before filesystem mutations in VS Code Remote or Codex WSL mode', {
    skip: process.platform !== 'win32'
  }, async (environmentTest) => {
    const cases = [
      { name: 'VS Code Remote', remoteName: 'wsl', chatgptSettings: {} },
      {
        name: 'Codex WSL setting',
        remoteName: undefined,
        chatgptSettings: { runCodexInWindowsSubsystemForLinux: true }
      }
    ];

    for (const environmentCase of cases) {
      await environmentTest.test(environmentCase.name, async () => {
        const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-environment-guard-'));
        const codexHome = path.join(temporaryRoot, 'codex-home');
        const vscode = baseVscodeMock({
          getExtension() { return undefined; },
          remoteName: environmentCase.remoteName,
          chatgptSettings: environmentCase.chatgptSettings
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
          assert.equal(fs.existsSync(codexHome), false);
          assert.equal(vscode.commands.size, 8);
          assert.match(vscode.statusBar.text, /环境不受支持/);
          assert.ok(vscode.warnings.some((message) => message.includes('已停止')));
          assert.ok(vscode.errors.some((message) => message.includes('原生 Windows 本地窗口')));
        } finally {
          await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
        }
      });
    }
  });

  await t.test('recognizes commented TOML and does not mislabel an unmanaged provider as OpenAI', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-commented-provider-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    await fs.promises.mkdir(codexHome, { recursive: true });
    await fs.promises.writeFile(
      path.join(codexHome, 'config.toml'),
      "model_provider = 'third_party' # intentionally unmanaged\n",
      'utf8'
    );
    const vscode = baseVscodeMock({
      getExtension() { return undefined; },
      settings: {
        autoPatchProviderTakeover: false,
        autoPatchSharedHistory: false,
        autoPatchMax: false
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
        await vscode.commands.get('labCodex.switchConnection')();
      });
      assert.match(vscode.statusBar.text, /Codex 默认: 其他/);
      assert.match(vscode.statusBar.tooltip, /third_party/);
      const [{ items }] = vscode.quickPicks;
      assert.equal(items.find((item) => item.target === 'account').picked, false);
      assert.equal(items.find((item) => item.target === 'custom').picked, false);
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('keeps commands available but performs no repair when top-level config is ambiguous', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-ambiguous-provider-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    await fs.promises.mkdir(codexHome, { recursive: true });
    const configPath = path.join(codexHome, 'config.toml');
    const ambiguousConfig = 'model_provider = "openai"\nmodel_provider = "lab_relay"\n';
    await fs.promises.writeFile(configPath, ambiguousConfig, 'utf8');
    const vscode = baseVscodeMock({ getExtension() { return undefined; } });
    const context = {
      extensionPath: path.resolve(__dirname, '..'),
      globalState: createGlobalState(),
      subscriptions: []
    };

    try {
      await loadExtensionWithMock(codexHome, vscode.api, async (extension) => {
        await extension.activate(context);
        await vscode.commands.get('labCodex.switchConnection')();
      });
      assert.equal(await fs.promises.readFile(configPath, 'utf8'), ambiguousConfig);
      assert.match(vscode.statusBar.text, /连接配置错误/);
      assert.ok(vscode.warnings.some((message) => message.includes('未修改连接配置')));
      assert.ok(vscode.errors.some((message) => message.includes('model_provider 重复')));
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('requires and performs a reload when the active custom API is updated', {
    skip: process.platform !== 'win32'
  }, async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-active-api-update-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const dataDir = path.join(codexHome, 'lab-provider-switcher');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    await fs.promises.mkdir(dataDir, { recursive: true });
    const originalConfig = 'model_provider = "lab_relay" # active relay\n';
    await fs.promises.writeFile(path.join(codexHome, 'config.toml'), originalConfig, 'utf8');
    await fs.promises.writeFile(path.join(codexHome, 'models_cache.json'), JSON.stringify({
      models: [{
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6-Sol',
        supported_reasoning_levels: [{ effort: 'high' }]
      }]
    }), 'utf8');
    await fs.promises.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
      lab: {
        name: 'Custom Responses API',
        baseUrl: 'https://old.example.com/v1',
        model: 'gpt-5.6-sol',
        reviewModel: 'gpt-5.6-sol',
        modelReasoningEffort: 'high',
        httpHeaders: {}
      }
    }), 'utf8');
    const inputs = ['https://new.example.com/v1', 'test_key_1234567890'];
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
      inputHandler() { return inputs.shift(); }
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
      assert.match(configText, /base_url = "https:\/\/new\.example\.com\/v1"/);
      assert.deepEqual(context.globalState.get('pending-provider-switch-v2'), {
        provider: 'lab_relay',
        label: '更新后的自定义 API',
        configurationUpdate: true
      });
      assert.match(vscode.statusBar.text, /Codex 默认: API/);
      assert.ok(vscode.executedCommands.some(([command]) => command === 'workbench.action.reloadWindow'));
      assert.equal(fs.existsSync(path.join(dataDir, 'api-key.v2.dpapi')), true);
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('does not save an active API update when the required reload is declined', {
    skip: process.platform !== 'win32'
  }, async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-active-api-cancel-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const dataDir = path.join(codexHome, 'lab-provider-switcher');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    await fs.promises.mkdir(dataDir, { recursive: true });
    const originalConfig = 'model_provider = "lab_relay"\n';
    await fs.promises.writeFile(path.join(codexHome, 'config.toml'), originalConfig, 'utf8');
    await fs.promises.writeFile(path.join(codexHome, 'models_cache.json'), JSON.stringify({
      models: [{ slug: 'gpt-5.6-sol', supported_reasoning_levels: [{ effort: 'high' }] }]
    }), 'utf8');
    await fs.promises.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
      lab: {
        baseUrl: 'https://old.example.com/v1',
        model: 'gpt-5.6-sol',
        reviewModel: 'gpt-5.6-sol',
        modelReasoningEffort: 'high',
        httpHeaders: {}
      }
    }), 'utf8');
    const inputs = ['https://new.example.com/v1', 'test_key_1234567890'];
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
        return message.includes('确认自定义 API 主机') ? '信任并继续' : undefined;
      },
      inputHandler() { return inputs.shift(); }
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
      assert.equal(await fs.promises.readFile(path.join(codexHome, 'config.toml'), 'utf8'), originalConfig);
      assert.equal(fs.existsSync(path.join(dataDir, 'api-key.v2.dpapi')), false);
      assert.equal(context.globalState.get('pending-provider-switch-v2'), undefined);
      assert.equal(vscode.executedCommands.some(([command]) => command === 'workbench.action.reloadWindow'), false);
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('reloads immediately after deleting the key used by the active custom API', {
    skip: process.platform !== 'win32'
  }, async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-active-key-delete-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const dataDir = path.join(codexHome, 'lab-provider-switcher');
    const secretPath = path.join(dataDir, 'api-key.v2.dpapi');
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(path.join(codexHome, 'config.toml'), 'model_provider = "lab_relay"\n');
    await fs.promises.writeFile(secretPath, 'encrypted-fixture');
    const vscode = baseVscodeMock({
      getExtension() { return undefined; },
      settings: {
        autoReload: false,
        autoPatchProviderTakeover: false,
        autoPatchSharedHistory: false,
        autoPatchMax: false
      },
      warningHandler(message) {
        return message.includes('删除本机保存的自定义 API Key')
          ? '删除密钥并重载'
          : undefined;
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
        await vscode.commands.get('labCodex.deleteLabKey')();
      });
      assert.equal(fs.existsSync(secretPath), false);
      assert.match(vscode.statusBar.text, /API: 缺少密钥/);
      assert.ok(vscode.executedCommands.some(([command]) => command === 'workbench.action.reloadWindow'));
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('serializes overlapping connection commands', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-command-mutex-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    let resolveQuickPick;
    let signalQuickPick;
    const quickPickEntered = new Promise((resolve) => { signalQuickPick = resolve; });
    const vscode = baseVscodeMock({
      getExtension() { return undefined; },
      settings: {
        autoPatchProviderTakeover: false,
        autoPatchSharedHistory: false,
        autoPatchMax: false
      },
      quickPickHandler() {
        signalQuickPick();
        return new Promise((resolve) => { resolveQuickPick = resolve; });
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
        const firstCommand = vscode.commands.get('labCodex.switchConnection')();
        await quickPickEntered;
        await vscode.commands.get('labCodex.useAccount')();
        resolveQuickPick(undefined);
        await firstCommand;
      });
      assert.ok(vscode.warnings.some((message) => message.includes('另一个 Codex 连接')));
      assert.equal(context.globalState.get('pending-provider-switch-v2'), undefined);
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('preserves an external config edit made while a switch is being confirmed', async () => {
    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-config-cas-'));
    const codexHome = path.join(temporaryRoot, 'codex-home');
    const officialRoot = await createPatchedOfficialCodex(temporaryRoot);
    await fs.promises.mkdir(codexHome, { recursive: true });
    const configPath = path.join(codexHome, 'config.toml');
    await fs.promises.writeFile(configPath, 'model_provider = "lab_relay"\nexternal = "before"\n', 'utf8');
    const externalConfig = 'model_provider = "lab_relay"\nexternal = "after"\n';
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
        if (message.includes('必须重载 VS Code 窗口')) {
          fs.writeFileSync(configPath, externalConfig, 'utf8');
          return '切换并重载';
        }
        return undefined;
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
      assert.equal(await fs.promises.readFile(configPath, 'utf8'), externalConfig);
      assert.ok(vscode.errors.some((message) => message.includes('操作期间发生变化')));
      assert.equal(context.globalState.get('pending-provider-switch-v2'), undefined);
      assert.equal(vscode.executedCommands.some(([command]) => command === 'workbench.action.reloadWindow'), false);
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

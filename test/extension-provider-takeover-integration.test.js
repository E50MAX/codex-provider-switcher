'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { patchProviderTakeoverSource } = require('../lib/provider-takeover-patch');

const extensionModulePath = require.resolve('../extension');
const ORIGINAL_PROVIDER_SOURCE = [
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

function createGlobalState(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
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

async function createFixture() {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-provider-integration-'));
  const codexHome = path.join(temporaryRoot, 'codex-home');
  const officialRoot = path.join(temporaryRoot, 'official-codex');
  const assetsPath = path.join(officialRoot, 'webview', 'assets');
  const assetPath = path.join(assetsPath, 'app-initial-provider-fixture.js');
  const resumeUiPath = path.join(assetsPath, 'use-resume-conversation-if-needed-fixture.js');
  const conversationUiPath = path.join(assetsPath, 'local-conversation-thread-fixture.js');
  await fs.promises.mkdir(assetsPath, { recursive: true });
  await fs.promises.writeFile(assetPath, ORIGINAL_PROVIDER_SOURCE, 'utf8');
  await fs.promises.writeFile(
    resumeUiPath,
    'import"./app-initial-provider-fixture.js";const gate={isWriterConflict:true,retryResume:true,id:"localTaskRow.resumeLiveWriterError"};',
    'utf8'
  );
  await fs.promises.writeFile(
    conversationUiPath,
    'import"./use-resume-conversation-if-needed-fixture.js";function view(s){const {isResuming:p,isWriterConflict:m,retryResume:h}=resume();let v=!s||m,y=p&&!m,x=s&&!m;return render({isReadOnly:v,isResuming:y,showComposer:x,retry:"localConversation.writerConflict.retry",title:"This is open in another app"})}',
    'utf8'
  );
  return {
    temporaryRoot,
    codexHome,
    officialRoot,
    assetPath,
    resumeUiPath,
    conversationUiPath
  };
}

function createVscodeMock(fixture) {
  const commands = new Map();
  const warnings = [];
  const information = [];
  const settings = {
    autoPatchProviderTakeover: true,
    autoReloadAfterProviderTakeoverPatch: false,
    autoPatchSharedHistory: false,
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
          return id === 'openai.chatgpt'
            ? { extensionPath: fixture.officialRoot, packageJSON: { version: 'fixture' } }
            : undefined;
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
          return message.includes('接管账户 / API 的旧会话')
            ? '启用旧会话切换并重载'
            : undefined;
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

async function activateFixture(fixture, globalState, vscode) {
  const originalCodexHome = process.env.CODEX_HOME;
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
    await extension.activate({
      extensionPath: path.resolve(__dirname, '..'),
      globalState,
      subscriptions: []
    });
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

test('provider takeover activation repair', async (t) => {
  await t.test('patches the unique validated resume resource after explicit consent', async () => {
    const fixture = await createFixture();
    const globalState = createGlobalState();
    const vscode = createVscodeMock(fixture);
    try {
      await activateFixture(fixture, globalState, vscode);
      const source = await fs.promises.readFile(fixture.assetPath, 'utf8');

      assert.equal(patchProviderTakeoverSource(source).status, 'already-patched');
      assert.equal(globalState.get('provider-takeover-patch-consent-v1'), true);
      assert.ok(vscode.commands.has('labCodex.repairProviderTakeover'));
      assert.equal(vscode.warnings.length, 1);
      assert.ok(vscode.information.some((message) => message.includes('重载窗口后生效')));
    } finally {
      await fs.promises.rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('reapplies after an official update without asking for consent again', async () => {
    const fixture = await createFixture();
    const globalState = createGlobalState({ 'provider-takeover-patch-consent-v1': true });
    const vscode = createVscodeMock(fixture);
    try {
      await activateFixture(fixture, globalState, vscode);
      const source = await fs.promises.readFile(fixture.assetPath, 'utf8');

      assert.equal(patchProviderTakeoverSource(source).status, 'already-patched');
      assert.equal(vscode.warnings.length, 0);
    } finally {
      await fs.promises.rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('refuses to patch when the official composer conflict gate is missing', async () => {
    const fixture = await createFixture();
    await fs.promises.rm(fixture.resumeUiPath);
    const globalState = createGlobalState();
    const vscode = createVscodeMock(fixture);
    try {
      await activateFixture(fixture, globalState, vscode);
      const source = await fs.promises.readFile(fixture.assetPath, 'utf8');

      assert.equal(source, ORIGINAL_PROVIDER_SOURCE);
      assert.equal(globalState.get('provider-takeover-patch-consent-v1'), undefined);
      assert.ok(vscode.warnings.some((message) => message.includes('恢复界面资源')));
    } finally {
      await fs.promises.rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });

  await t.test('refuses to patch when writer conflicts no longer disable the composer', async () => {
    const fixture = await createFixture();
    await fs.promises.writeFile(
      fixture.conversationUiPath,
      'import"./use-resume-conversation-if-needed-fixture.js";const composer={isWriterConflict:true,showComposer:true};',
      'utf8'
    );
    const globalState = createGlobalState();
    const vscode = createVscodeMock(fixture);
    try {
      await activateFixture(fixture, globalState, vscode);
      const source = await fs.promises.readFile(fixture.assetPath, 'utf8');

      assert.equal(source, ORIGINAL_PROVIDER_SOURCE);
      assert.equal(globalState.get('provider-takeover-patch-consent-v1'), undefined);
      assert.ok(vscode.warnings.some((message) => message.includes('输入框缺少')));
    } finally {
      await fs.promises.rm(fixture.temporaryRoot, { recursive: true, force: true });
    }
  });
});

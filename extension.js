'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const {
  normalizeApiKey,
  normalizeHeaderMap,
  normalizeHttpsBaseUrl,
  normalizeModelId,
  normalizeReasoningEffort
} = require('./lib/validation');
const {
  DEFAULT_REASONING_EFFORT,
  buildCustomModelCatalog,
  resolveCustomSelection
} = require('./lib/model-catalog');
const {
  MAX_ASSET_NAME,
  MAX_SUPPORT_MARKER,
  patchMaxVisibilitySource
} = require('./lib/max-patch');
const {
  HISTORY_ASSET_NAME,
  THREAD_LIST_MARKER,
  patchSharedHistorySource
} = require('./lib/history-patch');
const {
  removeManagedBlock,
  setTopLevelValue: setConfigTopLevelValue
} = require('./lib/config-text');

const PROVIDER_ID = 'lab_relay';
const MANAGED_BEGIN = '# >>> codex-provider-switcher: lab_relay >>>';
const MANAGED_END = '# <<< codex-provider-switcher: lab_relay <<<';
const DEFAULT_PROVIDER_NAME = 'Custom Responses API';
const CODEX_EXTENSION_ID = 'openai.chatgpt';
const LEGACY_EXTENSION_ID = 'lab-local.codex-provider-switcher';
const MAX_PATCH_CONSENT_KEY = 'max-patch-consent-v1';
const MAX_PATCH_DISMISSED_KEY = 'max-patch-prompt-dismissed-v1';
const HISTORY_PATCH_CONSENT_KEY = 'shared-history-patch-consent-v1';
const HISTORY_PATCH_DISMISSED_KEY = 'shared-history-patch-prompt-dismissed-v1';
const PENDING_FRESH_CHAT_KEY = 'pending-fresh-chat-after-provider-switch-v1';
const MAX_SETTINGS_BYTES = 1024 * 1024;
const MAX_MODEL_CACHE_BYTES = 5 * 1024 * 1024;
const MAX_CODEX_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_POWERSHELL_OUTPUT_BYTES = 64 * 1024;
const POWERSHELL_TIMEOUT_MS = 15000;

let statusBarItem;
let compatibilityPatchTimer;
let reloadScheduled = false;

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function pathsFor(context) {
  const home = codexHome();
  const dataDir = path.join(home, 'lab-provider-switcher');
  return {
    home,
    config: path.join(home, 'config.toml'),
    initialBackup: path.join(home, 'config.toml.before-provider-switcher'),
    lastBackup: path.join(home, 'config.toml.provider-switcher-last.bak'),
    settings: path.join(dataDir, 'settings.json'),
    secret: path.join(dataDir, 'api-key.v2.dpapi'),
    legacySecret: path.join(dataDir, 'api-key.dpapi'),
    catalog: path.join(dataDir, 'models.json'),
    modelCache: path.join(home, 'models_cache.json'),
    saveSecretScript: path.join(context.extensionPath, 'scripts', 'save-secret.ps1'),
    getSecretScript: path.join(context.extensionPath, 'scripts', 'get-secret.ps1')
  };
}

function assertWindows() {
  if (process.platform !== 'win32') {
    throw new Error('当前版本使用 Windows DPAPI，仅支持 Windows');
  }
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function newlineOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlInlineStringMap(value) {
  const entries = Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right));
  return `{ ${entries.map(([key, item]) => `${tomlString(key)} = ${tomlString(item)}`).join(', ')} }`;
}

function parseTomlString(raw) {
  const value = String(raw || '').trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value || undefined;
}

function topLevelValue(text, key) {
  const lines = text.split(/\r?\n/);
  const matcher = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.+?)\\s*$`);
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      break;
    }
    const match = line.match(matcher);
    if (match) {
      return parseTomlString(match[1]);
    }
  }
  return undefined;
}

function setTopLevelValue(text, key, value) {
  return setConfigTopLevelValue(text, key, value, MANAGED_BEGIN);
}

function providerBlock(context, custom) {
  const extensionPaths = pathsFor(context);
  const headers = normalizeHeaderMap(custom.httpHeaders);
  const lines = [
    MANAGED_BEGIN,
    `[model_providers.${PROVIDER_ID}]`,
    `name = ${tomlString(custom.name || DEFAULT_PROVIDER_NAME)}`,
    `base_url = ${tomlString(custom.baseUrl)}`,
    'wire_api = "responses"',
    'supports_websockets = false'
  ];

  if (Object.keys(headers).length > 0) {
    lines.push(`http_headers = ${tomlInlineStringMap(headers)}`);
  }

  lines.push(
    '',
    `[model_providers.${PROVIDER_ID}.auth]`,
    'command = "powershell.exe"',
    `args = ${JSON.stringify([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      extensionPaths.getSecretScript,
      '-SecretPath',
      extensionPaths.secret,
      '-Binding',
      custom.baseUrl,
      '-ConfigPath',
      extensionPaths.config,
      '-ProviderId',
      PROVIDER_ID
    ])}`,
    'timeout_ms = 5000',
    'refresh_interval_ms = 0',
    MANAGED_END
  );

  return lines.join('\n');
}

function upsertProviderBlock(text, context, custom) {
  const newline = newlineOf(text);
  const clean = removeManagedBlock(text, MANAGED_BEGIN, MANAGED_END).trimEnd();
  return `${clean}${newline}${newline}${providerBlock(context, custom).replace(/\n/g, newline)}${newline}`;
}

async function ensureNotSymlink(filePath) {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`为防止路径劫持，拒绝访问符号链接：${filePath}`);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function ensureDirectories(context) {
  const extensionPaths = pathsFor(context);
  await fs.promises.mkdir(path.dirname(extensionPaths.settings), { recursive: true });
  await fs.promises.mkdir(path.dirname(extensionPaths.config), { recursive: true });
}

async function atomicWriteFile(filePath, contents) {
  await ensureNotSymlink(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

async function readConfig(context) {
  const extensionPaths = pathsFor(context);
  await ensureNotSymlink(extensionPaths.config);
  try {
    return await fs.promises.readFile(extensionPaths.config, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function readSettings(context) {
  const extensionPaths = pathsFor(context);
  await ensureNotSymlink(extensionPaths.settings);
  try {
    const stat = await fs.promises.stat(extensionPaths.settings);
    if (stat.size > MAX_SETTINGS_BYTES) {
      throw new Error('切换器设置文件异常过大，已拒绝读取');
    }
    const settings = JSON.parse(await fs.promises.readFile(extensionPaths.settings, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('切换器设置文件格式无效');
    }
    return settings;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeSettings(context, settings) {
  const extensionPaths = pathsFor(context);
  await ensureDirectories(context);
  await atomicWriteFile(extensionPaths.settings, `${JSON.stringify(settings, null, 2)}\n`);
}

async function refreshCustomModelCatalog(context, existing = {}) {
  const extensionPaths = pathsFor(context);
  await ensureNotSymlink(extensionPaths.modelCache);
  await ensureNotSymlink(extensionPaths.catalog);

  let stat;
  try {
    stat = await fs.promises.stat(extensionPaths.modelCache);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('找不到 Codex 官方模型缓存；请先打开官方 Codex 并完成登录，让模型列表加载一次');
    }
    throw error;
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MODEL_CACHE_BYTES) {
    throw new Error('Codex 官方模型缓存大小异常，已拒绝读取');
  }

  let cache;
  try {
    cache = JSON.parse(await fs.promises.readFile(extensionPaths.modelCache, 'utf8'));
  } catch (error) {
    throw new Error(`Codex 官方模型缓存无法解析：${errorMessage(error)}`);
  }

  const catalog = buildCustomModelCatalog(cache);
  const selection = resolveCustomSelection(catalog, existing);
  await ensureDirectories(context);
  await atomicWriteFile(extensionPaths.catalog, `${JSON.stringify(catalog, null, 2)}\n`);
  return { catalog, selection };
}

async function backupAndWriteConfig(context, oldText, newText) {
  if (oldText === newText) {
    return;
  }
  const extensionPaths = pathsFor(context);
  await ensureDirectories(context);
  await ensureNotSymlink(extensionPaths.initialBackup);
  await ensureNotSymlink(extensionPaths.lastBackup);
  if (oldText) {
    try {
      await fs.promises.copyFile(extensionPaths.config, extensionPaths.initialBackup, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
    }
    await fs.promises.copyFile(extensionPaths.config, extensionPaths.lastBackup);
  }
  await atomicWriteFile(extensionPaths.config, newText);
}

function normalizeStoredCustom(rawCustom) {
  if (!rawCustom || typeof rawCustom !== 'object' || Array.isArray(rawCustom)) {
    return undefined;
  }
  const { baseUrl } = normalizeHttpsBaseUrl(rawCustom.baseUrl);
  const model = normalizeModelId(rawCustom.model);
  return {
    name: DEFAULT_PROVIDER_NAME,
    baseUrl,
    model,
    reviewModel: normalizeModelId(rawCustom.reviewModel || model),
    modelReasoningEffort: normalizeReasoningEffort(rawCustom.modelReasoningEffort) || DEFAULT_REASONING_EFFORT,
    httpHeaders: normalizeHeaderMap(rawCustom.httpHeaders)
  };
}

function accountSnapshot(configText) {
  return {
    model: topLevelValue(configText, 'model'),
    reviewModel: topLevelValue(configText, 'review_model'),
    modelReasoningEffort: topLevelValue(configText, 'model_reasoning_effort'),
    serviceTier: topLevelValue(configText, 'service_tier'),
    modelCatalogJson: topLevelValue(configText, 'model_catalog_json')
  };
}

function customSnapshot(configText, existing) {
  return {
    ...(existing || {}),
    model: topLevelValue(configText, 'model') || existing?.model,
    reviewModel: topLevelValue(configText, 'review_model') || existing?.reviewModel,
    modelReasoningEffort: topLevelValue(configText, 'model_reasoning_effort')
      || existing?.modelReasoningEffort
      || DEFAULT_REASONING_EFFORT
  };
}

async function rememberActiveMode(context, configText, settings) {
  const provider = topLevelValue(configText, 'model_provider') || 'openai';
  if (provider === 'openai') {
    settings.account = accountSnapshot(configText);
    await writeSettings(context, settings);
  } else if (provider === PROVIDER_ID && settings.lab) {
    settings.lab = customSnapshot(configText, settings.lab);
    await writeSettings(context, settings);
  }
}

async function runPowerShell(scriptPath, args, stdinText = '') {
  assertWindows();
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', scriptPath, ...args],
      { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    let outputTooLarge = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, POWERSHELL_TIMEOUT_MS);

    const appendOutput = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > MAX_POWERSHELL_OUTPUT_BYTES) {
        outputTooLarge = true;
        child.kill();
      }
      return next;
    };

    child.stdout.on('data', (chunk) => { stdout = appendOutput(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = appendOutput(stderr, chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('PowerShell 密钥操作超时'));
      } else if (outputTooLarge) {
        reject(new Error('PowerShell 密钥操作输出异常'));
      } else if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
      }
    });
    child.stdin.end(stdinText, 'utf8');
  });
}

async function saveSecret(context, apiKey, baseUrl) {
  const extensionPaths = pathsFor(context);
  const normalizedKey = normalizeApiKey(apiKey);
  const normalizedBaseUrl = normalizeHttpsBaseUrl(baseUrl).baseUrl;
  await ensureDirectories(context);
  await ensureNotSymlink(extensionPaths.secret);
  await runPowerShell(
    extensionPaths.saveSecretScript,
    ['-SecretPath', extensionPaths.secret, '-Binding', normalizedBaseUrl],
    normalizedKey
  );
  await fs.promises.rm(extensionPaths.legacySecret, { force: true });
}

async function secretExists(context) {
  const secretPath = pathsFor(context).secret;
  await ensureNotSymlink(secretPath);
  try {
    const stat = await fs.promises.stat(secretPath);
    return stat.isFile() && stat.size > 0;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function legacySecretExists(context) {
  try {
    const stat = await fs.promises.stat(pathsFor(context).legacySecret);
    return stat.isFile() && stat.size > 0;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function deleteSecrets(context) {
  const extensionPaths = pathsFor(context);
  await ensureNotSymlink(extensionPaths.secret);
  await ensureNotSymlink(extensionPaths.legacySecret);
  await fs.promises.rm(extensionPaths.secret, { force: true });
  await fs.promises.rm(extensionPaths.legacySecret, { force: true });
}

async function confirmEndpoint(baseUrl) {
  const endpoint = normalizeHttpsBaseUrl(baseUrl);
  const choice = await vscode.window.showWarningMessage(
    `确认自定义 API 主机：${endpoint.host}`,
    {
      modal: true,
      detail: `Codex 会把 API Key 和请求内容发送到：\n${endpoint.baseUrl}\n\n只有在你确认该 HTTPS 主机属于可信服务方时才继续。`
    },
    '信任并继续'
  );
  return choice === '信任并继续';
}

async function promptAndSaveSecret(context, baseUrl, canKeepExisting) {
  const keyInput = await vscode.window.showInputBox({
    title: '配置自定义 API Key',
    prompt: canKeepExisting
      ? '粘贴新 API Key；留空则保留当前密钥'
      : '粘贴 API Key（使用 Windows DPAPI 加密，并绑定当前 HTTPS 地址）',
    password: true,
    ignoreFocusOut: true,
    validateInput(value) {
      try {
        normalizeApiKey(value, { required: !canKeepExisting });
        return undefined;
      } catch (error) {
        return errorMessage(error);
      }
    }
  });
  if (keyInput === undefined) {
    return false;
  }
  const normalizedKey = normalizeApiKey(keyInput, { required: !canKeepExisting });
  if (normalizedKey) {
    await saveSecret(context, normalizedKey, baseUrl);
  }
  return true;
}

async function configureCustomApi(context) {
  assertWindows();
  let settings = await readSettings(context);
  const activeConfig = await readConfig(context);
  await rememberActiveMode(context, activeConfig, settings);
  settings = await readSettings(context);
  const existing = settings.lab && typeof settings.lab === 'object' ? settings.lab : {};
  const { selection } = await refreshCustomModelCatalog(context, existing);
  let existingBaseUrl;
  try {
    existingBaseUrl = normalizeHttpsBaseUrl(existing.baseUrl).baseUrl;
  } catch {
    existingBaseUrl = undefined;
  }

  const baseUrlInput = await vscode.window.showInputBox({
    title: '配置自定义 Responses API',
    prompt: 'HTTPS Base URL，例如 https://gateway.example.com/v1',
    value: typeof existing.baseUrl === 'string' ? existing.baseUrl : '',
    placeHolder: 'https://gateway.example.com/v1',
    ignoreFocusOut: true,
    validateInput(value) {
      try {
        normalizeHttpsBaseUrl(value);
        return undefined;
      } catch (error) {
        return errorMessage(error);
      }
    }
  });
  if (baseUrlInput === undefined) {
    return undefined;
  }
  const baseUrl = normalizeHttpsBaseUrl(baseUrlInput).baseUrl;

  if (baseUrl !== existingBaseUrl && !(await confirmEndpoint(baseUrl))) {
    return undefined;
  }

  const hasBoundSecret = await secretExists(context);
  const canKeepExisting = hasBoundSecret && baseUrl === existingBaseUrl;
  if (!(await promptAndSaveSecret(context, baseUrl, canKeepExisting))) {
    return undefined;
  }

  const custom = {
    name: DEFAULT_PROVIDER_NAME,
    baseUrl,
    ...selection,
    httpHeaders: normalizeHeaderMap(existing.httpHeaders)
  };

  const configText = await readConfig(context);
  await rememberActiveMode(context, configText, settings);
  const updatedSettings = await readSettings(context);
  updatedSettings.lab = custom;
  await writeSettings(context, updatedSettings);

  const nextConfig = upsertProviderBlock(configText, context, custom);
  await backupAndWriteConfig(context, configText, nextConfig);
  return custom;
}

async function configureCustomApiAndOfferSwitch(context) {
  const custom = await configureCustomApi(context);
  if (!custom) {
    return;
  }

  const configText = await readConfig(context);
  const current = topLevelValue(configText, 'model_provider') || 'openai';
  if (current === PROVIDER_ID) {
    await updateStatus(context);
    await reloadAfterChange('自定义 API 配置已更新');
    return;
  }

  const action = await vscode.window.showInformationMessage(
    '自定义 API 已安全保存；当前连接仍是 ChatGPT 账户。',
    '立即切换到自定义 API'
  );
  if (action === '立即切换到自定义 API') {
    await useCustomApi(context);
    return;
  }
  await updateStatus(context);
}

async function useCustomApi(context) {
  assertWindows();
  let settings = await readSettings(context);
  let custom;
  try {
    custom = normalizeStoredCustom(settings.lab);
  } catch {
    custom = undefined;
  }

  if (!custom) {
    custom = await configureCustomApi(context);
    if (!custom) {
      return;
    }
    settings = await readSettings(context);
  } else if (!(await secretExists(context))) {
    if (!(await promptAndSaveSecret(context, custom.baseUrl, false))) {
      return;
    }
  }

  let configText = await readConfig(context);
  await rememberActiveMode(context, configText, settings);
  settings = await readSettings(context);
  custom = normalizeStoredCustom(settings.lab);
  const { selection } = await refreshCustomModelCatalog(context, custom);
  custom = { ...custom, ...selection };
  settings.lab = custom;
  await writeSettings(context, settings);

  let nextConfig = upsertProviderBlock(configText, context, custom);
  nextConfig = setTopLevelValue(nextConfig, 'model_provider', PROVIDER_ID);
  nextConfig = setTopLevelValue(nextConfig, 'model', custom.model);
  nextConfig = setTopLevelValue(nextConfig, 'review_model', custom.reviewModel);
  nextConfig = setTopLevelValue(nextConfig, 'model_reasoning_effort', custom.modelReasoningEffort);
  nextConfig = setTopLevelValue(nextConfig, 'service_tier', undefined);
  nextConfig = setTopLevelValue(nextConfig, 'model_catalog_json', pathsFor(context).catalog);
  await backupAndWriteConfig(context, configText, nextConfig);
  await context.globalState.update(PENDING_FRESH_CHAT_KEY, {
    provider: PROVIDER_ID,
    label: '自定义 API'
  });
  await updateStatus(context);
  await reloadAfterSwitch('自定义 API');
}

async function useAccount(context) {
  const settings = await readSettings(context);
  const configText = await readConfig(context);
  await rememberActiveMode(context, configText, settings);
  const updatedSettings = await readSettings(context);
  const account = updatedSettings.account || {};

  let nextConfig = setTopLevelValue(configText, 'model_provider', 'openai');
  nextConfig = setTopLevelValue(nextConfig, 'model', account.model);
  nextConfig = setTopLevelValue(nextConfig, 'review_model', account.reviewModel);
  nextConfig = setTopLevelValue(nextConfig, 'model_reasoning_effort', account.modelReasoningEffort);
  nextConfig = setTopLevelValue(nextConfig, 'service_tier', account.serviceTier);
  nextConfig = setTopLevelValue(nextConfig, 'model_catalog_json', account.modelCatalogJson);
  await backupAndWriteConfig(context, configText, nextConfig);
  await context.globalState.update(PENDING_FRESH_CHAT_KEY, {
    provider: 'openai',
    label: 'ChatGPT 账户'
  });
  await updateStatus(context);
  await reloadAfterSwitch('ChatGPT 账户');
}

async function reloadAfterChange(message) {
  const autoReload = vscode.workspace.getConfiguration('labCodex').get('autoReload', true);
  if (autoReload) {
    vscode.window.setStatusBarMessage(`${message}，正在重载窗口…`, 1500);
    setTimeout(() => {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }, 500);
    return;
  }

  const action = await vscode.window.showInformationMessage(`${message}。重载窗口后生效。`, '立即重载');
  if (action === '立即重载') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

async function reloadAfterSwitch(label) {
  await reloadAfterChange(`Codex 新对话连接已切换到 ${label}`);
}

async function openFreshChatAfterProviderSwitch(context) {
  if (reloadScheduled) {
    return;
  }

  const pending = context.globalState.get(PENDING_FRESH_CHAT_KEY);
  if (!pending || typeof pending !== 'object') {
    return;
  }

  const expectedProvider = pending.provider;
  const expectedLabel = pending.label;
  if (
    (expectedProvider !== 'openai' && expectedProvider !== PROVIDER_ID)
    || typeof expectedLabel !== 'string'
  ) {
    await context.globalState.update(PENDING_FRESH_CHAT_KEY, undefined);
    return;
  }

  const configText = await readConfig(context);
  const currentProvider = topLevelValue(configText, 'model_provider') || 'openai';
  await context.globalState.update(PENDING_FRESH_CHAT_KEY, undefined);
  if (currentProvider !== expectedProvider) {
    await vscode.window.showWarningMessage(
      '连接配置在重载前发生了变化，未自动打开新对话；请重新选择一次连接。'
    );
    return;
  }

  try {
    await vscode.commands.executeCommand('chatgpt.newChat');
    await vscode.window.showInformationMessage(
      `已切换到 ${expectedLabel}，并打开一个使用该连接的新对话。历史列表仍会显示另一种连接的旧会话，但旧会话的 Provider 不会被迁移。`
    );
  } catch (error) {
    await vscode.window.showWarningMessage(
      `已切换到 ${expectedLabel}，但无法自动打开新对话：${errorMessage(error)}。请在 Codex 中手动点击 New Chat。`
    );
  }
}

async function switchConnection(context) {
  const configText = await readConfig(context);
  const current = topLevelValue(configText, 'model_provider') || 'openai';
  const selected = await vscode.window.showQuickPick([
    {
      label: '$(account) ChatGPT 账户',
      description: current === 'openai' ? '新对话当前使用' : '保留现有登录；切换后自动打开新对话',
      target: 'account'
    },
    {
      label: '$(server-process) 自定义 API',
      description: current === PROVIDER_ID ? '新对话当前使用' : '切换后自动打开使用该 API 的新对话',
      target: 'custom'
    },
    {
      label: '$(settings-gear) 配置 / 更新自定义 API',
      description: '保存地址和密钥后可选择立即切换',
      target: 'configure'
    }
  ], {
    title: '切换 Codex 连接',
    placeHolder: '选择 ChatGPT 账户或自定义 API',
    ignoreFocusOut: true
  });

  if (!selected) {
    return;
  }
  if (selected.target === 'account') {
    await useAccount(context);
  } else if (selected.target === 'custom') {
    await useCustomApi(context);
  } else {
    await configureCustomApiAndOfferSwitch(context);
  }
}

async function deleteCustomApiKey(context) {
  const choice = await vscode.window.showWarningMessage(
    '删除本机保存的自定义 API Key？',
    { modal: true, detail: '删除后无法恢复；下次切换到自定义 API 时必须重新输入。' },
    '删除密钥'
  );
  if (choice !== '删除密钥') {
    return;
  }
  await deleteSecrets(context);
  await vscode.window.showInformationMessage('本机保存的自定义 API Key 已删除。');
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function readCodexAsset(assetPath) {
  const stat = await fs.promises.lstat(assetPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Codex 资源不是普通文件，已拒绝修改');
  }
  if (stat.size <= 0 || stat.size > MAX_CODEX_ASSET_BYTES) {
    throw new Error('Codex 资源大小异常，已拒绝修改');
  }
  return fs.promises.readFile(assetPath, 'utf8');
}

async function resolveCodexFile(extensionRoot, candidatePath, label) {
  const stat = await fs.promises.lstat(candidatePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} 不是普通文件`);
  }
  const realPath = await fs.promises.realpath(candidatePath);
  if (!isPathInside(extensionRoot, realPath)) {
    throw new Error(`${label} 路径越界`);
  }
  return realPath;
}

async function inspectCodexSharedHistoryPatch() {
  const codexExtension = vscode.extensions.getExtension(CODEX_EXTENSION_ID);
  if (!codexExtension) {
    return { status: 'not-installed' };
  }

  const version = String(codexExtension.packageJSON.version || 'unknown');
  const extensionRoot = await fs.promises.realpath(codexExtension.extensionPath);
  const hostPath = await resolveCodexFile(
    extensionRoot,
    path.join(extensionRoot, 'out', 'extension.js'),
    'Codex 扩展主程序'
  );
  const hostSource = await readCodexAsset(hostPath);
  const hostResult = patchSharedHistorySource(hostSource);
  if (hostResult.status === 'unsupported') {
    return { status: 'unsupported', version, reason: `扩展主程序：${hostResult.reason}` };
  }

  const assetsPath = path.join(extensionRoot, 'webview', 'assets');
  const assetsStat = await fs.promises.lstat(assetsPath);
  if (assetsStat.isSymbolicLink() || !assetsStat.isDirectory()) {
    return { status: 'unsupported', version, reason: 'Codex webview assets 目录结构异常' };
  }
  const assetsRoot = await fs.promises.realpath(assetsPath);
  if (!isPathInside(extensionRoot, assetsRoot)) {
    return { status: 'unsupported', version, reason: 'Codex webview assets 路径越界' };
  }

  const historyAssets = [];
  const assetNames = await fs.promises.readdir(assetsRoot);
  for (const assetName of assetNames.filter((name) => HISTORY_ASSET_NAME.test(name))) {
    const assetPath = await resolveCodexFile(
      extensionRoot,
      path.join(assetsRoot, assetName),
      'Codex 历史资源'
    );
    const source = await readCodexAsset(assetPath);
    if (source.includes(THREAD_LIST_MARKER)) {
      historyAssets.push({ assetPath, source, result: patchSharedHistorySource(source) });
    }
  }

  if (historyAssets.length !== 1) {
    return {
      status: 'unsupported',
      version,
      reason: `预期找到 1 个历史查询资源，实际找到 ${historyAssets.length} 个`
    };
  }
  if (historyAssets[0].result.status === 'unsupported') {
    return {
      status: 'unsupported',
      version,
      reason: `历史查询资源：${historyAssets[0].result.reason}`
    };
  }

  const inspectedTargets = [
    { assetPath: hostPath, source: hostSource, result: hostResult },
    historyAssets[0]
  ];
  const targets = inspectedTargets
    .filter((target) => target.result.status === 'patched')
    .map((target) => ({
      assetPath: target.assetPath,
      originalSource: target.source,
      patchedSource: target.result.source,
      replacementCount: target.result.replacementCount
    }));

  if (targets.length === 0) {
    return { status: 'already-supported', version };
  }
  return {
    status: 'ready',
    version,
    targets,
    replacementCount: targets.reduce((total, target) => total + target.replacementCount, 0)
  };
}

async function applyCodexSharedHistoryPatch(inspection) {
  const verifiedTargets = [];
  for (const target of inspection.targets) {
    const currentSource = await readCodexAsset(target.assetPath);
    const currentResult = patchSharedHistorySource(currentSource);
    if (currentResult.status === 'already-supported') {
      continue;
    }
    if (currentResult.status !== 'patched' || currentResult.source !== target.patchedSource) {
      throw new Error('Codex 历史资源在确认后发生变化，已取消修复');
    }
    verifiedTargets.push({ ...target, originalSource: currentSource });
  }

  const writtenTargets = [];
  try {
    for (const target of verifiedTargets) {
      const currentSource = await readCodexAsset(target.assetPath);
      if (currentSource !== target.originalSource) {
        throw new Error('Codex 历史资源在写入前发生变化，已取消修复');
      }
      await atomicWriteFile(target.assetPath, target.patchedSource);
      writtenTargets.push(target);
      const verification = patchSharedHistorySource(await readCodexAsset(target.assetPath));
      if (verification.status !== 'already-supported') {
        throw new Error('写入后的共享历史修复未通过结构校验');
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const target of writtenTargets.reverse()) {
      try {
        const currentSource = await readCodexAsset(target.assetPath);
        if (currentSource !== target.patchedSource) {
          rollbackErrors.push('Codex 历史资源在回滚前被其他程序修改，已拒绝覆盖');
          continue;
        }
        await atomicWriteFile(target.assetPath, target.originalSource);
      } catch (rollbackError) {
        rollbackErrors.push(errorMessage(rollbackError));
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${errorMessage(error)}；回滚失败：${rollbackErrors.join('；')}`);
    }
    throw error;
  }

  return { status: writtenTargets.length > 0 ? 'patched' : 'already-supported' };
}

async function inspectCodexMaxPatch() {
  const codexExtension = vscode.extensions.getExtension(CODEX_EXTENSION_ID);
  if (!codexExtension) {
    return { status: 'not-installed' };
  }

  const version = String(codexExtension.packageJSON.version || 'unknown');
  const extensionRoot = await fs.promises.realpath(codexExtension.extensionPath);
  const assetsPath = path.join(extensionRoot, 'webview', 'assets');
  const assetsStat = await fs.promises.lstat(assetsPath);
  if (assetsStat.isSymbolicLink() || !assetsStat.isDirectory()) {
    return { status: 'unsupported', version, reason: 'Codex webview assets 目录结构异常' };
  }
  const assetsRoot = await fs.promises.realpath(assetsPath);
  if (!isPathInside(extensionRoot, assetsRoot)) {
    return { status: 'unsupported', version, reason: 'Codex webview assets 路径越界' };
  }

  const markerFiles = [];
  const assetNames = await fs.promises.readdir(assetsRoot);
  for (const assetName of assetNames.filter((name) => MAX_ASSET_NAME.test(name))) {
    const assetPath = path.join(assetsRoot, assetName);
    const assetStat = await fs.promises.lstat(assetPath);
    if (assetStat.isSymbolicLink() || !assetStat.isFile()) {
      return { status: 'unsupported', version, reason: 'Codex webview 资源不是普通文件' };
    }
    const realAssetPath = await fs.promises.realpath(assetPath);
    if (!isPathInside(assetsRoot, realAssetPath)) {
      return { status: 'unsupported', version, reason: 'Codex webview 资源路径越界' };
    }
    const source = await readCodexAsset(realAssetPath);
    if (source.includes(MAX_SUPPORT_MARKER)) {
      markerFiles.push({ assetPath: realAssetPath, source });
    }
  }

  if (markerFiles.length !== 1) {
    return {
      status: 'unsupported',
      version,
      reason: `预期找到 1 个 Max 支持资源，实际找到 ${markerFiles.length} 个`
    };
  }

  const target = markerFiles[0];
  const result = patchMaxVisibilitySource(target.source);
  if (result.status === 'already-patched') {
    return { status: 'already-patched', version, assetPath: target.assetPath };
  }
  if (result.status !== 'patched') {
    return { status: 'unsupported', version, reason: result.reason };
  }
  return {
    status: 'ready',
    version,
    assetPath: target.assetPath,
    patchedSource: result.source
  };
}

async function applyCodexMaxPatch(inspection) {
  const currentSource = await readCodexAsset(inspection.assetPath);
  const currentResult = patchMaxVisibilitySource(currentSource);
  if (currentResult.status === 'already-patched') {
    return { status: 'already-patched' };
  }
  if (currentResult.status !== 'patched' || currentResult.source !== inspection.patchedSource) {
    throw new Error('Codex webview 在确认后发生变化，已取消修复');
  }

  try {
    await atomicWriteFile(inspection.assetPath, currentResult.source);
    const verification = patchMaxVisibilitySource(await readCodexAsset(inspection.assetPath));
    if (verification.status !== 'already-patched') {
      throw new Error('写入后的 Max 修复未通过结构校验');
    }
  } catch (error) {
    try {
      const writtenSource = await readCodexAsset(inspection.assetPath);
      if (writtenSource === currentResult.source) {
        await atomicWriteFile(inspection.assetPath, currentSource);
      } else if (writtenSource !== currentSource) {
        throw new Error('Codex Max 资源在回滚前被其他程序修改，已拒绝覆盖');
      }
    } catch (rollbackError) {
      throw new Error(`${errorMessage(error)}；回滚失败：${errorMessage(rollbackError)}`);
    }
    throw error;
  }
  return { status: 'patched' };
}

function scheduleWindowReload(message) {
  if (reloadScheduled) {
    return;
  }
  reloadScheduled = true;
  vscode.window.setStatusBarMessage(message, 2500);
  setTimeout(() => {
    vscode.commands.executeCommand('workbench.action.reloadWindow');
  }, 800);
}

async function requestMaxPatchConsent(context, version) {
  const choice = await vscode.window.showWarningMessage(
    '让 Codex 对话框显示 Max 推理等级？',
    {
      modal: true,
      detail: `Codex ${version} 当前会隐藏模型目录中已经声明支持的 Max 档。\n\n修复会在严格校验后修改官方 Codex 扩展的一处本地 webview 过滤器；官方扩展更新会覆盖该修改，切换器可在再次校验后自动恢复。`
    },
    '修复 Max 并重载'
  );
  const accepted = choice === '修复 Max 并重载';
  await context.globalState.update(MAX_PATCH_CONSENT_KEY, accepted || undefined);
  await context.globalState.update(MAX_PATCH_DISMISSED_KEY, accepted ? undefined : true);
  return accepted;
}

async function finishMaxPatch(version) {
  const configuration = vscode.workspace.getConfiguration('labCodex');
  if (configuration.get('autoReloadAfterMaxPatch', true)) {
    scheduleWindowReload(`Codex ${version} 的 Max 档已恢复，正在重载窗口…`);
    return;
  }
  const action = await vscode.window.showInformationMessage(
    `Codex ${version} 的 Max 档已恢复；重载窗口后生效。`,
    '立即重载'
  );
  if (action === '立即重载') {
    scheduleWindowReload('Codex Max 档已恢复，正在重载窗口…');
  }
}

async function requestSharedHistoryPatchConsent(context, version, replacementCount) {
  const choice = await vscode.window.showWarningMessage(
    '让 ChatGPT 账户与自定义 API 共享本地历史？',
    {
      modal: true,
      detail: `Codex ${version} 的历史查询会把不同 Provider 的本地对话分开。\n\n修复会在严格校验后，把官方 Codex 扩展中 ${replacementCount} 个按当前 Provider 查询的参数统一改为空数组；不会读取、复制或修改任何对话记录，也不会迁移旧会话记录的 Provider。切换连接后请使用自动打开的新对话。\n\n官方扩展更新会覆盖该修改，切换器可在再次校验后自动恢复。`
    },
    '共享历史并重载'
  );
  const accepted = choice === '共享历史并重载';
  await context.globalState.update(HISTORY_PATCH_CONSENT_KEY, accepted || undefined);
  await context.globalState.update(HISTORY_PATCH_DISMISSED_KEY, accepted ? undefined : true);
  return accepted;
}

async function finishSharedHistoryPatch(version) {
  const configuration = vscode.workspace.getConfiguration('labCodex');
  if (configuration.get('autoReloadAfterSharedHistoryPatch', true)) {
    scheduleWindowReload(`Codex ${version} 的账户/API 历史已合并显示，正在重载窗口…`);
    return;
  }
  const action = await vscode.window.showInformationMessage(
    `Codex ${version} 的账户/API 历史已合并显示；重载窗口后生效。`,
    '立即重载'
  );
  if (action === '立即重载') {
    scheduleWindowReload('Codex 共享历史修复已完成，正在重载窗口…');
  }
}

async function ensureCodexSharedHistory(context, { manual = false, deferReload = false } = {}) {
  const configuration = vscode.workspace.getConfiguration('labCodex');
  if (!manual && !configuration.get('autoPatchSharedHistory', true)) {
    return { status: 'disabled' };
  }

  let inspection;
  try {
    inspection = await inspectCodexSharedHistoryPatch();
  } catch (error) {
    inspection = { status: 'unsupported', version: 'unknown', reason: errorMessage(error) };
  }

  if (inspection.status === 'already-supported') {
    if (manual) {
      await vscode.window.showInformationMessage(
        `Codex ${inspection.version} 已使用同一列表显示 ChatGPT 账户与自定义 API 历史。`
      );
    }
    return inspection;
  }
  if (inspection.status === 'not-installed') {
    if (manual) {
      await vscode.window.showWarningMessage('未找到官方 OpenAI Codex VS Code 扩展。');
    }
    return inspection;
  }
  if (inspection.status !== 'ready') {
    const warningKey = `shared-history-patch-warning:${inspection.version}`;
    if (manual || context.globalState.get(warningKey) !== inspection.reason) {
      await context.globalState.update(warningKey, inspection.reason);
      await vscode.window.showWarningMessage(
        `无法安全恢复 Codex ${inspection.version} 的账户/API 共享历史：${inspection.reason}`
      );
    }
    return inspection;
  }

  let consented = context.globalState.get(HISTORY_PATCH_CONSENT_KEY) === true;
  if (!consented) {
    if (!manual && context.globalState.get(HISTORY_PATCH_DISMISSED_KEY) === true) {
      return { status: 'declined', version: inspection.version };
    }
    consented = await requestSharedHistoryPatchConsent(
      context,
      inspection.version,
      inspection.replacementCount
    );
    if (!consented) {
      return { status: 'declined', version: inspection.version };
    }
  }

  let result;
  try {
    result = await applyCodexSharedHistoryPatch(inspection);
  } catch (error) {
    const reason = errorMessage(error);
    const warningKey = `shared-history-patch-write-warning:${inspection.version}`;
    if (manual || context.globalState.get(warningKey) !== reason) {
      await context.globalState.update(warningKey, reason);
      await vscode.window.showWarningMessage(
        `Codex ${inspection.version} 的共享历史修复写入失败：${reason}`
      );
    }
    return { status: 'error', version: inspection.version, reason };
  }
  if (result.status === 'patched' && !deferReload) {
    await finishSharedHistoryPatch(inspection.version);
  }
  return { ...result, version: inspection.version, feature: 'shared-history' };
}

async function ensureCodexMaxVisible(context, { manual = false, deferReload = false } = {}) {
  const configuration = vscode.workspace.getConfiguration('labCodex');
  if (!manual && !configuration.get('autoPatchMax', true)) {
    return { status: 'disabled' };
  }

  let inspection;
  try {
    inspection = await inspectCodexMaxPatch();
  } catch (error) {
    inspection = { status: 'unsupported', version: 'unknown', reason: errorMessage(error) };
  }

  if (inspection.status === 'already-patched') {
    if (manual) {
      await vscode.window.showInformationMessage(`Codex ${inspection.version} 的 Max 档已经可见。`);
    }
    return inspection;
  }
  if (inspection.status === 'not-installed') {
    if (manual) {
      await vscode.window.showWarningMessage('未找到官方 OpenAI Codex VS Code 扩展。');
    }
    return inspection;
  }
  if (inspection.status !== 'ready') {
    const warningKey = `max-patch-warning:${inspection.version}`;
    if (manual || context.globalState.get(warningKey) !== inspection.reason) {
      await context.globalState.update(warningKey, inspection.reason);
      await vscode.window.showWarningMessage(
        `无法安全恢复 Codex ${inspection.version} 的 Max 档：${inspection.reason}`
      );
    }
    return inspection;
  }

  let consented = context.globalState.get(MAX_PATCH_CONSENT_KEY) === true;
  if (!consented) {
    if (!manual && context.globalState.get(MAX_PATCH_DISMISSED_KEY) === true) {
      return { status: 'declined', version: inspection.version };
    }
    consented = await requestMaxPatchConsent(context, inspection.version);
    if (!consented) {
      return { status: 'declined', version: inspection.version };
    }
  }

  let result;
  try {
    result = await applyCodexMaxPatch(inspection);
  } catch (error) {
    const reason = errorMessage(error);
    const warningKey = `max-patch-write-warning:${inspection.version}`;
    if (manual || context.globalState.get(warningKey) !== reason) {
      await context.globalState.update(warningKey, reason);
      await vscode.window.showWarningMessage(`Codex ${inspection.version} 的 Max 修复写入失败：${reason}`);
    }
    return { status: 'error', version: inspection.version, reason };
  }
  if (result.status === 'patched' && !deferReload) {
    await finishMaxPatch(inspection.version);
  }
  return { ...result, version: inspection.version, feature: 'max' };
}

async function finishDeferredCompatibilityPatches(results) {
  const patched = results.filter((result) => result && result.status === 'patched');
  if (patched.length === 0) {
    return;
  }

  const configuration = vscode.workspace.getConfiguration('labCodex');
  const shouldAutoReload = patched.every((result) => (
    result.feature === 'shared-history'
      ? configuration.get('autoReloadAfterSharedHistoryPatch', true)
      : configuration.get('autoReloadAfterMaxPatch', true)
  ));
  const labels = patched.map((result) => (
    result.feature === 'shared-history' ? '账户/API 共享历史' : 'Max 推理等级'
  ));
  const summary = labels.join('、');
  const version = patched.find((result) => result.version)?.version || 'unknown';

  if (shouldAutoReload) {
    scheduleWindowReload(`Codex ${version} 的${summary}修复已完成，正在重载窗口…`);
    return;
  }
  const action = await vscode.window.showInformationMessage(
    `Codex ${version} 的${summary}修复已完成；重载窗口后生效。`,
    '立即重载'
  );
  if (action === '立即重载') {
    scheduleWindowReload(`Codex ${summary}修复已完成，正在重载窗口…`);
  }
}

async function runAutomaticCompatibilityRepairs(context) {
  const historyResult = await ensureCodexSharedHistory(context, { deferReload: true });
  const maxResult = await ensureCodexMaxVisible(context, { deferReload: true });
  await finishDeferredCompatibilityPatches([historyResult, maxResult]);
}

function queueCompatibilityPatchCheck(context) {
  clearTimeout(compatibilityPatchTimer);
  compatibilityPatchTimer = setTimeout(() => {
    runAutomaticCompatibilityRepairs(context).catch((error) => {
      console.error('Codex compatibility patch check failed', error);
    });
  }, 1200);
}

async function updateStatus(context) {
  if (!statusBarItem) {
    return;
  }
  try {
    const configText = await readConfig(context);
    const current = topLevelValue(configText, 'model_provider') || 'openai';
    const reasoningEffort = normalizeReasoningEffort(topLevelValue(configText, 'model_reasoning_effort'));
    const reasoningLabel = reasoningEffort ? `推理等级：${reasoningEffort}。` : '';
    if (current === PROVIDER_ID) {
      statusBarItem.text = '$(server-process) Codex 新对话: API';
      statusBarItem.tooltip = await secretExists(context)
        ? `新对话将使用自定义 HTTPS Responses API。旧会话不会迁移 Provider。${reasoningLabel}点击切换连接。`
        : `新对话已选择自定义 API，但需要重新输入 API Key。旧会话不会迁移 Provider。${reasoningLabel}`;
    } else {
      statusBarItem.text = '$(account) Codex 新对话: 账户';
      statusBarItem.tooltip = `新对话将使用 ChatGPT 账户。旧会话不会迁移 Provider。${reasoningLabel}点击切换连接。`;
    }
  } catch (error) {
    statusBarItem.text = '$(warning) Codex: 连接配置错误';
    statusBarItem.tooltip = errorMessage(error);
  }
  statusBarItem.show();
}

async function repairManagedBlockAfterUpdate(context, configText, settings) {
  if (!configText.includes(MANAGED_BEGIN) || !settings.lab) {
    return configText;
  }
  const custom = normalizeStoredCustom(settings.lab);
  const nextConfig = upsertProviderBlock(configText, context, custom);
  await backupAndWriteConfig(context, configText, nextConfig);
  return nextConfig;
}

function registerSafeCommand(context, command, handler) {
  context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
    try {
      return await handler();
    } catch (error) {
      await vscode.window.showErrorMessage(`Codex Provider Switcher：${errorMessage(error)}`);
      return undefined;
    }
  }));
}

async function stopForLegacyExtensionConflict() {
  const legacyExtension = vscode.extensions.getExtension(LEGACY_EXTENSION_ID);
  if (!legacyExtension) {
    return false;
  }

  const action = await vscode.window.showWarningMessage(
    '检测到会抢占同名命令的旧版 Codex Provider Switcher。',
    {
      modal: true,
      detail: `请先卸载 ${LEGACY_EXTENSION_ID}，只保留 e50max.codex-provider-switcher，然后运行 Developer: Reload Window。为避免写入冲突，本版本本次不会修改任何配置或 Codex 文件。`
    },
    '打开扩展面板'
  );
  if (action === '打开扩展面板') {
    try {
      await vscode.commands.executeCommand('workbench.view.extensions');
      await vscode.commands.executeCommand('workbench.extensions.search', `@id:${LEGACY_EXTENSION_ID}`);
    } catch {
      await vscode.window.showInformationMessage(`请在扩展面板搜索并卸载：${LEGACY_EXTENSION_ID}`);
    }
  }
  return true;
}

async function activate(context) {
  if (await stopForLegacyExtensionConflict()) {
    return;
  }
  await ensureDirectories(context);
  let configText = await readConfig(context);
  const settings = await readSettings(context);
  await rememberActiveMode(context, configText, settings);

  try {
    configText = await repairManagedBlockAfterUpdate(context, configText, await readSettings(context));
  } catch (error) {
    await vscode.window.showWarningMessage(`无法安全更新自定义 API 配置：${errorMessage(error)}`);
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'labCodex.switchConnection';
  context.subscriptions.push(statusBarItem);

  registerSafeCommand(context, 'labCodex.switchConnection', () => switchConnection(context));
  registerSafeCommand(context, 'labCodex.configureLab', () => configureCustomApiAndOfferSwitch(context));
  registerSafeCommand(context, 'labCodex.useAccount', () => useAccount(context));
  registerSafeCommand(context, 'labCodex.useLab', () => useCustomApi(context));
  registerSafeCommand(context, 'labCodex.repairSharedHistory', () => {
    assertWindows();
    return ensureCodexSharedHistory(context, { manual: true });
  });
  registerSafeCommand(context, 'labCodex.repairMaxOption', () => {
    assertWindows();
    return ensureCodexMaxVisible(context, { manual: true });
  });
  registerSafeCommand(context, 'labCodex.deleteLabKey', () => deleteCustomApiKey(context));
  context.subscriptions.push(vscode.extensions.onDidChange(() => queueCompatibilityPatchCheck(context)));

  if (await legacySecretExists(context) && !(await secretExists(context))) {
    const warningKey = 'v2-bound-secret-migration-warning';
    if (context.globalState.get(warningKey) !== true) {
      await context.globalState.update(warningKey, true);
      await vscode.window.showWarningMessage('安全升级已启用“密钥绑定 HTTPS 地址”；请重新输入一次自定义 API Key。');
    }
  }

  if (process.platform !== 'win32') {
    await vscode.window.showWarningMessage('Codex Provider Switcher 当前仅支持 Windows DPAPI。');
  } else {
    await runAutomaticCompatibilityRepairs(context);
  }
  await updateStatus(context);
  await openFreshChatAfterProviderSwitch(context);
}

function deactivate() {
  clearTimeout(compatibilityPatchTimer);
}

module.exports = { activate, deactivate };

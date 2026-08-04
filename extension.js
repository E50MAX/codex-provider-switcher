'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const {
  REASONING_EFFORT_PRESETS,
  normalizeApiKey,
  normalizeHeaderMap,
  normalizeHttpsBaseUrl,
  normalizeModelId,
  normalizeReasoningEffort
} = require('./lib/validation');

const PROVIDER_ID = 'lab_relay';
const MANAGED_BEGIN = '# >>> codex-provider-switcher: lab_relay >>>';
const MANAGED_END = '# <<< codex-provider-switcher: lab_relay <<<';
const DEFAULT_PROVIDER_NAME = 'Custom Responses API';
const DEFAULT_REASONING_EFFORT = 'max';
const REASONING_EFFORT_DESCRIPTIONS = Object.freeze({
  ultra: '最深推理；仅在模型支持时使用',
  max: '极高推理；仅在模型支持时使用',
  xhigh: '超高推理；仅在模型支持时使用',
  high: '适合复杂逻辑、审查和边界情况',
  medium: '质量、速度与消耗较均衡',
  low: '适合直接任务，响应更快',
  minimal: '最低推理；仅在模型支持时使用'
});
const MAX_SETTINGS_BYTES = 1024 * 1024;
const MAX_POWERSHELL_OUTPUT_BYTES = 64 * 1024;
const POWERSHELL_TIMEOUT_MS = 15000;

let statusBarItem;

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
  const newline = newlineOf(text);
  const lines = text.split(/\r?\n/);
  const tableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const topEnd = tableIndex === -1 ? lines.length : tableIndex;
  const matcher = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const index = lines.slice(0, topEnd).findIndex((line) => matcher.test(line));

  if (value === undefined || value === null || value === '') {
    if (index !== -1) {
      lines.splice(index, 1);
    }
    return lines.join(newline);
  }

  const replacement = `${key} = ${tomlString(value)}`;
  if (index !== -1) {
    lines[index] = replacement;
  } else {
    let insertAt = tableIndex === -1 ? lines.length : tableIndex;
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
      insertAt -= 1;
    }
    lines.splice(insertAt, 0, replacement);
  }
  return lines.join(newline);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeManagedBlock(text) {
  const pattern = new RegExp(
    `(?:\\r?\\n)?${escapeRegex(MANAGED_BEGIN)}[\\s\\S]*?${escapeRegex(MANAGED_END)}(?:\\r?\\n)?`,
    'g'
  );
  return text.replace(pattern, newlineOf(text)).replace(/(?:\r?\n){3,}/g, `${newlineOf(text)}${newlineOf(text)}`);
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
  const clean = removeManagedBlock(text).trimEnd();
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
  } catch (error) {
    if (!error || !['EEXIST', 'EPERM'].includes(error.code)) {
      throw error;
    }
    await fs.promises.copyFile(temporaryPath, filePath);
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

async function selectReasoningEffort(existingEffort) {
  let currentEffort = DEFAULT_REASONING_EFFORT;
  try {
    currentEffort = normalizeReasoningEffort(existingEffort) || DEFAULT_REASONING_EFFORT;
  } catch {
    currentEffort = DEFAULT_REASONING_EFFORT;
  }

  const presetValues = [...REASONING_EFFORT_PRESETS].reverse();
  const items = presetValues.map((effort) => ({
    label: effort === 'ultra' ? '$(star-full) ultra' : effort,
    description: `${effort === currentEffort ? '当前 · ' : ''}${REASONING_EFFORT_DESCRIPTIONS[effort]}`,
    effort
  }));
  if (!presetValues.includes(currentEffort)) {
    items.unshift({
      label: currentEffort,
      description: '当前配置中的自定义档位',
      effort: currentEffort
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: '设置 Codex 推理等级',
    placeHolder: '档位必须由当前模型和 API 服务支持',
    ignoreFocusOut: true,
    matchOnDescription: true
  });
  return selected?.effort;
}

async function configureCustomApi(context) {
  assertWindows();
  const settings = await readSettings(context);
  const existing = settings.lab && typeof settings.lab === 'object' ? settings.lab : {};
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

  const modelInput = await vscode.window.showInputBox({
    title: '配置自定义 Responses API',
    prompt: '服务方提供的模型 ID',
    value: typeof existing.model === 'string' ? existing.model : '',
    ignoreFocusOut: true,
    validateInput(value) {
      try {
        normalizeModelId(value);
        return undefined;
      } catch (error) {
        return errorMessage(error);
      }
    }
  });
  if (modelInput === undefined) {
    return undefined;
  }
  const model = normalizeModelId(modelInput);

  const modelReasoningEffort = await selectReasoningEffort(existing.modelReasoningEffort);
  if (!modelReasoningEffort) {
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
    model,
    reviewModel: model,
    modelReasoningEffort,
    httpHeaders: normalizeHeaderMap(existing.httpHeaders)
  };

  const configText = await readConfig(context);
  await rememberActiveMode(context, configText, settings);
  const updatedSettings = await readSettings(context);
  updatedSettings.lab = custom;
  await writeSettings(context, updatedSettings);

  const nextConfig = upsertProviderBlock(configText, context, custom);
  await backupAndWriteConfig(context, configText, nextConfig);
  await vscode.window.showInformationMessage('自定义 API 已安全保存；ChatGPT 登录未被修改。');
  return custom;
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

  let nextConfig = upsertProviderBlock(configText, context, custom);
  nextConfig = setTopLevelValue(nextConfig, 'model_provider', PROVIDER_ID);
  nextConfig = setTopLevelValue(nextConfig, 'model', custom.model);
  nextConfig = setTopLevelValue(nextConfig, 'review_model', custom.reviewModel);
  nextConfig = setTopLevelValue(nextConfig, 'model_reasoning_effort', custom.modelReasoningEffort);
  nextConfig = setTopLevelValue(nextConfig, 'service_tier', undefined);
  nextConfig = setTopLevelValue(nextConfig, 'model_catalog_json', undefined);
  await backupAndWriteConfig(context, configText, nextConfig);
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
  await reloadAfterChange(`Codex 已切换到 ${label}`);
}

async function setReasoningEffort(context) {
  const configText = await readConfig(context);
  const provider = topLevelValue(configText, 'model_provider') || 'openai';
  if (provider !== 'openai' && provider !== PROVIDER_ID) {
    throw new Error('当前模型服务商不受本切换器管理，已拒绝改写推理等级');
  }

  const currentEffort = normalizeReasoningEffort(topLevelValue(configText, 'model_reasoning_effort'))
    || DEFAULT_REASONING_EFFORT;
  const selectedEffort = await selectReasoningEffort(currentEffort);
  if (!selectedEffort) {
    return;
  }
  if (selectedEffort === currentEffort) {
    await vscode.window.showInformationMessage(`Codex 推理等级已经是 ${selectedEffort}。`);
    return;
  }

  const settings = await readSettings(context);
  await rememberActiveMode(context, configText, settings);
  const updatedSettings = await readSettings(context);
  if (provider === 'openai') {
    updatedSettings.account = {
      ...(updatedSettings.account || accountSnapshot(configText)),
      modelReasoningEffort: selectedEffort
    };
  } else {
    if (!updatedSettings.lab) {
      throw new Error('请先配置自定义 API');
    }
    updatedSettings.lab = {
      ...customSnapshot(configText, updatedSettings.lab),
      modelReasoningEffort: selectedEffort
    };
  }
  await writeSettings(context, updatedSettings);

  const nextConfig = setTopLevelValue(configText, 'model_reasoning_effort', selectedEffort);
  await backupAndWriteConfig(context, configText, nextConfig);
  await updateStatus(context);
  await reloadAfterChange(`Codex 推理等级已设置为 ${selectedEffort}`);
}

async function switchConnection(context) {
  const configText = await readConfig(context);
  const current = topLevelValue(configText, 'model_provider') || 'openai';
  const selected = await vscode.window.showQuickPick([
    {
      label: '$(account) ChatGPT 账户',
      description: current === 'openai' ? '当前使用' : '保留现有登录，切回官方账户',
      target: 'account'
    },
    {
      label: '$(server-process) 自定义 API',
      description: current === PROVIDER_ID ? '当前使用' : '使用可信的 HTTPS Responses API',
      target: 'custom'
    },
    {
      label: '$(settings-gear) 配置自定义 API',
      description: '设置 HTTPS Base URL、模型 ID 和加密密钥',
      target: 'configure'
    },
    {
      label: '$(dashboard) 设置推理等级',
      description: '包含 ultra、max、xhigh、high、medium、low 和 minimal',
      target: 'reasoning'
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
  } else if (selected.target === 'reasoning') {
    await setReasoningEffort(context);
  } else {
    await configureCustomApi(context);
    await updateStatus(context);
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
      statusBarItem.text = '$(server-process) Codex: 自定义 API';
      statusBarItem.tooltip = await secretExists(context)
        ? `当前使用自定义 HTTPS Responses API。${reasoningLabel}点击切换连接。`
        : `当前使用自定义 API，但需要重新输入 API Key。${reasoningLabel}`;
    } else {
      statusBarItem.text = '$(account) Codex: ChatGPT 账户';
      statusBarItem.tooltip = `当前使用 ChatGPT 账户。${reasoningLabel}点击切换连接。`;
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

async function activate(context) {
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
  registerSafeCommand(context, 'labCodex.configureLab', () => configureCustomApi(context));
  registerSafeCommand(context, 'labCodex.useAccount', () => useAccount(context));
  registerSafeCommand(context, 'labCodex.useLab', () => useCustomApi(context));
  registerSafeCommand(context, 'labCodex.setReasoningEffort', () => setReasoningEffort(context));
  registerSafeCommand(context, 'labCodex.deleteLabKey', () => deleteCustomApiKey(context));

  if (await legacySecretExists(context) && !(await secretExists(context))) {
    const warningKey = 'v2-bound-secret-migration-warning';
    if (context.globalState.get(warningKey) !== true) {
      await context.globalState.update(warningKey, true);
      await vscode.window.showWarningMessage('安全升级已启用“密钥绑定 HTTPS 地址”；请重新输入一次自定义 API Key。');
    }
  }

  if (process.platform !== 'win32') {
    await vscode.window.showWarningMessage('Codex Provider Switcher 当前仅支持 Windows DPAPI。');
  }
  await updateStatus(context);
}

function deactivate() {}

module.exports = { activate, deactivate };

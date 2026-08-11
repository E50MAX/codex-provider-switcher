import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = new Set(['.git', 'dist', 'node_modules']);
const excludedFiles = new Set([path.join('tools', 'audit-source.mjs')]);

function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...listFiles(path.join(directory, entry.name), relativePath));
      }
    } else if (!excludedFiles.has(relativePath)) {
      files.push(relativePath);
    }
  }
  return files;
}

const sourceFiles = listFiles(root);
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
  /["'](?:api[_-]?key|token|secret)["']\s*:\s*["'][^"']{12,}["']/gi,
  /[A-Z]:\\Users\\[^\\\r\n]+/g
];

const findings = [];
for (const relativePath of sourceFiles) {
  const fullPath = path.join(root, relativePath);
  const buffer = fs.readFileSync(fullPath);
  if (buffer.includes(0)) {
    continue;
  }
  const text = buffer.toString('utf8');
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      findings.push(`${relativePath}: possible credential or personal path`);
    }
  }
}

const runtimeFiles = [
  'extension.js',
  path.join('lib', 'validation.js'),
  path.join('lib', 'config-text.js'),
  path.join('lib', 'model-catalog.js'),
  path.join('lib', 'max-patch.js'),
  path.join('lib', 'history-patch.js'),
  path.join('lib', 'provider-takeover-patch.js'),
  path.join('lib', 'transactional-write.js'),
  path.join('scripts', 'get-secret.ps1'),
  path.join('scripts', 'save-secret.ps1')
];
const runtimeText = runtimeFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const forbiddenRuntimePatterns = [
  /ExecutionPolicy[\s\S]{0,40}Bypass/i,
  /patchCodexMaxVisibility/,
  /DEFAULT_LAB_BASE_URL/,
  /http:\/\//i
];
for (const pattern of forbiddenRuntimePatterns) {
  if (pattern.test(runtimeText)) {
    findings.push(`runtime source matches forbidden pattern: ${pattern}`);
  }
}

const extensionText = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
const requiredMaxPatchSafeguards = [
  /MAX_PATCH_CONSENT_KEY/,
  /markerFiles\.length !== 1/,
  /assetStat\.isSymbolicLink\(\)/,
  /replaceVerified/,
  /patchMaxVisibilitySource/,
  /Max 资源在回滚前被其他程序修改/,
  /currentSource === patchedSource/
];
for (const pattern of requiredMaxPatchSafeguards) {
  if (!pattern.test(runtimeText)) {
    findings.push(`Max visibility repair is missing safeguard: ${pattern}`);
  }
}

const requiredHistoryPatchSafeguards = [
  /HISTORY_PATCH_CONSENT_KEY/,
  /historyAssets\.length !== 1/,
  /resolveCodexFile/,
  /writeVerifiedBatch/,
  /patchSharedHistorySource/,
  /currentSource !== target\.patchedSource/
];
for (const pattern of requiredHistoryPatchSafeguards) {
  if (!pattern.test(runtimeText)) {
    findings.push(`Shared-history repair is missing safeguard: ${pattern}`);
  }
}

const requiredProviderTakeoverSafeguards = [
  /PROVIDER_TAKEOVER_CONSENT_KEY/,
  /candidates\.length !== 1/,
  /PROVIDER_TAKEOVER_UI_ASSET_NAME/,
  /PROVIDER_TAKEOVER_CONVERSATION_ASSET_NAME/,
  /localTaskRow\.resumeLiveWriterError/,
  /localConversation\.writerConflict\.retry/,
  /This is open in another app/,
  /verifyProviderTakeoverComposerGateSource/,
  /isWriterConflict:/,
  /patchProviderTakeoverSource/,
  /replaceVerified/,
  /codexProviderSwitcherExpectedProvider/,
  /config\/read/,
  /codexProviderSwitcherEffectiveConfig\.model_provider/,
  /codexProviderSwitcherResumeParams\.modelProvider=/,
  /codexProviderSwitcherEffectiveConfig\.model/,
  /codexProviderSwitcherResumeParams\.model=/,
  /model\/list/,
  /current model catalog is incomplete; sending is blocked/,
  /codexProviderSwitcherEffectiveConfig\.model_reasoning_effort/,
  /model_reasoning_effort:codexProviderSwitcherExpectedEffort/,
  /account\/read/,
  /refreshToken:false/,
  /no ChatGPT account is signed in; sending is blocked/,
  /current provider config could not be read; sending is blocked/,
  /selected provider is invalid; sending is blocked/,
  /WRITER_CONFLICT_RETRY_LIMIT/,
  /codexProviderSwitcherResumeAttempt/,
  /includes\('already has an active writer'\)/,
  /thread\/unsubscribe/,
  /codexProviderSwitcherUnsubscribeResult\.status/,
  /unsubscribed/,
  /active thread provider mismatch; sending is blocked/,
  /provider mismatch requires a window reload; sending is blocked/,
  /runtime selection mismatch requires a window reload; sending is blocked/,
  /upgradeIntermediateProviderTakeoverSource/,
  /upgradePreviousProviderTakeoverSource/,
  /upgradeOlderProviderTakeoverSource/,
  /upgradeLegacyProviderTakeoverSource/,
  /Provider 接管资源在回滚前被其他程序修改/
];
for (const pattern of requiredProviderTakeoverSafeguards) {
  if (!pattern.test(runtimeText)) {
    findings.push(`Provider takeover repair is missing safeguard: ${pattern}`);
  }
}

const requiredCredentialSafeguards = [
  /Managed provider is not the active model provider/,
  /Managed provider markers are missing or ambiguous/,
  /Encrypted secret file has an invalid size/,
  /Refusing to store a secret inside a reparse-point directory/
];
for (const pattern of requiredCredentialSafeguards) {
  if (!pattern.test(runtimeText)) {
    findings.push(`Credential handling is missing safeguard: ${pattern}`);
  }
}

if (/\[System\.IO\.File\]::Delete\(\$SecretPath\)/.test(runtimeText)) {
  findings.push('Credential replacement contains a delete-before-move fallback');
}

if (!/LEGACY_EXTENSION_ID/.test(extensionText) || !/stopForLegacyExtensionConflict/.test(extensionText)) {
  findings.push('Legacy extension collision guard is missing');
}

const requiredRoutingSafeguards = [
  /PENDING_PROVIDER_SWITCH_KEY/,
  /prepareProviderSwitch/,
  /completeProviderSwitchAfterReload/,
  /providerTakeoverState !== 'ready'/,
  /workbench\.action\.reloadWindow/
];
for (const pattern of requiredRoutingSafeguards) {
  if (!pattern.test(extensionText)) {
    findings.push(`Provider routing is missing a takeover safeguard: ${pattern}`);
  }
}
if (/executeCommand\('chatgpt\.newChat'\)/.test(extensionText)) {
  findings.push('Provider switching must not discard the current thread by forcing a new chat');
}

const runtimeUrls = runtimeText.match(/https:\/\/[^\s'"`]+/g) || [];
for (const rawUrl of runtimeUrls) {
  const cleaned = rawUrl.replace(/[),.;]+$/, '');
  const hostname = new URL(cleaned).hostname;
  if (!hostname.endsWith('.example.com')) {
    findings.push(`runtime source contains a non-example URL: ${cleaned}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const contributedCommands = new Set(
  (manifest.contributes?.commands || []).map((entry) => entry.command)
);
const requiredCommands = [
  'labCodex.repairSharedHistory',
  'labCodex.repairProviderTakeover',
  'labCodex.repairMaxOption'
];
for (const command of requiredCommands) {
  if (!contributedCommands.has(command)) {
    findings.push(`package.json is missing required repair command: ${command}`);
  }
  if (!(manifest.activationEvents || []).includes(`onCommand:${command}`)) {
    findings.push(`package.json is missing activation event for: ${command}`);
  }
}

const configurationProperties = manifest.contributes?.configuration?.properties || {};
for (const setting of [
  'labCodex.autoPatchProviderTakeover',
  'labCodex.autoPatchSharedHistory',
  'labCodex.autoPatchMax'
]) {
  if (configurationProperties[setting]?.type !== 'boolean') {
    findings.push(`package.json is missing boolean repair setting: ${setting}`);
  }
}

const workflowText = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const actionUses = [...workflowText.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
if (actionUses.length === 0 || actionUses.some((value) => !/@[0-9a-f]{40}$/.test(value))) {
  findings.push('GitHub Actions must be pinned to immutable 40-character commit SHAs');
}
if (!/^permissions:\s*\r?\n\s+contents:\s*read\s*$/m.test(workflowText)) {
  findings.push('GitHub Actions workflow is missing read-only contents permissions');
}
if (/pull_request_target\s*:/m.test(workflowText)) {
  findings.push('GitHub Actions workflow must not run untrusted code via pull_request_target');
}

const allowedFileEntries = new Set([
  'extension.js',
  'lib/**',
  'scripts/get-secret.ps1',
  'scripts/save-secret.ps1',
  'README.md',
  'SECURITY.md',
  'PRIVACY.md',
  'CHANGELOG.md',
  'LICENSE.txt',
  'Logo.png'
]);
for (const entry of manifest.files || []) {
  if (!allowedFileEntries.has(entry)) {
    findings.push(`package.json files contains an unexpected entry: ${entry}`);
  }
}
if ((manifest.files || []).length !== allowedFileEntries.size) {
  findings.push('package.json files allowlist is incomplete or duplicated');
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log(`Security audit passed for ${sourceFiles.length} source files.`);

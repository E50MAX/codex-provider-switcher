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
  /verification\.status !== 'already-patched'/,
  /patchMaxVisibilitySource/
];
for (const pattern of requiredMaxPatchSafeguards) {
  if (!pattern.test(extensionText)) {
    findings.push(`Max visibility repair is missing safeguard: ${pattern}`);
  }
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
const allowedFileEntries = new Set([
  'extension.js',
  'lib/**',
  'scripts/get-secret.ps1',
  'scripts/save-secret.ps1',
  'README.md',
  'SECURITY.md',
  'PRIVACY.md',
  'CHANGELOG.md',
  'LICENSE.txt'
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

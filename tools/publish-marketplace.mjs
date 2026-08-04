import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { InteractiveBrowserCredential } from '@azure/identity';

const MARKETPLACE_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';
const MARKETPLACE_URL = 'https://marketplace.visualstudio.com';
const repositoryRoot = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const requestedPackagePath = process.argv[2] || path.join('dist', 'codex-provider-switcher.vsix');
const unresolvedPackagePath = path.resolve(repositoryRoot, requestedPackagePath);
const unresolvedPackageStat = await lstat(unresolvedPackagePath);
const packagePath = await realpath(unresolvedPackagePath);
const relativePackagePath = path.relative(repositoryRoot, packagePath);

if (
  !unresolvedPackageStat.isFile()
  || unresolvedPackageStat.isSymbolicLink()
  || path.extname(packagePath).toLowerCase() !== '.vsix'
) {
  throw new Error('发布目标必须是现有的非符号链接 VSIX 文件');
}
if (relativePackagePath.startsWith('..') || path.isAbsolute(relativePackagePath)) {
  throw new Error('发布目标必须位于当前仓库内');
}
if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(manifest.publisher)) {
  throw new Error('package.json 中的 publisher 格式无效');
}
if (process.env.NODE_OPTIONS || process.env.NODE_PATH) {
  throw new Error('为防止发布进程注入，请先移除 NODE_OPTIONS 和 NODE_PATH');
}

const packageBytes = await readFile(packagePath);
const packageHash = createHash('sha256').update(packageBytes).digest('hex');
const vsceEntry = path.join(repositoryRoot, 'node_modules', '@vscode', 'vsce', 'vsce');

function runVsce(argumentsList, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vsceEntry, ...argumentsList], {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: 'inherit',
      windowsHide: true
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`vsce exited with code ${code}`));
      }
    });
  });
}

console.log(`准备发布 ${manifest.publisher}.${manifest.name}@${manifest.version}`);
console.log(`VSIX SHA-256: ${packageHash}`);

const credential = new InteractiveBrowserCredential({
  tenantId: process.env.VSCE_AZURE_TENANT_ID || 'organizations',
  browserCustomizationOptions: {
    successMessage: 'Marketplace 发布授权成功，可以关闭此页面。'
  }
});
const accessToken = await credential.getToken(MARKETPLACE_SCOPE);
if (!accessToken?.token) {
  throw new Error('Microsoft Entra ID 未返回 Marketplace 访问令牌');
}

const publishEnvironment = {
  ...process.env,
  VSCE_MARKETPLACE_URL: MARKETPLACE_URL,
  VSCE_PAT: accessToken.token
};
try {
  await runVsce(['verify-pat', manifest.publisher], publishEnvironment);
  await runVsce(['publish', '--packagePath', packagePath, '--skip-duplicate'], publishEnvironment);
} finally {
  delete publishEnvironment.VSCE_PAT;
}

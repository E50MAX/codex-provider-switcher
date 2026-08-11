'use strict';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_BASE_URL_LENGTH = 2048;
const MAX_API_KEY_LENGTH = 8192;
const MAX_MODEL_ID_LENGTH = 200;
const MAX_HEADER_COUNT = 20;
const MAX_HEADER_VALUE_LENGTH = 4096;
const AMBIGUOUS_HEADER_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_HEADER_NAMES = new Set([
  'api-key',
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key'
]);
const REASONING_EFFORT_PRESETS = Object.freeze([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
]);

function normalizeHttpsBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('API Base URL 不能为空');
  }
  if (raw.length > MAX_BASE_URL_LENGTH || CONTROL_CHARACTERS.test(raw)) {
    throw new Error('API Base URL 格式无效');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('请输入完整的 HTTPS URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('为防止中间人攻击，只允许 HTTPS 地址');
  }
  if (parsed.username || parsed.password) {
    throw new Error('API Base URL 不能包含用户名或密码');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('API Base URL 不能包含查询参数或片段');
  }
  if (!parsed.hostname || parsed.hostname.endsWith('.')) {
    throw new Error('API Base URL 的主机名无效');
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  const baseUrl = `${parsed.origin}${normalizedPath}`;
  return {
    baseUrl,
    host: parsed.host,
    origin: parsed.origin
  };
}

function normalizeApiKey(input, { required = true } = {}) {
  const value = String(input || '').trim();
  if (!value) {
    if (required) {
      throw new Error('API Key 不能为空');
    }
    return '';
  }
  if (value.length > MAX_API_KEY_LENGTH || CONTROL_CHARACTERS.test(value) || /\s/.test(value)) {
    throw new Error('API Key 包含空白、控制字符或长度异常');
  }
  return value;
}

function normalizeModelId(input) {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('模型 ID 不能为空');
  }
  if (value.length > MAX_MODEL_ID_LENGTH || CONTROL_CHARACTERS.test(value) || /\s/.test(value)) {
    throw new Error('模型 ID 包含空白、控制字符或长度异常');
  }
  return value;
}

function normalizeReasoningEffort(input) {
  if (input === undefined || input === null || input === '') {
    return undefined;
  }
  const value = String(input).trim().toLowerCase();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(value)) {
    throw new Error('推理档位格式无效');
  }
  return value;
}

function normalizeHeaderMap(input) {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('HTTP 请求头配置格式无效');
  }

  const entries = Object.entries(input);
  if (entries.length > MAX_HEADER_COUNT) {
    throw new Error(`HTTP 请求头不能超过 ${MAX_HEADER_COUNT} 项`);
  }

  const normalized = {};
  const seenNames = new Set();
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName).trim();
    const value = String(rawValue);
    const lowerName = name.toLowerCase();
    if (!HEADER_NAME.test(name)) {
      throw new Error(`HTTP 请求头名称无效：${name}`);
    }
    if (AMBIGUOUS_HEADER_NAMES.has(lowerName)) {
      throw new Error(`HTTP 请求头名称存在歧义：${name}`);
    }
    if (SENSITIVE_HEADER_NAMES.has(lowerName)) {
      throw new Error(`敏感 HTTP 请求头必须使用 DPAPI 密钥认证，不能明文保存：${name}`);
    }
    if (seenNames.has(lowerName)) {
      throw new Error(`HTTP 请求头名称重复：${name}`);
    }
    if (value.length > MAX_HEADER_VALUE_LENGTH || CONTROL_CHARACTERS.test(value)) {
      throw new Error(`HTTP 请求头值无效：${name}`);
    }
    seenNames.add(lowerName);
    normalized[name] = value;
  }
  return normalized;
}

module.exports = {
  REASONING_EFFORT_PRESETS,
  normalizeApiKey,
  normalizeHeaderMap,
  normalizeHttpsBaseUrl,
  normalizeModelId,
  normalizeReasoningEffort
};

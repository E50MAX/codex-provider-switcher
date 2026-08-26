'use strict';

function newlineOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function parseBasicString(raw, key) {
  let value = '';
  for (let index = 1; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '"') {
      const trailing = raw.slice(index + 1).trimStart();
      if (trailing && !trailing.startsWith('#')) {
        throw new Error(`顶层 ${key} 字符串后存在无效内容`);
      }
      return value;
    }
    if (character !== '\\') {
      if (character.charCodeAt(0) < 0x20 && character !== '\t') {
        throw new Error(`顶层 ${key} 包含无效控制字符`);
      }
      value += character;
      continue;
    }

    index += 1;
    if (index >= raw.length) {
      break;
    }
    const escaped = raw[index];
    const simpleEscapes = {
      b: '\b',
      t: '\t',
      n: '\n',
      f: '\f',
      r: '\r',
      '"': '"',
      '\\': '\\'
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      value += simpleEscapes[escaped];
      continue;
    }
    if (escaped === 'u' || escaped === 'U') {
      const length = escaped === 'u' ? 4 : 8;
      const digits = raw.slice(index + 1, index + 1 + length);
      if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(digits)) {
        throw new Error(`顶层 ${key} 包含无效 Unicode 转义`);
      }
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw new Error(`顶层 ${key} 包含无效 Unicode 码点`);
      }
      value += String.fromCodePoint(codePoint);
      index += length;
      continue;
    }
    throw new Error(`顶层 ${key} 包含不支持的转义`);
  }
  throw new Error(`顶层 ${key} 字符串未闭合`);
}

function parseLiteralString(raw, key) {
  const closingIndex = raw.indexOf("'", 1);
  if (closingIndex === -1) {
    throw new Error(`顶层 ${key} 字符串未闭合`);
  }
  const trailing = raw.slice(closingIndex + 1).trimStart();
  if (trailing && !trailing.startsWith('#')) {
    throw new Error(`顶层 ${key} 字符串后存在无效内容`);
  }
  const value = raw.slice(1, closingIndex);
  if (/[^\t\x20-\x7e\u0080-\uffff]/u.test(value)) {
    throw new Error(`顶层 ${key} 包含无效控制字符`);
  }
  return value;
}

function parseSingleLineString(raw, key) {
  const value = String(raw).trimStart();
  if (value.startsWith('"')) {
    return parseBasicString(value, key);
  }
  if (value.startsWith("'")) {
    return parseLiteralString(value, key);
  }
  throw new Error(`顶层 ${key} 必须是单行 TOML 字符串`);
}

function readTopLevelStringValue(text, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.*)$`);
  const matches = [];

  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      break;
    }
    const match = line.match(matcher);
    if (match) {
      matches.push(match[1]);
    }
  }

  if (matches.length > 1) {
    throw new Error(`顶层 ${key} 重复，已拒绝修改`);
  }
  if (matches.length === 0) {
    return undefined;
  }
  return parseSingleLineString(matches[0], key);
}

function removeManagedBlock(text, managedBegin, managedEnd) {
  const newline = newlineOf(text);
  const lines = text.split(/\r?\n/);
  const beginIndexes = [];
  const endIndexes = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === managedBegin) {
      beginIndexes.push(index);
    }
    if (trimmed === managedEnd) {
      endIndexes.push(index);
    }
  }

  if (beginIndexes.length === 0 && endIndexes.length === 0) {
    return text;
  }
  if (beginIndexes.length !== 1 || endIndexes.length !== 1 || endIndexes[0] <= beginIndexes[0]) {
    throw new Error('托管配置区块标记异常，已拒绝修改');
  }

  lines.splice(beginIndexes[0], endIndexes[0] - beginIndexes[0] + 1);
  return lines.join(newline).replace(/(?:\r?\n){3,}/g, `${newline}${newline}`);
}

function setTopLevelValue(text, key, value, managedBegin) {
  const newline = newlineOf(text);
  const lines = text.split(/\r?\n/);
  const tableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const managedIndex = managedBegin
    ? lines.findIndex((line) => line.trim() === managedBegin)
    : -1;
  const boundaries = [tableIndex, managedIndex].filter((index) => index >= 0);
  const topEnd = boundaries.length > 0 ? Math.min(...boundaries) : lines.length;
  const matcher = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const indexes = [];
  for (let index = 0; index < topEnd; index += 1) {
    if (matcher.test(lines[index])) {
      indexes.push(index);
    }
  }
  if (indexes.length > 1) {
    throw new Error(`顶层 ${key} 重复，已拒绝修改`);
  }
  const index = indexes[0] ?? -1;

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
    let insertAt = topEnd;
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
      insertAt -= 1;
    }
    lines.splice(insertAt, 0, replacement);
  }
  return lines.join(newline);
}

module.exports = { readTopLevelStringValue, removeManagedBlock, setTopLevelValue };

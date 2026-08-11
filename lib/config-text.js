'use strict';

function newlineOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function tomlString(value) {
  return JSON.stringify(String(value));
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
    let insertAt = topEnd;
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
      insertAt -= 1;
    }
    lines.splice(insertAt, 0, replacement);
  }
  return lines.join(newline);
}

module.exports = { removeManagedBlock, setTopLevelValue };

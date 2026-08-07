'use strict';

const MAX_ASSET_NAME = /^app-initial-.*\.js$/;
const MAX_SUPPORT_MARKER = 'hasModelSupportingMaxReasoningEffort';
const UNPATCHED_MAX_FILTER = /\.filter\(\(\{reasoningEffort:([A-Za-z_$][\w$]*)\}\)=>([A-Za-z_$][\w$]*)\(\1\)&&([A-Za-z_$][\w$]*)\.has\(\1\)\)/g;
const PATCHED_MAX_FILTER = /\.filter\(\(\{reasoningEffort:([A-Za-z_$][\w$]*)\}\)=>([A-Za-z_$][\w$]*)\(\1\)&&\(([A-Za-z_$][\w$]*)\.has\(\1\)\|\|\1===`max`\)\)/g;

function matchCount(source, pattern) {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].length;
}

function maxFilterReplacement(match, effort, guard, enabledEfforts) {
  return `.filter(({reasoningEffort:${effort}})=>${guard}(${effort})&&(${enabledEfforts}.has(${effort})||${effort}===\`max\`))`;
}

function patchMaxVisibilitySource(source) {
  if (typeof source !== 'string' || !source.includes(MAX_SUPPORT_MARKER)) {
    return { status: 'unsupported', reason: '找不到 Max 支持标记' };
  }

  const patchedCount = matchCount(source, PATCHED_MAX_FILTER);
  const unpatchedCount = matchCount(source, UNPATCHED_MAX_FILTER);
  if (patchedCount === 1 && unpatchedCount === 0) {
    return { status: 'already-patched' };
  }
  if (patchedCount !== 0 || unpatchedCount !== 1) {
    return {
      status: 'unsupported',
      reason: `预期找到 1 个未修复过滤器，实际找到 ${unpatchedCount} 个；已修复 ${patchedCount} 个`
    };
  }

  UNPATCHED_MAX_FILTER.lastIndex = 0;
  const patchedSource = source.replace(UNPATCHED_MAX_FILTER, maxFilterReplacement);
  if (matchCount(patchedSource, PATCHED_MAX_FILTER) !== 1
      || matchCount(patchedSource, UNPATCHED_MAX_FILTER) !== 0) {
    return { status: 'unsupported', reason: 'Max 过滤器修复结果未通过结构校验' };
  }

  return { status: 'patched', source: patchedSource };
}

module.exports = {
  MAX_ASSET_NAME,
  MAX_SUPPORT_MARKER,
  patchMaxVisibilitySource
};

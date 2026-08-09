'use strict';

const HISTORY_ASSET_NAME = /^app-initial-.*\.js$/;
const THREAD_LIST_MARKER = 'thread/list';
const DIRECT_PROVIDER_FILTER = /modelProviders:null/g;
const CONDITIONAL_PROVIDER_FILTER = /modelProviders:([A-Za-z_$][\w$]*)\?\[([A-Za-z_$][\w$]*)\]:null/g;
const DIRECT_ALL_PROVIDERS = /modelProviders:\[\]/g;
const CONDITIONAL_PARTIAL_FILTER = /modelProviders:([A-Za-z_$][\w$]*)\?\[([A-Za-z_$][\w$]*)\]:\[\]/g;
const DIRECT_UNKNOWN_EXPLICIT_FILTER = /modelProviders:\[(?!\])/g;
const CONDITIONAL_UNKNOWN_EXPLICIT_FILTER = /modelProviders:[A-Za-z_$][\w$]*\?\[[^\]]+\]:/g;
const MAX_FILTER_REPLACEMENTS = 64;

function matchCount(source, pattern) {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].length;
}

function patchSharedHistorySource(source) {
  if (typeof source !== 'string' || !source.includes(THREAD_LIST_MARKER)) {
    return { status: 'unsupported', reason: '找不到 thread/list 历史查询标记' };
  }

  const directCount = matchCount(source, DIRECT_PROVIDER_FILTER);
  const conditionalCount = matchCount(source, CONDITIONAL_PROVIDER_FILTER);
  const partialCount = matchCount(source, CONDITIONAL_PARTIAL_FILTER);
  const replacementCount = directCount + conditionalCount + partialCount;
  if (replacementCount === 0) {
    if (matchCount(source, DIRECT_UNKNOWN_EXPLICIT_FILTER) > 0
        || matchCount(source, CONDITIONAL_UNKNOWN_EXPLICIT_FILTER) > 0) {
      return { status: 'unsupported', reason: '发现无法验证的显式 Provider 历史过滤器' };
    }
    const supportedCount = matchCount(source, DIRECT_ALL_PROVIDERS);
    if (supportedCount > 0) {
      return { status: 'already-supported', supportedCount };
    }
    return { status: 'unsupported', reason: '找不到可验证的 Provider 历史查询结构' };
  }
  if (replacementCount > MAX_FILTER_REPLACEMENTS) {
    return {
      status: 'unsupported',
      reason: `Provider 历史过滤器数量异常：${replacementCount}`
    };
  }

  DIRECT_PROVIDER_FILTER.lastIndex = 0;
  CONDITIONAL_PROVIDER_FILTER.lastIndex = 0;
  CONDITIONAL_PARTIAL_FILTER.lastIndex = 0;
  let patchedSource = source.replace(DIRECT_PROVIDER_FILTER, 'modelProviders:[]');
  patchedSource = patchedSource.replace(CONDITIONAL_PROVIDER_FILTER, 'modelProviders:[]');
  patchedSource = patchedSource.replace(CONDITIONAL_PARTIAL_FILTER, 'modelProviders:[]');

  if (matchCount(patchedSource, DIRECT_PROVIDER_FILTER) !== 0
      || matchCount(patchedSource, CONDITIONAL_PROVIDER_FILTER) !== 0
      || matchCount(patchedSource, CONDITIONAL_PARTIAL_FILTER) !== 0
      || matchCount(patchedSource, DIRECT_UNKNOWN_EXPLICIT_FILTER) !== 0
      || matchCount(patchedSource, CONDITIONAL_UNKNOWN_EXPLICIT_FILTER) !== 0) {
    return { status: 'unsupported', reason: '共享历史修复后仍存在 Provider 过滤器' };
  }

  const directIncrease = matchCount(patchedSource, DIRECT_ALL_PROVIDERS)
    - matchCount(source, DIRECT_ALL_PROVIDERS);
  if (directIncrease !== replacementCount) {
    return { status: 'unsupported', reason: '共享历史修复结果未通过结构校验' };
  }

  return {
    status: 'patched',
    source: patchedSource,
    replacementCount
  };
}

module.exports = {
  HISTORY_ASSET_NAME,
  THREAD_LIST_MARKER,
  patchSharedHistorySource
};

'use strict';

const PROVIDER_TAKEOVER_ASSET_NAME = /^app-initial-.*\.js$/;
const PROVIDER_TAKEOVER_UI_ASSET_NAME = /^use-resume-conversation-if-needed-.*\.js$/;
const PROVIDER_TAKEOVER_CONVERSATION_ASSET_NAME = /^local-conversation-thread-.*\.js$/;
const THREAD_RESUME_MARKER = 'thread/resume';
const PROVIDER_TAKEOVER_PATCH_MARKER = '[codex-provider-switcher:provider-takeover-v5]';
const INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER = '[codex-provider-switcher:provider-takeover-v4]';
const PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER = '[codex-provider-switcher:provider-takeover-v3]';
const OLDER_PROVIDER_TAKEOVER_PATCH_MARKER = '[codex-provider-switcher:provider-takeover-v2]';
const LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER = '[codex-provider-switcher:provider-takeover-v1]';
const WRITER_CONFLICT_CLASSIFIER_MARKER = 'includes(`already has an active writer`)';
const WRITER_CONFLICT_RETRY_LIMIT = 40;
const WRITER_CONFLICT_RETRY_DELAY_MS = 250;
const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const COMPOSER_CONFLICT_GATE = new RegExp(
  `\\{isResuming:(${IDENTIFIER}),isWriterConflict:(${IDENTIFIER}),retryResume:${IDENTIFIER}\\}`
    + `=[^;]{1,4000};[\\s\\S]{0,4000}?let (${IDENTIFIER})=!(${IDENTIFIER})\\|\\|\\2,`
    + `(${IDENTIFIER})=\\1&&!\\2,(${IDENTIFIER})=\\4&&!\\2[\\s\\S]{0,4000}?`
    + `isReadOnly:\\3,isResuming:\\5[\\s\\S]{0,1500}?showComposer:\\6`,
  'g'
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCount(source, needle) {
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function scanDelimited(source, openIndex, openCharacter, closeCharacter) {
  if (source[openIndex] !== openCharacter) {
    return -1;
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n' || character === '\r') {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === openCharacter) {
      depth += 1;
    } else if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevelArguments(source) {
  const argumentsList = [];
  let start = 0;
  const stack = [];
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  const closingFor = { '(': ')', '[': ']', '{': '}' };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n' || character === '\r') {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (Object.hasOwn(closingFor, character)) {
      stack.push(closingFor[character]);
      continue;
    }
    if (stack.at(-1) === character) {
      stack.pop();
      continue;
    }
    if (character === ',' && stack.length === 0) {
      argumentsList.push(source.slice(start, index));
      start = index + 1;
    }
  }

  if (quote !== null || lineComment || blockComment || stack.length !== 0) {
    return null;
  }
  argumentsList.push(source.slice(start));
  return argumentsList;
}

function singleCapture(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    return { error: `${label}数量异常：${matches.length}` };
  }
  return { match: matches[0] };
}

function parseResumeParameters(paramsSource) {
  const threadCapture = singleCapture(
    paramsSource,
    new RegExp(`\\bthreadId:(${IDENTIFIER})`, 'g'),
    'threadId 参数'
  );
  if (threadCapture.error) {
    return threadCapture;
  }
  const providerCapture = singleCapture(
    paramsSource,
    new RegExp(`\\bmodelProvider:(${IDENTIFIER})\\.modelProvider`, 'g'),
    'modelProvider 参数'
  );
  if (providerCapture.error) {
    return providerCapture;
  }
  return {
    threadIdVar: threadCapture.match[1],
    expectedParamsVar: providerCapture.match[1]
  };
}

function buildResumeThunk({
  promiseVar,
  managerVar,
  threadIdVar,
  expectedParamsVar,
  requestOptionsVar,
  paramsSource
}) {
  const marker = JSON.stringify(PROVIDER_TAKEOVER_PATCH_MARKER);
  return [
    `let ${promiseVar}=async()=>{${marker};`,
    `let codexProviderSwitcherResumeParams=${paramsSource};`,
    'let codexProviderSwitcherConfigReadResult;',
    'try{',
    `codexProviderSwitcherConfigReadResult=await ${managerVar}.sendRequest(\`config/read\`,{includeLayers:false,cwd:codexProviderSwitcherResumeParams.cwd??null},${requestOptionsVar})`,
    '}catch(codexProviderSwitcherConfigReadError){',
    `throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; current provider config could not be read; sending is blocked\`,{cause:codexProviderSwitcherConfigReadError})`,
    '}',
    'let codexProviderSwitcherEffectiveConfig=codexProviderSwitcherConfigReadResult?.config;',
    'let codexProviderSwitcherExpectedProvider=codexProviderSwitcherEffectiveConfig!=null&&typeof codexProviderSwitcherEffectiveConfig===\`object\`?codexProviderSwitcherEffectiveConfig.model_provider??\`openai\`:null;',
    `if(typeof codexProviderSwitcherExpectedProvider!==\`string\`||codexProviderSwitcherExpectedProvider.length===0)throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is invalid; sending is blocked\`);`,
    'codexProviderSwitcherResumeParams.modelProvider=codexProviderSwitcherExpectedProvider;',
    'let codexProviderSwitcherModelListResult;',
    'try{',
    `codexProviderSwitcherModelListResult=await ${managerVar}.sendRequest(\`model/list\`,{includeHidden:true,limit:100},${requestOptionsVar})`,
    '}catch(codexProviderSwitcherModelListError){',
    `throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; current model catalog could not be read; sending is blocked\`,{cause:codexProviderSwitcherModelListError})`,
    '}',
    `if(!Array.isArray(codexProviderSwitcherModelListResult?.data)||codexProviderSwitcherModelListResult.nextCursor!=null)throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; current model catalog is incomplete; sending is blocked\`);`,
    `let codexProviderSwitcherRequestedModel=${expectedParamsVar}.model??null;`,
    `if(codexProviderSwitcherRequestedModel!==null&&(typeof codexProviderSwitcherRequestedModel!==\`string\`||codexProviderSwitcherRequestedModel.length===0))throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; thread model is invalid; sending is blocked\`);`,
    'let codexProviderSwitcherConfiguredModel=codexProviderSwitcherEffectiveConfig.model??null;',
    `if(codexProviderSwitcherConfiguredModel!==null&&(typeof codexProviderSwitcherConfiguredModel!==\`string\`||codexProviderSwitcherConfiguredModel.length===0))throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected model is invalid; sending is blocked\`);`,
    'let codexProviderSwitcherSelectedModel=codexProviderSwitcherModelListResult.data.find(codexProviderSwitcherModel=>codexProviderSwitcherModel?.model===codexProviderSwitcherRequestedModel)',
    '??codexProviderSwitcherModelListResult.data.find(codexProviderSwitcherModel=>codexProviderSwitcherModel?.model===codexProviderSwitcherConfiguredModel)',
    '??codexProviderSwitcherModelListResult.data.find(codexProviderSwitcherModel=>codexProviderSwitcherModel?.isDefault===true);',
    `if(codexProviderSwitcherSelectedModel==null||typeof codexProviderSwitcherSelectedModel.model!==\`string\`||codexProviderSwitcherSelectedModel.model.length===0)throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; no compatible model is available; sending is blocked\`);`,
    'let codexProviderSwitcherExpectedModel=codexProviderSwitcherSelectedModel.model;',
    'codexProviderSwitcherResumeParams.model=codexProviderSwitcherExpectedModel;',
    'let codexProviderSwitcherSupportedEfforts=Array.isArray(codexProviderSwitcherSelectedModel.supportedReasoningEfforts)?codexProviderSwitcherSelectedModel.supportedReasoningEfforts.map(codexProviderSwitcherEffort=>codexProviderSwitcherEffort?.reasoningEffort).filter(codexProviderSwitcherEffort=>typeof codexProviderSwitcherEffort===\`string\`):[];',
    `if(codexProviderSwitcherResumeParams.config!==null&&codexProviderSwitcherResumeParams.config!==undefined&&(typeof codexProviderSwitcherResumeParams.config!==\`object\`||Array.isArray(codexProviderSwitcherResumeParams.config)))throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; resume config is invalid; sending is blocked\`);`,
    `let codexProviderSwitcherThreadEffort=${expectedParamsVar}.config?.model_reasoning_effort??null;`,
    `if(codexProviderSwitcherThreadEffort!==null&&(typeof codexProviderSwitcherThreadEffort!==\`string\`||codexProviderSwitcherThreadEffort.length===0))throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; thread reasoning effort is invalid; sending is blocked\`);`,
    'let codexProviderSwitcherConfiguredEffort=codexProviderSwitcherEffectiveConfig.model_reasoning_effort??null;',
    `if(codexProviderSwitcherConfiguredEffort!==null&&(typeof codexProviderSwitcherConfiguredEffort!==\`string\`||codexProviderSwitcherConfiguredEffort.length===0))throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected reasoning effort is invalid; sending is blocked\`);`,
    'let codexProviderSwitcherExpectedEffort=codexProviderSwitcherSupportedEfforts.includes(codexProviderSwitcherThreadEffort)?codexProviderSwitcherThreadEffort:codexProviderSwitcherSupportedEfforts.includes(codexProviderSwitcherConfiguredEffort)?codexProviderSwitcherConfiguredEffort:codexProviderSwitcherSupportedEfforts.includes(codexProviderSwitcherSelectedModel.defaultReasoningEffort)?codexProviderSwitcherSelectedModel.defaultReasoningEffort:null;',
    'if(codexProviderSwitcherExpectedEffort!==null){',
    'codexProviderSwitcherResumeParams.config={...(codexProviderSwitcherResumeParams.config??{}),model_reasoning_effort:codexProviderSwitcherExpectedEffort}',
    '}',
    'let codexProviderSwitcherSupportedServiceTiers=Array.isArray(codexProviderSwitcherSelectedModel.serviceTiers)?codexProviderSwitcherSelectedModel.serviceTiers.map(codexProviderSwitcherTier=>codexProviderSwitcherTier?.id).filter(codexProviderSwitcherTier=>typeof codexProviderSwitcherTier===\`string\`):[];',
    `let codexProviderSwitcherThreadServiceTier=${expectedParamsVar}.serviceTier??null;`,
    `if(codexProviderSwitcherThreadServiceTier!==null&&(typeof codexProviderSwitcherThreadServiceTier!==\`string\`||codexProviderSwitcherThreadServiceTier.length===0))throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; thread service tier is invalid; sending is blocked\`);`,
    'let codexProviderSwitcherConfiguredServiceTier=codexProviderSwitcherEffectiveConfig.service_tier??null;',
    `if(codexProviderSwitcherConfiguredServiceTier!==null&&(typeof codexProviderSwitcherConfiguredServiceTier!==\`string\`||codexProviderSwitcherConfiguredServiceTier.length===0))throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected service tier is invalid; sending is blocked\`);`,
    'let codexProviderSwitcherThreadServiceTierSupported=codexProviderSwitcherThreadServiceTier===\`default\`||codexProviderSwitcherSupportedServiceTiers.includes(codexProviderSwitcherThreadServiceTier);',
    'let codexProviderSwitcherConfiguredServiceTierSupported=codexProviderSwitcherConfiguredServiceTier===\`default\`||codexProviderSwitcherSupportedServiceTiers.includes(codexProviderSwitcherConfiguredServiceTier);',
    'let codexProviderSwitcherExpectedServiceTier=codexProviderSwitcherThreadServiceTierSupported?codexProviderSwitcherThreadServiceTier:codexProviderSwitcherConfiguredServiceTierSupported?codexProviderSwitcherConfiguredServiceTier:null;',
    'codexProviderSwitcherResumeParams.serviceTier=codexProviderSwitcherExpectedServiceTier;',
    'if(codexProviderSwitcherExpectedProvider===\`openai\`){',
    'let codexProviderSwitcherAccountReadResult;',
    'try{',
    `codexProviderSwitcherAccountReadResult=await ${managerVar}.sendRequest(\`account/read\`,{refreshToken:false},${requestOptionsVar})`,
    '}catch(codexProviderSwitcherAccountReadError){',
    `throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; current ChatGPT account state could not be read; sending is blocked\`,{cause:codexProviderSwitcherAccountReadError})`,
    '}',
    `if(codexProviderSwitcherAccountReadResult?.account?.type!==\`chatgpt\`)throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; no ChatGPT account is signed in; sending is blocked\`);`,
    '}',
    'let codexProviderSwitcherResumeResult;',
    'for(let codexProviderSwitcherResumeAttempt=0;;codexProviderSwitcherResumeAttempt+=1){',
    `try{codexProviderSwitcherResumeResult=await ${managerVar}.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,${requestOptionsVar});break}`,
    'catch(codexProviderSwitcherResumeError){',
    'let codexProviderSwitcherResumeErrorText=String(codexProviderSwitcherResumeError?.message??codexProviderSwitcherResumeError).toLowerCase();',
    `if(!codexProviderSwitcherResumeErrorText.includes('already has an active writer')||codexProviderSwitcherResumeAttempt>=${WRITER_CONFLICT_RETRY_LIMIT - 1})throw codexProviderSwitcherResumeError;`,
    `await new Promise(codexProviderSwitcherResolve=>setTimeout(codexProviderSwitcherResolve,${WRITER_CONFLICT_RETRY_DELAY_MS}))`,
    '}',
    '}',
    `if(codexProviderSwitcherResumeResult.thread?.id!==${threadIdVar})throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    'let codexProviderSwitcherRuntimeSelectionMismatch=codexProviderSwitcherResumeResult.modelProvider!==codexProviderSwitcherExpectedProvider',
    '||codexProviderSwitcherExpectedModel!==null&&codexProviderSwitcherResumeResult.model!==codexProviderSwitcherExpectedModel',
    '||codexProviderSwitcherExpectedEffort!==null&&codexProviderSwitcherResumeResult.reasoningEffort!==codexProviderSwitcherExpectedEffort',
    '||((codexProviderSwitcherExpectedServiceTier===null||codexProviderSwitcherExpectedServiceTier===\`default\`)?codexProviderSwitcherResumeResult.serviceTier!=null&&codexProviderSwitcherResumeResult.serviceTier!==\`default\`:codexProviderSwitcherResumeResult.serviceTier!==codexProviderSwitcherExpectedServiceTier);',
    'if(codexProviderSwitcherRuntimeSelectionMismatch){',
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread runtime selection mismatch; sending is blocked\`);`,
    `let codexProviderSwitcherUnsubscribeResult=await ${managerVar}.sendRequest(\`thread/unsubscribe\`,{threadId:${threadIdVar}},${requestOptionsVar});`,
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not unsubscribe from the previous provider; sending is blocked\`);`,
    `throw Error(\`${PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; runtime selection mismatch requires a window reload; sending is blocked\`)`,
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
}

function buildIntermediateResumeThunk({
  promiseVar,
  managerVar,
  threadIdVar,
  expectedParamsVar,
  requestOptionsVar,
  paramsSource
}) {
  const marker = JSON.stringify(INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER);
  return [
    `let ${promiseVar}=async()=>{${marker};`,
    `let codexProviderSwitcherResumeParams=${paramsSource};`,
    'let codexProviderSwitcherConfigReadResult;',
    'try{',
    `codexProviderSwitcherConfigReadResult=await ${managerVar}.sendRequest(\`config/read\`,{includeLayers:false,cwd:codexProviderSwitcherResumeParams.cwd??null},${requestOptionsVar})`,
    '}catch(codexProviderSwitcherConfigReadError){',
    `throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; current provider config could not be read; sending is blocked\`,{cause:codexProviderSwitcherConfigReadError})`,
    '}',
    'let codexProviderSwitcherEffectiveConfig=codexProviderSwitcherConfigReadResult?.config;',
    'let codexProviderSwitcherExpectedProvider=codexProviderSwitcherEffectiveConfig!=null&&typeof codexProviderSwitcherEffectiveConfig===\`object\`?codexProviderSwitcherEffectiveConfig.model_provider??\`openai\`:null;',
    `if(typeof codexProviderSwitcherExpectedProvider!==\`string\`||codexProviderSwitcherExpectedProvider.length===0)throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is invalid; sending is blocked\`);`,
    'codexProviderSwitcherResumeParams.modelProvider=codexProviderSwitcherExpectedProvider;',
    'let codexProviderSwitcherResumeResult;',
    'for(let codexProviderSwitcherResumeAttempt=0;;codexProviderSwitcherResumeAttempt+=1){',
    `try{codexProviderSwitcherResumeResult=await ${managerVar}.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,${requestOptionsVar});break}`,
    'catch(codexProviderSwitcherResumeError){',
    'let codexProviderSwitcherResumeErrorText=String(codexProviderSwitcherResumeError?.message??codexProviderSwitcherResumeError).toLowerCase();',
    `if(!codexProviderSwitcherResumeErrorText.includes('already has an active writer')||codexProviderSwitcherResumeAttempt>=${WRITER_CONFLICT_RETRY_LIMIT - 1})throw codexProviderSwitcherResumeError;`,
    `await new Promise(codexProviderSwitcherResolve=>setTimeout(codexProviderSwitcherResolve,${WRITER_CONFLICT_RETRY_DELAY_MS}))`,
    '}',
    '}',
    `if(codexProviderSwitcherResumeResult.thread?.id!==${threadIdVar})throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    'if(codexProviderSwitcherResumeResult.modelProvider!==codexProviderSwitcherExpectedProvider){',
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread provider mismatch; sending is blocked\`);`,
    `let codexProviderSwitcherUnsubscribeResult=await ${managerVar}.sendRequest(\`thread/unsubscribe\`,{threadId:${threadIdVar}},${requestOptionsVar});`,
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not unsubscribe from the previous provider; sending is blocked\`);`,
    `throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; provider mismatch requires a window reload; sending is blocked\`)`,
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
}

function buildPreviousResumeThunk({
  promiseVar,
  managerVar,
  threadIdVar,
  expectedParamsVar,
  requestOptionsVar,
  paramsSource
}) {
  const marker = JSON.stringify(PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER);
  return [
    `let ${promiseVar}=async()=>{${marker};`,
    `let codexProviderSwitcherResumeParams=${paramsSource};`,
    `let codexProviderSwitcherExpectedProvider=${expectedParamsVar}.modelProvider??\`openai\`;`,
    `if(typeof codexProviderSwitcherExpectedProvider!==\`string\`||codexProviderSwitcherExpectedProvider.length===0)throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is invalid; sending is blocked\`);`,
    'codexProviderSwitcherResumeParams.modelProvider=codexProviderSwitcherExpectedProvider;',
    'let codexProviderSwitcherResumeResult;',
    'for(let codexProviderSwitcherResumeAttempt=0;;codexProviderSwitcherResumeAttempt+=1){',
    `try{codexProviderSwitcherResumeResult=await ${managerVar}.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,${requestOptionsVar});break}`,
    'catch(codexProviderSwitcherResumeError){',
    'let codexProviderSwitcherResumeErrorText=String(codexProviderSwitcherResumeError?.message??codexProviderSwitcherResumeError).toLowerCase();',
    `if(!codexProviderSwitcherResumeErrorText.includes('already has an active writer')||codexProviderSwitcherResumeAttempt>=${WRITER_CONFLICT_RETRY_LIMIT - 1})throw codexProviderSwitcherResumeError;`,
    `await new Promise(codexProviderSwitcherResolve=>setTimeout(codexProviderSwitcherResolve,${WRITER_CONFLICT_RETRY_DELAY_MS}))`,
    '}',
    '}',
    `if(codexProviderSwitcherResumeResult.thread?.id!==${threadIdVar})throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    'if(codexProviderSwitcherResumeResult.modelProvider!==codexProviderSwitcherExpectedProvider){',
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread provider mismatch; sending is blocked\`);`,
    `let codexProviderSwitcherUnsubscribeResult=await ${managerVar}.sendRequest(\`thread/unsubscribe\`,{threadId:${threadIdVar}},${requestOptionsVar});`,
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not unsubscribe from the previous provider; sending is blocked\`);`,
    `throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; provider mismatch requires a window reload; sending is blocked\`)`,
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
}

function buildOlderResumeThunk({
  promiseVar,
  managerVar,
  threadIdVar,
  expectedParamsVar,
  requestOptionsVar,
  paramsSource
}) {
  const marker = JSON.stringify(OLDER_PROVIDER_TAKEOVER_PATCH_MARKER);
  return [
    `let ${promiseVar}=async()=>{${marker};`,
    `let codexProviderSwitcherResumeParams=${paramsSource};`,
    `if(${expectedParamsVar}.modelProvider==null)throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is missing; sending is blocked\`);`,
    'let codexProviderSwitcherResumeResult;',
    'for(let codexProviderSwitcherResumeAttempt=0;;codexProviderSwitcherResumeAttempt+=1){',
    `try{codexProviderSwitcherResumeResult=await ${managerVar}.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,${requestOptionsVar});break}`,
    'catch(codexProviderSwitcherResumeError){',
    'let codexProviderSwitcherResumeErrorText=String(codexProviderSwitcherResumeError?.message??codexProviderSwitcherResumeError).toLowerCase();',
    `if(!codexProviderSwitcherResumeErrorText.includes('already has an active writer')||codexProviderSwitcherResumeAttempt>=${WRITER_CONFLICT_RETRY_LIMIT - 1})throw codexProviderSwitcherResumeError;`,
    `await new Promise(codexProviderSwitcherResolve=>setTimeout(codexProviderSwitcherResolve,${WRITER_CONFLICT_RETRY_DELAY_MS}))`,
    '}',
    '}',
    `if(codexProviderSwitcherResumeResult.thread?.id!==${threadIdVar})throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    `if(codexProviderSwitcherResumeResult.modelProvider!==${expectedParamsVar}.modelProvider){`,
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread provider mismatch; sending is blocked\`);`,
    `let codexProviderSwitcherUnsubscribeResult=await ${managerVar}.sendRequest(\`thread/unsubscribe\`,{threadId:${threadIdVar}},${requestOptionsVar});`,
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not unsubscribe from the previous provider; sending is blocked\`);`,
    `throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; provider mismatch requires a window reload; sending is blocked\`)`,
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
}

function buildLegacyResumeThunk({
  promiseVar,
  managerVar,
  threadIdVar,
  expectedParamsVar,
  requestOptionsVar,
  paramsSource
}) {
  const marker = JSON.stringify(LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER);
  return [
    `let ${promiseVar}=async()=>{${marker};`,
    `let codexProviderSwitcherResumeParams=${paramsSource};`,
    `if(${expectedParamsVar}.modelProvider==null)throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is missing; sending is blocked\`);`,
    `let codexProviderSwitcherResumeResult=await ${managerVar}.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,${requestOptionsVar});`,
    `if(codexProviderSwitcherResumeResult.thread?.id!==${threadIdVar})throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    `if(codexProviderSwitcherResumeResult.modelProvider!==${expectedParamsVar}.modelProvider){`,
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread provider mismatch; sending is blocked\`);`,
    `let codexProviderSwitcherUnsubscribeResult=await ${managerVar}.sendRequest(\`thread/unsubscribe\`,{threadId:${threadIdVar}},${requestOptionsVar});`,
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not release the previous provider; sending is blocked\`);`,
    `codexProviderSwitcherResumeResult=await ${managerVar}.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,${requestOptionsVar});`,
    `if(codexProviderSwitcherResumeResult.thread?.id!==${threadIdVar}||codexProviderSwitcherResumeResult.modelProvider!==${expectedParamsVar}.modelProvider){`,
    `await ${managerVar}.sendRequest(\`thread/unsubscribe\`,{threadId:${threadIdVar}},${requestOptionsVar}).catch(()=>{});`,
    `throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; provider verification failed; sending is blocked\`)`,
    '}',
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
}

function inspectOriginalResume(source) {
  const callPattern = new RegExp(`(${IDENTIFIER})\\.sendRequest\\(\\x60thread/resume\\x60,`, 'g');
  const calls = [...source.matchAll(callPattern)];
  if (calls.length !== 1) {
    return { error: `可验证的 thread/resume 请求数量异常：${calls.length}` };
  }

  const callMatch = calls[0];
  const managerVar = callMatch[1];
  const callStart = callMatch.index;
  const statementStart = source.lastIndexOf('let ', callStart);
  if (statementStart < 0) {
    return { error: '找不到 thread/resume Promise 声明' };
  }
  const declaration = source.slice(statementStart + 4, callStart);
  const declarationMatch = new RegExp(`^(${IDENTIFIER})=$`).exec(declaration);
  if (!declarationMatch) {
    return { error: 'thread/resume Promise 声明结构不受支持' };
  }
  const promiseVar = declarationMatch[1];
  const openParenthesis = source.indexOf('(', callStart);
  const closeParenthesis = scanDelimited(source, openParenthesis, '(', ')');
  if (closeParenthesis < 0 || source[closeParenthesis + 1] !== ';') {
    return { error: 'thread/resume 调用边界不完整' };
  }

  const args = splitTopLevelArguments(source.slice(openParenthesis + 1, closeParenthesis));
  if (!args || args.length !== 3 || args[0] !== '`thread/resume`') {
    return { error: 'thread/resume 参数结构不受支持' };
  }
  const paramsSource = args[1];
  if (!paramsSource.startsWith('{') || !paramsSource.endsWith('}') || paramsSource.includes('${')) {
    return { error: 'thread/resume 参数对象无法安全复用' };
  }
  const requestOptionsVar = args[2];
  if (!new RegExp(`^${IDENTIFIER}$`).test(requestOptionsVar)) {
    return { error: 'thread/resume 请求选项结构不受支持' };
  }
  const parsedParams = parseResumeParameters(paramsSource);
  if (parsedParams.error) {
    return parsedParams;
  }

  const awaitedPattern = new RegExp(`(${IDENTIFIER})=await ${escapeRegExp(promiseVar)}(?=[,;])`, 'g');
  const awaited = [...source.matchAll(awaitedPattern)];
  if (awaited.length !== 1 || awaited[0].index <= closeParenthesis) {
    return { error: `thread/resume 结果接收结构数量异常：${awaited.length}` };
  }
  const resultVar = awaited[0][1];

  const statePattern = new RegExp(
    `${escapeRegExp(managerVar)}\\.updateConversationState\\(${escapeRegExp(parsedParams.threadIdVar)},(${IDENTIFIER})=>\\{(?=${escapeRegExp(managerVar)}\\.canonicalTurnHistory\\?)`,
    'g'
  );
  const stateSearchEnd = Math.min(source.length, awaited[0].index + 16000);
  const stateSegment = source.slice(awaited[0].index, stateSearchEnd);
  const stateMatches = [...stateSegment.matchAll(statePattern)];
  if (stateMatches.length !== 1) {
    return { error: `恢复后会话状态更新结构数量异常：${stateMatches.length}` };
  }

  return {
    promiseVar,
    managerVar,
    threadIdVar: parsedParams.threadIdVar,
    expectedParamsVar: parsedParams.expectedParamsVar,
    requestOptionsVar,
    paramsSource,
    resultVar,
    statementStart,
    closeParenthesis,
    awaitedIndex: awaited[0].index,
    awaitedLength: awaited[0][0].length,
    stateIndex: awaited[0].index + stateMatches[0].index,
    stateLength: stateMatches[0][0].length,
    stateVar: stateMatches[0][1]
  };
}

function inspectPatchedProviderTakeoverSource(source, marker, buildThunk) {
  if (
    matchCount(source, marker) < 1
    || matchCount(source, WRITER_CONFLICT_CLASSIFIER_MARKER) !== 1
  ) {
    return null;
  }

  const wrapperStartPattern = new RegExp(
    `let (${IDENTIFIER})=async\\(\\)=>\\{${escapeRegExp(JSON.stringify(marker))};let codexProviderSwitcherResumeParams=`,
    'g'
  );
  const wrappers = [...source.matchAll(wrapperStartPattern)];
  if (wrappers.length !== 1) {
    return null;
  }
  const wrapperStart = wrappers[0].index;
  const promiseVar = wrappers[0][1];
  const paramsStart = wrapperStart + wrappers[0][0].length;
  const paramsEnd = scanDelimited(source, paramsStart, '{', '}');
  if (paramsEnd < 0) {
    return null;
  }
  const paramsSource = source.slice(paramsStart, paramsEnd + 1);
  const parsedParams = parseResumeParameters(paramsSource);
  if (parsedParams.error) {
    return null;
  }

  const resumeRequestPattern = new RegExp(
    `(${IDENTIFIER})\\.sendRequest\\(\\x60thread/resume\\x60,codexProviderSwitcherResumeParams,(${IDENTIFIER})\\)`,
    'g'
  );
  const requestSearchEnd = Math.min(source.length, wrapperStart + 16000);
  const resumeRequests = [...source.slice(paramsEnd + 1, requestSearchEnd).matchAll(resumeRequestPattern)];
  if (resumeRequests.length === 0) {
    return null;
  }
  const requestPairs = new Set(resumeRequests.map((match) => `${match[1]}:${match[2]}`));
  if (requestPairs.size !== 1) {
    return null;
  }
  const managerVar = resumeRequests[0][1];
  const requestOptionsVar = resumeRequests[0][2];
  const expectedWrapper = buildThunk({
    promiseVar,
    managerVar,
    threadIdVar: parsedParams.threadIdVar,
    expectedParamsVar: parsedParams.expectedParamsVar,
    requestOptionsVar,
    paramsSource
  });
  if (!source.startsWith(expectedWrapper, wrapperStart)) {
    return null;
  }
  if (matchCount(source, marker) !== matchCount(expectedWrapper, marker)) {
    return null;
  }

  const awaitedPatched = new RegExp(`(${IDENTIFIER})=await ${escapeRegExp(promiseVar)}\\(\\)(?=[,;])`, 'g');
  const awaitedMatches = [...source.matchAll(awaitedPatched)];
  if (
    awaitedMatches.length !== 1
    || source.includes(`await ${promiseVar},`)
    || source.includes(`await ${promiseVar};`)
  ) {
    return null;
  }
  const resultVar = awaitedMatches[0][1];
  const statePattern = new RegExp(
    `${escapeRegExp(managerVar)}\\.updateConversationState\\(${escapeRegExp(parsedParams.threadIdVar)},(${IDENTIFIER})=>\\{\\1\\.modelProvider=${escapeRegExp(resultVar)}\\.modelProvider,${escapeRegExp(managerVar)}\\.canonicalTurnHistory\\?`,
    'g'
  );
  if ([...source.matchAll(statePattern)].length !== 1) {
    return null;
  }
  return {
    promiseVar,
    managerVar,
    threadIdVar: parsedParams.threadIdVar,
    expectedParamsVar: parsedParams.expectedParamsVar,
    requestOptionsVar,
    paramsSource,
    wrapperStart,
    wrapperLength: expectedWrapper.length
  };
}

function verifyPatchedProviderTakeoverSource(source) {
  return inspectPatchedProviderTakeoverSource(
    source,
    PROVIDER_TAKEOVER_PATCH_MARKER,
    buildResumeThunk
  ) !== null;
}

function upgradeProviderTakeoverSource(source, marker, buildOldThunk) {
  const inspected = inspectPatchedProviderTakeoverSource(
    source,
    marker,
    buildOldThunk
  );
  if (!inspected) {
    return null;
  }
  const wrapper = buildResumeThunk(inspected);
  const patchedSource = source.slice(0, inspected.wrapperStart)
    + wrapper
    + source.slice(inspected.wrapperStart + inspected.wrapperLength);
  return verifyPatchedProviderTakeoverSource(patchedSource) ? patchedSource : null;
}

function upgradePreviousProviderTakeoverSource(source) {
  return upgradeProviderTakeoverSource(
    source,
    PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER,
    buildPreviousResumeThunk
  );
}

function upgradeIntermediateProviderTakeoverSource(source) {
  return upgradeProviderTakeoverSource(
    source,
    INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER,
    buildIntermediateResumeThunk
  );
}

function upgradeLegacyProviderTakeoverSource(source) {
  return upgradeProviderTakeoverSource(
    source,
    LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER,
    buildLegacyResumeThunk
  );
}

function upgradeOlderProviderTakeoverSource(source) {
  return upgradeProviderTakeoverSource(
    source,
    OLDER_PROVIDER_TAKEOVER_PATCH_MARKER,
    buildOlderResumeThunk
  );
}

function patchProviderTakeoverSource(source) {
  if (typeof source !== 'string' || !source.includes(THREAD_RESUME_MARKER)) {
    return { status: 'unsupported', reason: '找不到 thread/resume 会话恢复标记' };
  }
  if (matchCount(source, WRITER_CONFLICT_CLASSIFIER_MARKER) !== 1) {
    return { status: 'unsupported', reason: '找不到唯一的官方写入冲突阻断器' };
  }
  const hasCurrentPatch = source.includes(PROVIDER_TAKEOVER_PATCH_MARKER);
  const hasIntermediatePatch = source.includes(INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER);
  const hasPreviousPatch = source.includes(PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER);
  const hasOlderPatch = source.includes(OLDER_PROVIDER_TAKEOVER_PATCH_MARKER);
  const hasLegacyPatch = source.includes(LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER);
  if (
    [hasCurrentPatch, hasIntermediatePatch, hasPreviousPatch, hasOlderPatch, hasLegacyPatch]
      .filter(Boolean).length > 1
  ) {
    return { status: 'unsupported', reason: '发现互相冲突的 Provider 接管版本标记' };
  }
  if (hasCurrentPatch) {
    return verifyPatchedProviderTakeoverSource(source)
      ? { status: 'already-patched' }
      : { status: 'unsupported', reason: 'Provider 接管标记存在，但安全结构校验失败' };
  }
  if (hasIntermediatePatch) {
    const upgradedSource = upgradeIntermediateProviderTakeoverSource(source);
    return upgradedSource
      ? { status: 'patched', source: upgradedSource, replacementCount: 1 }
      : { status: 'unsupported', reason: '上一版 Provider 接管标记存在，但安全结构校验失败' };
  }
  if (hasPreviousPatch) {
    const upgradedSource = upgradePreviousProviderTakeoverSource(source);
    return upgradedSource
      ? { status: 'patched', source: upgradedSource, replacementCount: 1 }
      : { status: 'unsupported', reason: '上一版 Provider 接管标记存在，但安全结构校验失败' };
  }
  if (hasOlderPatch) {
    const upgradedSource = upgradeOlderProviderTakeoverSource(source);
    return upgradedSource
      ? { status: 'patched', source: upgradedSource, replacementCount: 1 }
      : { status: 'unsupported', reason: '较旧版 Provider 接管标记存在，但安全结构校验失败' };
  }
  if (hasLegacyPatch) {
    const upgradedSource = upgradeLegacyProviderTakeoverSource(source);
    return upgradedSource
      ? { status: 'patched', source: upgradedSource, replacementCount: 1 }
      : { status: 'unsupported', reason: '旧版 Provider 接管标记存在，但安全结构校验失败' };
  }

  const inspected = inspectOriginalResume(source);
  if (inspected.error) {
    return { status: 'unsupported', reason: inspected.error };
  }
  const wrapper = buildResumeThunk(inspected);
  const awaitedOriginal = source.slice(
    inspected.awaitedIndex,
    inspected.awaitedIndex + inspected.awaitedLength
  );
  const awaitedPatched = `${awaitedOriginal}()`;
  const stateOriginal = source.slice(inspected.stateIndex, inspected.stateIndex + inspected.stateLength);
  const statePatched = `${stateOriginal}${inspected.stateVar}.modelProvider=${inspected.resultVar}.modelProvider,`;

  const replacements = [
    {
      start: inspected.statementStart,
      end: inspected.closeParenthesis + 1,
      value: wrapper
    },
    {
      start: inspected.awaitedIndex,
      end: inspected.awaitedIndex + inspected.awaitedLength,
      value: awaitedPatched
    },
    {
      start: inspected.stateIndex,
      end: inspected.stateIndex + inspected.stateLength,
      value: statePatched
    }
  ].sort((left, right) => right.start - left.start);

  let patchedSource = source;
  for (const replacement of replacements) {
    patchedSource = patchedSource.slice(0, replacement.start)
      + replacement.value
      + patchedSource.slice(replacement.end);
  }
  if (!verifyPatchedProviderTakeoverSource(patchedSource)) {
    return { status: 'unsupported', reason: 'Provider 接管修复结果未通过结构校验' };
  }
  return { status: 'patched', source: patchedSource, replacementCount: 3 };
}

function verifyProviderTakeoverComposerGateSource(source) {
  if (
    typeof source !== 'string'
    || !source.includes('localConversation.writerConflict.retry')
    || !source.includes('This is open in another app')
  ) {
    return false;
  }
  COMPOSER_CONFLICT_GATE.lastIndex = 0;
  return COMPOSER_CONFLICT_GATE.test(source);
}

module.exports = {
  PROVIDER_TAKEOVER_ASSET_NAME,
  PROVIDER_TAKEOVER_UI_ASSET_NAME,
  PROVIDER_TAKEOVER_CONVERSATION_ASSET_NAME,
  THREAD_RESUME_MARKER,
  PROVIDER_TAKEOVER_PATCH_MARKER,
  INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER,
  PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER,
  OLDER_PROVIDER_TAKEOVER_PATCH_MARKER,
  LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER,
  WRITER_CONFLICT_CLASSIFIER_MARKER,
  WRITER_CONFLICT_RETRY_LIMIT,
  WRITER_CONFLICT_RETRY_DELAY_MS,
  patchProviderTakeoverSource,
  verifyProviderTakeoverComposerGateSource,
  verifyPatchedProviderTakeoverSource
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_TAKEOVER_PATCH_MARKER,
  INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER,
  PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER,
  OLDER_PROVIDER_TAKEOVER_PATCH_MARKER,
  LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER,
  WRITER_CONFLICT_RETRY_LIMIT,
  WRITER_CONFLICT_RETRY_DELAY_MS,
  patchProviderTakeoverSource,
  verifyProviderTakeoverComposerGateSource,
  verifyPatchedProviderTakeoverSource
} = require('../lib/provider-takeover-patch');

const ORIGINAL_SOURCE = [
  'function isWriterConflict(e){return String(e).toLowerCase().includes(`already has an active writer`)}',
  'const px={get(){return null}};',
  'async function resumeFixture(e,n,H,V){',
  'let te=e.sendRequest(`thread/resume`,{threadId:n,history:null,model:null,modelProvider:H.modelProvider,cwd:`/workspace`},V);',
  'px.get(e)?.get(n);',
  'let ne=()=>null,re=await te,ie=null;',
  'e.updateConversationState(n,t=>{e.canonicalTurnHistory?t.resumeState=`canonical`:t.resumeState=`legacy`,t.sessionId=re.thread.sessionId});',
  'return{re,ie,ne:ne()}',
  '}',
  'return resumeFixture;'
].join('');

const SEMICOLON_AWAIT_SOURCE = ORIGINAL_SOURCE.replace(
  'let ne=()=>null,re=await te,ie=null;',
  'let ne=()=>null;re=await te;let ie=null;'
);

function compilePatchedFixture() {
  const result = patchProviderTakeoverSource(ORIGINAL_SOURCE);
  assert.equal(result.status, 'patched');
  assert.equal(result.replacementCount, 3);
  assert.equal(verifyPatchedProviderTakeoverSource(result.source), true);
  assert.equal(
    result.source.match(/already has an active writer/g)?.length,
    20,
    'the retry classifier and every fail-closed path must retain the writer-conflict gate'
  );
  return {
    patchedSource: result.source,
    resume: new Function(result.source)()
  };
}

function legacyPatchedFixtureSource() {
  const resumeParams = '{threadId:n,history:null,model:null,modelProvider:H.modelProvider,cwd:`/workspace`}';
  const wrapper = [
    `let te=async()=>{${JSON.stringify(LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER)};`,
    `let codexProviderSwitcherResumeParams=${resumeParams};`,
    `if(H.modelProvider==null)throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is missing; sending is blocked\`);`,
    'let codexProviderSwitcherResumeResult=await e.sendRequest(`thread/resume`,codexProviderSwitcherResumeParams,V);',
    `if(codexProviderSwitcherResumeResult.thread?.id!==n)throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    'if(codexProviderSwitcherResumeResult.modelProvider!==H.modelProvider){',
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread provider mismatch; sending is blocked\`);`,
    'let codexProviderSwitcherUnsubscribeResult=await e.sendRequest(`thread/unsubscribe`,{threadId:n},V);',
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not release the previous provider; sending is blocked\`);`,
    'codexProviderSwitcherResumeResult=await e.sendRequest(`thread/resume`,codexProviderSwitcherResumeParams,V);',
    'if(codexProviderSwitcherResumeResult.thread?.id!==n||codexProviderSwitcherResumeResult.modelProvider!==H.modelProvider){',
    'await e.sendRequest(`thread/unsubscribe`,{threadId:n},V).catch(()=>{});',
    `throw Error(\`${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; provider verification failed; sending is blocked\`)`,
    '}',
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
  return ORIGINAL_SOURCE
    .replace(`let te=e.sendRequest(\`thread/resume\`,${resumeParams},V);`, wrapper)
    .replace('re=await te,', 're=await te(),')
    .replace(
      'e.updateConversationState(n,t=>{',
      'e.updateConversationState(n,t=>{t.modelProvider=re.modelProvider,'
    );
}

function intermediatePatchedFixtureSource() {
  const resumeParams = '{threadId:n,history:null,model:null,modelProvider:H.modelProvider,cwd:\`/workspace\`}';
  const wrapper = [
    `let te=async()=>{${JSON.stringify(INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER)};`,
    `let codexProviderSwitcherResumeParams=${resumeParams};`,
    'let codexProviderSwitcherConfigReadResult;',
    'try{',
    'codexProviderSwitcherConfigReadResult=await e.sendRequest(\`config/read\`,{includeLayers:false,cwd:codexProviderSwitcherResumeParams.cwd??null},V)',
    '}catch(codexProviderSwitcherConfigReadError){',
    `throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; current provider config could not be read; sending is blocked\`,{cause:codexProviderSwitcherConfigReadError})`,
    '}',
    'let codexProviderSwitcherEffectiveConfig=codexProviderSwitcherConfigReadResult?.config;',
    'let codexProviderSwitcherExpectedProvider=codexProviderSwitcherEffectiveConfig!=null&&typeof codexProviderSwitcherEffectiveConfig===\`object\`?codexProviderSwitcherEffectiveConfig.model_provider??\`openai\`:null;',
    `if(typeof codexProviderSwitcherExpectedProvider!==\`string\`||codexProviderSwitcherExpectedProvider.length===0)throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is invalid; sending is blocked\`);`,
    'codexProviderSwitcherResumeParams.modelProvider=codexProviderSwitcherExpectedProvider;',
    'let codexProviderSwitcherResumeResult;',
    'for(let codexProviderSwitcherResumeAttempt=0;;codexProviderSwitcherResumeAttempt+=1){',
    'try{codexProviderSwitcherResumeResult=await e.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,V);break}',
    'catch(codexProviderSwitcherResumeError){',
    'let codexProviderSwitcherResumeErrorText=String(codexProviderSwitcherResumeError?.message??codexProviderSwitcherResumeError).toLowerCase();',
    `if(!codexProviderSwitcherResumeErrorText.includes('already has an active writer')||codexProviderSwitcherResumeAttempt>=${WRITER_CONFLICT_RETRY_LIMIT - 1})throw codexProviderSwitcherResumeError;`,
    `await new Promise(codexProviderSwitcherResolve=>setTimeout(codexProviderSwitcherResolve,${WRITER_CONFLICT_RETRY_DELAY_MS}))`,
    '}',
    '}',
    `if(codexProviderSwitcherResumeResult.thread?.id!==n)throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    'if(codexProviderSwitcherResumeResult.modelProvider!==codexProviderSwitcherExpectedProvider){',
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread provider mismatch; sending is blocked\`);`,
    'let codexProviderSwitcherUnsubscribeResult=await e.sendRequest(\`thread/unsubscribe\`,{threadId:n},V);',
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not unsubscribe from the previous provider; sending is blocked\`);`,
    `throw Error(\`${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; provider mismatch requires a window reload; sending is blocked\`)`,
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
  return ORIGINAL_SOURCE
    .replace(`let te=e.sendRequest(\`thread/resume\`,${resumeParams},V);`, wrapper)
    .replace('re=await te,', 're=await te(),')
    .replace(
      'e.updateConversationState(n,t=>{',
      'e.updateConversationState(n,t=>{t.modelProvider=re.modelProvider,'
    );
}

function previousPatchedFixtureSource() {
  const resumeParams = '{threadId:n,history:null,model:null,modelProvider:H.modelProvider,cwd:\`/workspace\`}';
  const wrapper = [
    `let te=async()=>{${JSON.stringify(PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER)};`,
    `let codexProviderSwitcherResumeParams=${resumeParams};`,
    'let codexProviderSwitcherExpectedProvider=H.modelProvider??\`openai\`;',
    `if(typeof codexProviderSwitcherExpectedProvider!==\`string\`||codexProviderSwitcherExpectedProvider.length===0)throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is invalid; sending is blocked\`);`,
    'codexProviderSwitcherResumeParams.modelProvider=codexProviderSwitcherExpectedProvider;',
    'let codexProviderSwitcherResumeResult;',
    'for(let codexProviderSwitcherResumeAttempt=0;;codexProviderSwitcherResumeAttempt+=1){',
    'try{codexProviderSwitcherResumeResult=await e.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,V);break}',
    'catch(codexProviderSwitcherResumeError){',
    'let codexProviderSwitcherResumeErrorText=String(codexProviderSwitcherResumeError?.message??codexProviderSwitcherResumeError).toLowerCase();',
    `if(!codexProviderSwitcherResumeErrorText.includes('already has an active writer')||codexProviderSwitcherResumeAttempt>=${WRITER_CONFLICT_RETRY_LIMIT - 1})throw codexProviderSwitcherResumeError;`,
    `await new Promise(codexProviderSwitcherResolve=>setTimeout(codexProviderSwitcherResolve,${WRITER_CONFLICT_RETRY_DELAY_MS}))`,
    '}',
    '}',
    `if(codexProviderSwitcherResumeResult.thread?.id!==n)throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    'if(codexProviderSwitcherResumeResult.modelProvider!==codexProviderSwitcherExpectedProvider){',
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread provider mismatch; sending is blocked\`);`,
    'let codexProviderSwitcherUnsubscribeResult=await e.sendRequest(\`thread/unsubscribe\`,{threadId:n},V);',
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not unsubscribe from the previous provider; sending is blocked\`);`,
    `throw Error(\`${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; provider mismatch requires a window reload; sending is blocked\`)`,
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
  return ORIGINAL_SOURCE
    .replace(`let te=e.sendRequest(\`thread/resume\`,${resumeParams},V);`, wrapper)
    .replace('re=await te,', 're=await te(),')
    .replace(
      'e.updateConversationState(n,t=>{',
      'e.updateConversationState(n,t=>{t.modelProvider=re.modelProvider,'
    );
}

function olderPatchedFixtureSource() {
  const resumeParams = '{threadId:n,history:null,model:null,modelProvider:H.modelProvider,cwd:\`/workspace\`}';
  const wrapper = [
    `let te=async()=>{${JSON.stringify(OLDER_PROVIDER_TAKEOVER_PATCH_MARKER)};`,
    `let codexProviderSwitcherResumeParams=${resumeParams};`,
    `if(H.modelProvider==null)throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; selected provider is missing; sending is blocked\`);`,
    'let codexProviderSwitcherResumeResult;',
    'for(let codexProviderSwitcherResumeAttempt=0;;codexProviderSwitcherResumeAttempt+=1){',
    'try{codexProviderSwitcherResumeResult=await e.sendRequest(\`thread/resume\`,codexProviderSwitcherResumeParams,V);break}',
    'catch(codexProviderSwitcherResumeError){',
    'let codexProviderSwitcherResumeErrorText=String(codexProviderSwitcherResumeError?.message??codexProviderSwitcherResumeError).toLowerCase();',
    `if(!codexProviderSwitcherResumeErrorText.includes('already has an active writer')||codexProviderSwitcherResumeAttempt>=${WRITER_CONFLICT_RETRY_LIMIT - 1})throw codexProviderSwitcherResumeError;`,
    `await new Promise(codexProviderSwitcherResolve=>setTimeout(codexProviderSwitcherResolve,${WRITER_CONFLICT_RETRY_DELAY_MS}))`,
    '}',
    '}',
    `if(codexProviderSwitcherResumeResult.thread?.id!==n)throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; unexpected thread identity\`);`,
    'if(codexProviderSwitcherResumeResult.modelProvider!==H.modelProvider){',
    `if(codexProviderSwitcherResumeResult.thread?.status?.type!==\`idle\`)throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; active thread provider mismatch; sending is blocked\`);`,
    'let codexProviderSwitcherUnsubscribeResult=await e.sendRequest(\`thread/unsubscribe\`,{threadId:n},V);',
    `if(codexProviderSwitcherUnsubscribeResult.status!==\`unsubscribed\`)throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; could not unsubscribe from the previous provider; sending is blocked\`);`,
    `throw Error(\`${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER} already has an active writer; provider mismatch requires a window reload; sending is blocked\`)`,
    '}',
    'return codexProviderSwitcherResumeResult}'
  ].join('');
  return ORIGINAL_SOURCE
    .replace(`let te=e.sendRequest(\`thread/resume\`,${resumeParams},V);`, wrapper)
    .replace('re=await te,', 're=await te(),')
    .replace(
      'e.updateConversationState(n,t=>{',
      'e.updateConversationState(n,t=>{t.modelProvider=re.modelProvider,'
    );
}

async function withImmediateRetryTimers(callback) {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (handler) => {
    handler();
    return 0;
  };
  try {
    return await callback();
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

function response(provider, status = 'idle', id = 'thread-1', selection = {}) {
  return {
    modelProvider: provider,
    model: selection.model ?? 'gpt-5.6-sol',
    reasoningEffort: selection.reasoningEffort ?? 'max',
    serviceTier: selection.serviceTier ?? 'default',
    thread: {
      id,
      sessionId: `session-${provider}`,
      status: { type: status }
    }
  };
}

function defaultModelList() {
  return {
    data: [
      {
        model: 'gpt-5.6-sol',
        isDefault: true,
        defaultReasoningEffort: 'max',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low' },
          { reasoningEffort: 'high' },
          { reasoningEffort: 'max' }
        ],
        serviceTiers: [{ id: 'priority' }]
      },
      {
        model: 'gpt-5.6-terra',
        isDefault: false,
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low' },
          { reasoningEffort: 'high' },
          { reasoningEffort: 'max' }
        ],
        serviceTiers: []
      }
    ],
    nextCursor: null
  };
}

function managerWithResponses(responses, settings = {}) {
  const calls = [];
  const state = {};
  const hasConfigResult = Object.hasOwn(settings, 'configResult');
  const effectiveProvider = Object.hasOwn(settings, 'effectiveProvider')
    ? settings.effectiveProvider
    : 'lab_relay';
  return {
    calls,
    state,
    canonicalTurnHistory: true,
    async sendRequest(method, params, requestOptions) {
      calls.push({ method, params, options: requestOptions });
      if (method === 'config/read') {
        if (settings.configError) {
          throw settings.configError;
        }
        return hasConfigResult
          ? settings.configResult
          : { config: { model_provider: effectiveProvider } };
      }
      if (method === 'account/read') {
        if (settings.accountError) {
          throw settings.accountError;
        }
        return Object.hasOwn(settings, 'accountResult')
          ? settings.accountResult
          : {
            account: { type: 'chatgpt', email: null, planType: 'plus' },
            requiresOpenaiAuth: true
          };
      }
      if (method === 'model/list') {
        if (settings.modelListError) {
          throw settings.modelListError;
        }
        return settings.modelListResult || defaultModelList();
      }
      const next = responses.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    updateConversationState(threadId, update) {
      assert.equal(threadId, 'thread-1');
      update(state);
    }
  };
}

test('provider takeover patch', async (t) => {
  await t.test('recognizes only a writer-conflict gate that disables the composer', () => {
    const guarded = 'const {isResuming:p,isWriterConflict:m,retryResume:h}=resume();let v=!s||m,y=p&&!m,x=s&&!m;render({isReadOnly:v,isResuming:y,showComposer:x,retry:`localConversation.writerConflict.retry`,title:`This is open in another app`})';
    assert.equal(verifyProviderTakeoverComposerGateSource(guarded), true);
    assert.equal(
      verifyProviderTakeoverComposerGateSource(guarded.replace('showComposer:x', 'showComposer:s')),
      false
    );
  });

  await t.test('leaves an already-correct runtime subscribed', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([response('lab_relay')]);
    const result = await resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, { trace: true });

    assert.equal(result.re.modelProvider, 'lab_relay');
    assert.equal(manager.state.modelProvider, 'lab_relay');
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'thread/resume']
    );
    assert.deepEqual(manager.calls[0].params, { includeLayers: false, cwd: '/workspace' });
  });

  await t.test('uses the effective config instead of the provider stored in old history', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([response('lab_relay')]);

    const result = await resume(manager, 'thread-1', { modelProvider: 'openai' }, {});
    assert.equal(result.re.modelProvider, 'lab_relay');
    assert.equal(manager.state.modelProvider, 'lab_relay');
    assert.equal(manager.calls[2].params.modelProvider, 'lab_relay');
  });

  await t.test('normalizes the omitted account provider in effective config to openai', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([response('openai')], { effectiveProvider: null });

    const result = await resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, {});
    assert.equal(result.re.modelProvider, 'openai');
    assert.equal(manager.state.modelProvider, 'openai');
    assert.deepEqual(manager.calls[2].params, { refreshToken: false });
    assert.equal(manager.calls[3].params.modelProvider, 'openai');
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'account/read', 'thread/resume']
    );
  });

  await t.test('blocks account history while signed out', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([], {
      effectiveProvider: null,
      accountResult: { account: null, requiresOpenaiAuth: true }
    });

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'openai' }, {}),
      /no ChatGPT account is signed in; sending is blocked/
    );
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'account/read']
    );
  });

  await t.test('blocks account history when login state cannot be read', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([], {
      effectiveProvider: null,
      accountError: new Error('account unavailable')
    });

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'openai' }, {}),
      /current ChatGPT account state could not be read; sending is blocked/
    );
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'account/read']
    );
  });

  await t.test('overrides old history with the effective model, effort, and service tier', async () => {
    const { resume } = compilePatchedFixture();
    const selection = {
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      serviceTier: 'default'
    };
    const manager = managerWithResponses([response('lab_relay', 'idle', 'thread-1', selection)], {
      configResult: {
        config: {
          model_provider: 'lab_relay',
          model: 'gpt-5.6-terra',
          model_reasoning_effort: 'high'
        }
      }
    });

    const result = await resume(manager, 'thread-1', { modelProvider: 'openai' }, {});
    assert.equal(result.re.model, 'gpt-5.6-terra');
    assert.equal(result.re.reasoningEffort, 'high');
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'thread/resume']
    );
    assert.deepEqual(manager.calls[2].params, {
      threadId: 'thread-1',
      history: null,
      model: 'gpt-5.6-terra',
      modelProvider: 'lab_relay',
      cwd: '/workspace',
      config: { model_reasoning_effort: 'high' },
      serviceTier: null
    });
  });

  await t.test('keeps a thread-specific model and effort when the current catalog supports them', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([response('lab_relay', 'idle', 'thread-1', {
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
      serviceTier: 'priority'
    })], {
      configResult: {
        config: {
          model_provider: 'lab_relay',
          model: 'gpt-5.6-terra',
          model_reasoning_effort: 'high'
        }
      }
    });

    await resume(manager, 'thread-1', {
      modelProvider: 'openai',
      model: 'gpt-5.6-sol',
      config: { model_reasoning_effort: 'low' },
      serviceTier: 'priority'
    }, {});
    assert.deepEqual(manager.calls[2].params, {
      threadId: 'thread-1',
      history: null,
      model: 'gpt-5.6-sol',
      modelProvider: 'lab_relay',
      cwd: '/workspace',
      config: { model_reasoning_effort: 'low' },
      serviceTier: 'priority'
    });
  });

  await t.test('supports a standalone await assignment used by newer Codex bundles', () => {
    const result = patchProviderTakeoverSource(SEMICOLON_AWAIT_SOURCE);

    assert.equal(result.status, 'patched');
    assert.equal(result.replacementCount, 3);
    assert.equal(result.source.includes('re=await te();'), true);
    assert.equal(verifyPatchedProviderTakeoverSource(result.source), true);
    assert.equal(patchProviderTakeoverSource(result.source).status, 'already-patched');
  });

  await t.test('falls back from stale thread selections to compatible current settings', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([response('lab_relay', 'idle', 'thread-1', {
      model: 'gpt-5.6-terra',
      reasoningEffort: 'low',
      serviceTier: 'default'
    })], {
      configResult: {
        config: {
          model_provider: 'lab_relay',
          model: 'gpt-5.6-terra',
          model_reasoning_effort: 'low',
          service_tier: 'default'
        }
      }
    });

    await resume(manager, 'thread-1', {
      modelProvider: 'openai',
      model: 'gpt-5.5',
      config: { model_reasoning_effort: 'xhigh' },
      serviceTier: 'flex'
    }, {});
    assert.equal(manager.calls[2].params.model, 'gpt-5.6-terra');
    assert.deepEqual(manager.calls[2].params.config, { model_reasoning_effort: 'low' });
    assert.equal(manager.calls[2].params.serviceTier, 'default');
  });

  await t.test('fails closed when the current model catalog cannot be proven complete', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([], {
      modelListResult: { ...defaultModelList(), nextCursor: 'more-models' }
    });

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, {}),
      /current model catalog is incomplete; sending is blocked/
    );
    assert.deepEqual(manager.calls.map((call) => call.method), ['config/read', 'model/list']);
  });

  await t.test('fails closed before resume when the selected provider is invalid', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([], { effectiveProvider: '' });

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'openai' }, {}),
      /already has an active writer; selected provider is invalid; sending is blocked/
    );
    assert.deepEqual(manager.calls.map((call) => call.method), ['config/read']);
  });

  await t.test('fails closed before resume when effective config cannot be read', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([], { configError: new Error('config unavailable') });

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'openai' }, {}),
      /current provider config could not be read; sending is blocked/
    );
    assert.deepEqual(manager.calls.map((call) => call.method), ['config/read']);
  });

  await t.test('retries a transient writer handoff and keeps the selected provider', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([
      new Error('thread thread-1 already has an active writer'),
      new Error('thread thread-1 already has an active writer'),
      response('lab_relay')
    ]);
    const options = { trace: true };
    const result = await withImmediateRetryTimers(
      () => resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, options)
    );

    assert.equal(result.re.thread.id, 'thread-1');
    assert.equal(result.re.modelProvider, 'lab_relay');
    assert.equal(manager.state.modelProvider, 'lab_relay');
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'thread/resume', 'thread/resume', 'thread/resume']
    );
    assert.equal(manager.calls[2].params, manager.calls[3].params);
    assert.equal(manager.calls[3].params, manager.calls[4].params);
    assert.ok(manager.calls.every((call) => call.options === options));
  });

  await t.test('stops after the bounded writer-conflict retry window', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses(
      Array.from(
        { length: WRITER_CONFLICT_RETRY_LIMIT },
        () => new Error('thread thread-1 already has an active writer')
      )
    );

    await withImmediateRetryTimers(() => assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, {}),
      /already has an active writer/
    ));
    assert.equal(manager.calls.length, WRITER_CONFLICT_RETRY_LIMIT + 2);
    assert.equal(manager.calls[0].method, 'config/read');
    assert.equal(manager.calls[1].method, 'model/list');
    assert.ok(manager.calls.slice(2).every((call) => call.method === 'thread/resume'));
  });

  await t.test('does not retry an unrelated resume failure', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([new Error('authentication failed')]);

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, {}),
      /authentication failed/
    );
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'thread/resume']
    );
  });

  await t.test('fails closed instead of releasing an active thread', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([response('openai', 'active')]);

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, {}),
      /already has an active writer; active thread runtime selection mismatch; sending is blocked/
    );
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'thread/resume']
    );
  });

  await t.test('unsubscribes an idle provider mismatch but never retries it in the loaded runtime', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([
      response('openai'),
      { status: 'unsubscribed' }
    ]);

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, {}),
      /already has an active writer; runtime selection mismatch requires a window reload; sending is blocked/
    );
    assert.deepEqual(manager.calls.map((call) => call.method), [
      'config/read',
      'model/list',
      'thread/resume',
      'thread/unsubscribe'
    ]);
  });

  await t.test('fails closed when an idle provider mismatch cannot be unsubscribed', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([
      response('openai'),
      { status: 'notSubscribed' }
    ]);

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'lab_relay' }, {}),
      /already has an active writer; could not unsubscribe from the previous provider; sending is blocked/
    );
    assert.deepEqual(
      manager.calls.map((call) => call.method),
      ['config/read', 'model/list', 'thread/resume', 'thread/unsubscribe']
    );
  });

  await t.test('rejects a stale model or reasoning selection returned by the loaded runtime', async () => {
    const { resume } = compilePatchedFixture();
    const manager = managerWithResponses([
      response('lab_relay', 'idle', 'thread-1', {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'max',
        serviceTier: 'default'
      }),
      { status: 'unsubscribed' }
    ], {
      configResult: {
        config: {
          model_provider: 'lab_relay',
          model: 'gpt-5.6-terra',
          model_reasoning_effort: 'high'
        }
      }
    });

    await assert.rejects(
      resume(manager, 'thread-1', { modelProvider: 'openai' }, {}),
      /runtime selection mismatch requires a window reload; sending is blocked/
    );
    assert.deepEqual(manager.calls.map((call) => call.method), [
      'config/read',
      'model/list',
      'thread/resume',
      'thread/unsubscribe'
    ]);
  });

  await t.test('upgrades the verified v4 patch with account and model-state validation', () => {
    const intermediateSource = intermediatePatchedFixtureSource();
    assert.equal(
      intermediateSource.includes(INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER),
      true
    );
    assert.equal(intermediateSource.includes(PROVIDER_TAKEOVER_PATCH_MARKER), false);

    const result = patchProviderTakeoverSource(intermediateSource);
    assert.equal(result.status, 'patched');
    assert.equal(result.replacementCount, 1);
    assert.equal(result.source.includes(INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER), false);
    assert.equal(verifyPatchedProviderTakeoverSource(result.source), true);
    assert.equal(result.source.includes('sendRequest(`account/read`'), true);
    assert.equal(result.source.includes('model_reasoning_effort:'), true);
  });

  await t.test('upgrades the verified v3 patch so old history cannot override effective config', () => {
    const previousSource = previousPatchedFixtureSource();
    assert.equal(previousSource.includes(PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER), true);
    assert.equal(previousSource.includes(PROVIDER_TAKEOVER_PATCH_MARKER), false);

    const result = patchProviderTakeoverSource(previousSource);
    assert.equal(result.status, 'patched');
    assert.equal(result.replacementCount, 1);
    assert.equal(result.source.includes(PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER), false);
    assert.equal(verifyPatchedProviderTakeoverSource(result.source), true);
    assert.equal(result.source.includes('sendRequest(`config/read`'), true);
    assert.equal(result.source.includes('codexProviderSwitcherEffectiveConfig.model_provider'), true);
    assert.equal(result.source.includes('codexProviderSwitcherResumeParams.modelProvider='), true);
  });

  await t.test('upgrades the verified v2 patch to effective-config routing', () => {
    const olderSource = olderPatchedFixtureSource();
    assert.equal(olderSource.includes(OLDER_PROVIDER_TAKEOVER_PATCH_MARKER), true);
    assert.equal(olderSource.includes(PROVIDER_TAKEOVER_PATCH_MARKER), false);

    const result = patchProviderTakeoverSource(olderSource);
    assert.equal(result.status, 'patched');
    assert.equal(result.replacementCount, 1);
    assert.equal(result.source.includes(OLDER_PROVIDER_TAKEOVER_PATCH_MARKER), false);
    assert.equal(verifyPatchedProviderTakeoverSource(result.source), true);
    assert.equal(result.source.includes('sendRequest(`config/read`'), true);
  });

  await t.test('upgrades the verified v1 patch without touching the thread identity or state hooks', () => {
    const legacySource = legacyPatchedFixtureSource();
    assert.equal(legacySource.includes(LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER), true);
    assert.equal(legacySource.includes(PROVIDER_TAKEOVER_PATCH_MARKER), false);

    const result = patchProviderTakeoverSource(legacySource);
    assert.equal(result.status, 'patched');
    assert.equal(result.replacementCount, 1);
    assert.equal(result.source.includes(LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER), false);
    assert.equal(verifyPatchedProviderTakeoverSource(result.source), true);
    assert.equal(result.source.includes('re=await te()'), true);
    assert.equal(result.source.includes('t.modelProvider=re.modelProvider'), true);
  });

  await t.test('is idempotent and refuses a tampered marker', () => {
    const { patchedSource } = compilePatchedFixture();
    assert.equal(patchProviderTakeoverSource(patchedSource).status, 'already-patched');

    const tampered = patchedSource.replace(
      'codexProviderSwitcherUnsubscribeResult.status!==`unsubscribed`',
      'false'
    );
    assert.equal(verifyPatchedProviderTakeoverSource(tampered), false);
    assert.deepEqual(patchProviderTakeoverSource(tampered), {
      status: 'unsupported',
      reason: 'Provider 接管标记存在，但安全结构校验失败'
    });
  });

  await t.test('refuses ambiguous or structurally unknown bundles', () => {
    assert.equal(patchProviderTakeoverSource('thread/resume').status, 'unsupported');
    assert.equal(
      patchProviderTakeoverSource(`${ORIGINAL_SOURCE}${ORIGINAL_SOURCE}`).status,
      'unsupported'
    );
    assert.equal(
      patchProviderTakeoverSource(`${ORIGINAL_SOURCE}${PROVIDER_TAKEOVER_PATCH_MARKER}`).status,
      'unsupported'
    );
    assert.equal(
      patchProviderTakeoverSource(
        `${ORIGINAL_SOURCE}${INTERMEDIATE_PROVIDER_TAKEOVER_PATCH_MARKER}`
      ).status,
      'unsupported'
    );
    assert.equal(
      patchProviderTakeoverSource(
        `${ORIGINAL_SOURCE}${PREVIOUS_PROVIDER_TAKEOVER_PATCH_MARKER}`
      ).status,
      'unsupported'
    );
    assert.equal(
      patchProviderTakeoverSource(`${ORIGINAL_SOURCE}${OLDER_PROVIDER_TAKEOVER_PATCH_MARKER}`).status,
      'unsupported'
    );
    assert.equal(
      patchProviderTakeoverSource(`${ORIGINAL_SOURCE}${LEGACY_PROVIDER_TAKEOVER_PATCH_MARKER}`).status,
      'unsupported'
    );
  });
});

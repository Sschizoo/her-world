'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../framework/model.js');
const Runtime = require('../framework/runtime.js');
const Packs = require('../framework/packs.js');
const Caps = require('../framework/capabilities.js');
const Budget = require('../framework/recall-budget.js');

const key = 'MOCK_ONLY_ANSWER_ROUTING_KEY';
const clone = value => JSON.parse(JSON.stringify(value));
const fresh = (id = 'lantern-lab') => Runtime.create(Packs.get(id));
const answer = (questionId = 'q_purpose', value = '在窗边读书') => ({ type: 'story.answer', questionId, value });
const row = (text, operations = [], mode = 'discussion') => ({ text, mode, operations });
const plan = (operations = [], topic = null) => ({ schema: 'her-world-turn-v4', requestedChanges: [], lines: [row('我们继续聊。', operations)], topic });
const envelope = raw => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] }), { status: 200 });
async function modeled(raw, state = fresh(), input = '我想在窗边读书。', context = Runtime.context(state)) {
  const adapter = Model.create({ fetch: async () => envelope(raw) });
  assert(adapter.connect(key));
  try { return await adapter.request({ context, input }); }
  finally { adapter.disconnect(); }
}
const commit = (state, input, normalized) => Runtime.commitModel(state, Runtime.propose(state, { text: input }), normalized);
const bench = () => ({ type: 'world.create', object: { label: '双人长椅', glyphs: '|________|\n|        |', scale: 1 }, placement: { anchor: 'window_below' } });
const localPlan = (operations = [], topic = null) => ({ schema: Caps.SCHEMA, lines: ['继续。'], beats: operations.length ? [{ afterLine: 0, operations }] : [], topic });
function advance(state, operations, topic, input = '继续。') {
  const result = commit(state, input, localPlan(operations, topic));
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.state;
}
function parallelQuestions() {
  const pack = Packs.get('rain-lab');
  pack.nodes[1].requires = {};
  return Runtime.create(pack);
}
function consentReady() {
  let state = fresh('rain-lab');
  state = advance(state, [answer('q_rain', '轻轻的雨')], 'rain');
  state = advance(state, [answer('q_name', '夜航')], 'naming');
  return Runtime.observe(state, { type: 'panel.viewed', panel: 'logs' });
}
function assertAtomicFailure(state, input, normalized, code) {
  const before = clone(state), saved = clone(Runtime.serialize(state));
  const result = commit(state, input, normalized);
  assert.equal(result.ok, false);
  if (code) assert.equal(result.error.code, code, JSON.stringify(result.error));
  assert.equal(result.frames, undefined);
  assert.deepEqual(state, before);
  assert.deepEqual(Runtime.serialize(state), saved);
  return result;
}

for (const topic of [null, 'making']) test('synthetic exact-input compound routes the purpose answer from supplied topic ' + topic, async () => {
  const state = Runtime.observe(fresh(), { type: 'panel.viewed', panel: 'world' });
  const input = '我想在窗边读书。先添一把能坐两个人的长椅吧。';
  // Transport fixture reproduces the live failure shape, not a claimed raw provider capture.
  // The inspected live diagnostic did not reveal its root topic or later operations.
  const raw = { schema: 'her-world-turn-v4', requestedChanges: [{ domain: 'scene', support: { quote: '先添一把能坐两个人的长椅吧。' } }], lines: [
    row('我们把窗边留作读书的地方。', [answer()]),
    row('双人长椅放好了。', [bench()], 'apply_now')
  ], topic };
  const original = clone(raw), normalized = await modeled(raw, state, input), result = commit(state, input, normalized);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(normalized.topic, 'purpose');
  assert.deepEqual(raw, original);
  assert.equal(normalized.beats[0].operations[0].type, 'story.answer');
  assert.deepEqual(normalized.beats.map(beat => beat.afterLine), [0, 1]);
  assert.deepEqual(result.frames[0].story.completed, ['purpose']);
  assert.equal(result.frames[0].world.objects.length, 0);
  assert.deepEqual(result.frames[1].story.completed, ['purpose', 'make']);
  assert.equal(result.frames[1].world.objects.length, 1);
  assert.deepEqual(result.state.story.answers.q_purpose.source, { eventId: 'event_2', text: input });
  assert.equal(result.state.world.objects[0].source.createdBy, input);
  assert.equal(result.state.events[1].plan.schema, Caps.SCHEMA);
  assert.equal(result.state.events[1].plan.topic, 'purpose');
  assert.deepEqual(Runtime.restore(Runtime.serialize(result.state), state.pack).state, result.state);
});

test('the current prompt explains local answer routing without changing historical descriptors or recall cost', () => {
  const context = Runtime.context(fresh()), request = Model.buildRequest(context, '你好');
  const system = request.messages[0].content;
  assert(system.includes('无需再在topic重复匹配'));
  assert(system.includes('回答回合的topic没有独立切换作用'));
  assert(system.includes('没有story.answer就不会因文本看似回答而自动推进'));
  assert(system.includes('该同意问题在回合开始时就是activeQuestionId'));
  assert(!system.includes('Set plan.topic to that question topic.'));
  assert.equal(Object.hasOwn(JSON.parse(request.messages[1].content).context, 'capabilities'), false);
  const current = Caps.descriptors(['story.answer'], '4')[0];
  assert(current.description.includes('the local adapter derives the answer topic'));
  assert(!current.description.includes('Set plan.topic'));
  for (const version of ['2', '3']) {
    const historical = Caps.descriptors(['story.answer'], version)[0];
    assert.equal(historical.description, Budget.PROFILE.baseDescriptions['story.answer']);
    assert.deepEqual(historical.schema, current.schema);
  }
  const bases = new Map(Caps.descriptors(Caps.ids, '4').map(item => [item.id, item.description]));
  const prior = new Map(Caps.descriptors(context.capabilities.map(item => item.id), '3', context.world, context.entities).map(item => [item.id, item]));
  const historicalCost = { ...context, capabilities: context.capabilities.map(item => ({ ...item,
    ...(['world.create', 'world.update'].includes(item.id) ? { schema: prior.get(item.id).schema } : {}),
    description: Budget.PROFILE.baseDescriptions[item.id] + item.description.slice(bases.get(item.id).length)
  })) };
  assert.equal(Runtime.contextBudgetBytes(context), Caps.requestContextBytes(historicalCost));
  assert(system.includes('"align"') && system.includes('align:bottom'), 'current wire still exposes the full alignment contract');
});

test('off-topic, answer-like prose and no-answer topic changes never infer an answer', async () => {
  const state = fresh();
  for (const [input, raw] of [
    ['现在几点了？', plan()],
    ['我想在窗边读书。', { ...plan(), lines: [row('明白，这里可以用来读书。')] }],
    ['先说说造物。', plan([], 'making')],
    ['这个问题先放一放。', plan([{ type: 'story.defer', questionId: 'q_purpose' }])]
  ]) {
    const normalized = await modeled(raw, state, input), result = commit(state, input, normalized);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(normalized.topic, raw.topic);
    assert.deepEqual(result.state.story.completed, []);
    assert.deepEqual(result.state.story.answers, {});
    assert.equal(Runtime.context(result.state).pendingQuestions[0].id, 'q_purpose');
    assert.equal(result.state.story.topic, raw.topic || state.story.topic);
    assert.equal(result.state.story.deferred.includes('q_purpose'), input === '这个问题先放一放。');
  }
});

test('a physical request alone does not answer the purpose question or unlock its dependent node', async () => {
  const state = fresh(), input = '先添一把长椅。';
  const raw = { ...plan([], 'making'), requestedChanges: [{ domain: 'scene', support: { quote: input } }], lines: [row('长椅放好了。', [bench()], 'apply_now')] };
  const normalized = await modeled(raw, state, input), result = commit(state, input, normalized);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(normalized.topic, 'making');
  assert.equal(result.state.world.objects.length, 1);
  assert.deepEqual(result.state.story.completed, []);
});

test('a genuinely pending other-topic open question can be revisited, including after deferral', async () => {
  let state = parallelQuestions();
  state = advance(state, [{ type: 'story.defer', questionId: 'q_name' }], 'rain');
  assert.equal(Runtime.context(state).activeQuestionId, 'q_rain');
  assert(Runtime.context(state).pendingQuestions.some(question => question.id === 'q_name' && question.deferred));
  for (const topic of [null, 'rain', 'naming']) {
    const input = '回到名字，我想叫它夜航。';
    const normalized = await modeled(plan([answer('q_name', '夜航')], topic), state, input), result = commit(state, input, normalized);
    assert.equal(normalized.topic, 'naming');
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.deepEqual(result.state.story.completed, ['name']);
    assert.equal(result.state.story.answers.q_name.value, '夜航');
    assert.equal(result.state.story.answers.q_rain, undefined);
    assert(!result.state.story.deferred.includes('q_name'));
    assert(Runtime.context(result.state).pendingQuestions.some(question => question.id === 'q_rain'));
  }
});

test('answer timing, exact source ownership and report-body adaptation survive normalization and replay', async () => {
  const state = fresh(), input = '我想在窗边读书。';
  const report = { type: 'memory.upsert', id: 'note_reading', title: '窗边用途', perspective: 'player_report', support: { quote: '在窗边读书' } };
  const raw = { ...plan([], 'making'), lines: [row('我先想一想。'), row('这里适合读书，我记下了。', [{ ...answer('q_purpose', '读书'), evidence: '模型的非权威解释' }, { ...report, evidence: '模型的非权威解释' }])] };
  const normalized = await modeled(raw, state, input), result = commit(state, input, normalized);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(normalized.beats.map(beat => beat.afterLine), [1]);
  assert.equal(result.frames[0].story.answers.q_purpose, undefined);
  assert.equal(result.frames[0].memories.length, 0);
  assert.equal(result.frames[1].story.answers.q_purpose.value, '读书');
  assert.deepEqual(result.state.story.answers.q_purpose.source, { eventId: 'event_1', text: input });
  assert.equal(Object.hasOwn(normalized.beats[0].operations[0], 'evidence'), false);
  assert.equal(normalized.beats[0].operations[1].body, '在窗边读书');
  assert.equal(Object.hasOwn(normalized.beats[0].operations[1], 'evidence'), false);
  assert.equal(result.state.memories[0].source.text, input);
  assert.equal(result.state.memories[0].body, '在窗边读书');
  const saved = Runtime.serialize(result.state);
  assert.equal(Object.hasOwn(saved.events[0].plan, 'requestedChanges'), false);
  assert.deepEqual(Runtime.restore(saved, state.pack).state, result.state);
  assert.deepEqual(Runtime.view(result.state, { event: 0, line: 0 }).story.answers, {});
  assert.equal(Runtime.view(result.state, { event: 0, line: 1 }).story.answers.q_purpose.value, '读书');
  const forged = clone(saved);
  forged.events[0].plan.topic = 'making';
  assert.equal(Runtime.restore(forged, state.pack).error.code, 'ANSWER_BOUNDARY');
});

test('invalid supplied root topics and root fields cannot be repaired by a valid answer', async () => {
  const state = fresh(), input = '我想在窗边读书。';
  for (const topic of ['unknown', '', 0, false, [], {}, ['purpose']]) {
    const normalized = await modeled(plan([answer()], topic), state, input);
    assert.deepEqual(normalized.topic, topic);
    assertAtomicFailure(state, input, normalized, 'TOPIC_INVALID');
  }
  const missingTopic = plan([answer()]); delete missingTopic.topic;
  for (const raw of [missingTopic, { ...plan([answer()]), evidence: input }, { ...plan([answer()]), beats: [] }]) {
    await assert.rejects(modeled(raw, state, input), error => error.diagnostic?.code === 'TURN_ROOT_FIELDS');
  }
});

test('unavailable, stale, newly unlocked and non-answer questions remain unavailable', async () => {
  const input = '继续。';
  const initial = fresh();
  const answered = advance(initial, [answer()], 'purpose');
  const made = advance(answered, [bench()], 'making');
  for (const [state, questionId, topic] of [
    [initial, 'missing_question', 'making'], [initial, 'q_route', 'making'],
    [initial, 'q_make', 'making'], [answered, 'q_purpose', 'making'],
    [answered, 'q_make', 'making'], [made, 'q_inspect', 'place']
  ]) {
    const normalized = await modeled(plan([answer(questionId, '回答')], topic), state, input);
    assert.equal(normalized.topic, topic);
    assertAtomicFailure(state, input, normalized, 'ANSWER_UNAVAILABLE');
  }
  const pendingName = advance(fresh('rain-lab'), [answer('q_rain', '雨')], 'rain');
  const raw = plan([answer('q_name', '夜航'), answer('q_read', '看过了')], 'naming');
  assertAtomicFailure(pendingName, input, await modeled(raw, pendingName, input), 'ANSWER_UNAVAILABLE');
});

test('multiple answers, including a malformed second occurrence, do not derive a topic or partially commit', async () => {
  const state = parallelQuestions(), input = '轻轻的雨，叫夜航。';
  for (const operations of [
    [answer('q_rain', '轻轻的雨'), answer('q_name', '夜航')],
    [answer('q_rain', '轻轻的雨'), { type: 'story.answer' }],
    [answer('q_rain', '轻轻的雨'), answer('q_rain', '重复')]
  ]) {
    for (const topic of [null, 'rain']) for (const lines of [[row('第一句。', operations)], [row('第一句。', [operations[0]]), row('第二句。', [operations[1]])]]) {
      const raw = { ...plan([], topic), lines };
      const normalized = await modeled(raw, state, input);
      assert.equal(normalized.topic, topic);
      assertAtomicFailure(state, input, normalized);
    }
  }
});

test('an earlier physical operation cannot authorize an answer that was not pending before the turn', async () => {
  const pack = Packs.get('lantern-lab');
  pack.nodes = [
    { ...pack.nodes[1], requires: {} },
    { ...pack.nodes[4], requires: { object_made: true } }
  ];
  const state = Runtime.create(pack), input = '添一把长椅，再说说我想保留的细节。';
  assert.deepEqual(Runtime.context(state).pendingQuestions.map(question => question.id), ['q_make']);
  const raw = { ...plan([], 'stay'), requestedChanges: [{ domain: 'scene', support: { quote: '添一把长椅' } }], lines: [
    row('长椅放好了。', [bench()], 'apply_now'), row('想保留窗边的安静。', [answer('q_stay', '窗边的安静')])
  ] };
  const normalized = await modeled(raw, state, input);
  assert.equal(normalized.topic, 'stay');
  const rejected = assertAtomicFailure(state, input, normalized, 'ANSWER_UNAVAILABLE');
  assert.equal(rejected.error.diagnostic.path, 'beats[1].operations[0]');
});

test('malformed answer schemas, invalid siblings and disabled capabilities remain atomic runtime failures', async () => {
  const state = fresh(), input = '我想在窗边读书。';
  for (const operation of [
    { type: 'story.answer', questionId: 'q_purpose' }, answer('q_purpose', ''), answer('q_purpose', 'x'.repeat(201)),
    answer(7, '读书'), { ...answer(), source: { text: input } }, { ...answer(), surprise: true },
    { ...answer(), evidence: '' }, { ...answer(), evidence: 'x'.repeat(201) }
  ]) {
    const normalized = await modeled(plan([operation], 'making'), state, input);
    assert.equal(normalized.topic, 'making');
    assertAtomicFailure(state, input, normalized, 'OPERATION_INVALID');
  }
  for (const sibling of [null, { type: 'unknown.capability' }, { type: 'memory.remove', id: 'memory_99999' }]) {
    const normalized = await modeled(plan([answer(), sibling], 'making'), state, input);
    assert.equal(normalized.topic, 'purpose');
    assertAtomicFailure(state, input, normalized);
  }
  const pack = Packs.get('lantern-lab');
  pack.capabilities = pack.capabilities.filter(id => id !== 'story.answer');
  pack.nodes = [];
  const disabled = Runtime.create(pack);
  assertAtomicFailure(disabled, input, await modeled(plan([answer()]), disabled, input), 'CAPABILITY_DISABLED');
  const noLogPack = Packs.get('lantern-lab');
  noLogPack.capabilities = noLogPack.capabilities.filter(id => id !== 'log.note');
  const noLog = Runtime.create(noLogPack);
  const normalized = await modeled(plan([answer(), { type: 'log.note', text: '读书' }], 'making'), noLog, input);
  assert.equal(normalized.topic, 'purpose');
  assertAtomicFailure(noLog, input, normalized, 'CAPABILITY_DISABLED');
});

test('routing requires one captured pending entry, answer completion and a captured valid question topic', async () => {
  const state = fresh(), input = '我想在窗边读书。';
  for (const change of [
    context => { delete context.pendingQuestions; },
    context => { context.pendingQuestions = []; },
    context => { context.pendingQuestions.push(clone(context.pendingQuestions[0])); },
    context => { context.pendingQuestions[0].completion = { type: 'ui', panel: 'world' }; },
    context => { context.pendingQuestions[0].topic = 'unknown'; },
    context => { context.pendingQuestions[0].topic = null; },
    context => { context.pendingQuestions[0].topic = 3; context.topics.push({ id: 3, title: 'invalid' }); }
  ]) {
    const context = clone(Runtime.context(state)); change(context);
    const normalized = await modeled(plan([answer()], 'making'), state, input, context);
    assert.equal(normalized.topic, 'making');
    assertAtomicFailure(state, input, normalized, 'ANSWER_BOUNDARY');
  }
});

test('choice validation remains strict after valid root-topic normalization', async () => {
  let state = advance(fresh(), [answer()], 'purpose');
  state = advance(state, [bench()], 'making');
  state = Runtime.observe(state, { type: 'panel.viewed', panel: 'world' });
  assert.equal(Runtime.context(state).activeQuestionId, 'q_route');
  for (const value of ['stay', 'explore']) {
    const normalized = await modeled(plan([answer('q_route', value)], 'making'), state, '下一步。');
    const result = commit(state, '下一步。', normalized);
    assert.equal(normalized.topic, 'route');
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.state.story.answers.q_route.value, value);
    assert(Runtime.context(result.state).pendingQuestions.some(question => question.id === 'q_' + value));
  }
  assertAtomicFailure(state, '下一步。', await modeled(plan([answer('q_route', 'invented')]), state, '下一步。'), 'CHOICE_INVALID');
});

test('consent still requires explicit current permission and the pre-turn active consent question', async () => {
  const state = consentReady();
  for (const input of ['你好。', '如果我同意呢？', '他说我同意。', '你可以记住我，但要先问我。', '我不同意。']) {
    const normalized = await modeled(plan([answer('q_visitor', 'allow')], 'rain'), state, input);
    assert.equal(normalized.topic, 'visitor');
    assertAtomicFailure(state, input, normalized, 'CONSENT_REQUIRED');
  }
  for (const [input, value] of [['我同意留下引用。', 'allow'], ['不留下引用。', 'decline']]) {
    const normalized = await modeled(plan([answer('q_visitor', value)]), state, input);
    const result = commit(state, input, normalized);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.state.story.answers.q_visitor.value, value);
    assert.equal(result.state.events.at(-1).consentVersion, 2);
  }
  const pack = Packs.get('rain-lab'); pack.nodes.at(-1).requires = {};
  const inactive = Runtime.create(pack), input = '我同意留下引用。';
  assert.equal(Runtime.context(inactive).activeQuestionId, 'q_rain');
  const normalized = await modeled(plan([answer('q_visitor', 'allow')], 'rain'), inactive, input);
  assert.equal(normalized.topic, 'visitor');
  assertAtomicFailure(inactive, input, normalized, 'CONSENT_REQUIRED');
});

test('legacy v2 and v3 model topic behavior and direct canonical validation remain unchanged', async () => {
  const state = fresh(), input = '我想在窗边读书。';
  for (const topic of [null, 'making', 'purpose']) {
    for (const raw of [localPlan([answer()], topic), { schema: 'her-world-turn-v3', lines: [{ text: '读书。', operations: [answer()] }], topic }]) {
      const normalized = await modeled(raw, state, input);
      assert.equal(normalized.topic, topic);
      if (topic === 'purpose') assert.equal(commit(state, input, normalized).ok, true);
      else assertAtomicFailure(state, input, normalized, 'ANSWER_BOUNDARY');
    }
  }
  assertAtomicFailure(state, input, localPlan([answer()], null), 'ANSWER_BOUNDARY');
});

test('stale proposals cannot apply a routed answer after another turn or state change', async () => {
  const state = fresh(), input = '我想在窗边读书。', candidate = Runtime.propose(state, { text: input });
  const normalized = await modeled(plan([answer()], 'making'), state, input);
  const next = advance(state, [], null);
  const before = Runtime.serialize(next), rejected = Runtime.commitModel(next, candidate, normalized);
  assert.equal(rejected.error.code, 'STALE_PROPOSAL');
  assert.deepEqual(Runtime.serialize(next), before);
});

test('answer routing uses the immutable sent snapshot despite caller mutations while fetch is pending', async () => {
  const state = fresh(), input = '我想在窗边读书。', context = clone(Runtime.context(state));
  let respond, sent;
  const adapter = Model.create({ fetch: async (_url, options) => {
    sent = JSON.parse(JSON.parse(options.body).messages[1].content);
    return new Promise(resolve => { respond = resolve; });
  } });
  adapter.connect(key);
  try {
    const pending = adapter.request({ context, input });
    context.pendingQuestions[0].topic = 'making';
    context.pendingQuestions[0].id = 'q_forged';
    context.pendingQuestions[0].completion.type = 'ui';
    context.activeQuestionId = 'q_forged';
    context.topics = [{ id: 'making', title: 'changed' }];
    context.pack.rulesVersion = '2';
    respond(envelope(plan([answer()], 'making')));
    const normalized = await pending;
    assert.equal(sent.context.pendingQuestions[0].topic, 'purpose');
    assert.equal(sent.context.pack.rulesVersion, '4');
    assert.equal(normalized.topic, 'purpose');
    assert.equal(commit(state, input, normalized).ok, true);
  } finally { adapter.disconnect(); }
});

test('post-send additions cannot authorize a future question and cancellation returns no routed plan', async () => {
  const state = fresh(), context = clone(Runtime.context(state)), input = '留在这里。';
  let respond;
  const adapter = Model.create({ fetch: async () => new Promise(resolve => { respond = resolve; }) });
  adapter.connect(key);
  try {
    const pending = adapter.request({ context, input });
    context.pendingQuestions.push({ id: 'q_route', topic: 'route', completion: { type: 'answer' } });
    respond(envelope(plan([answer('q_route', 'stay')], 'making')));
    const normalized = await pending;
    assert.equal(normalized.topic, 'making');
    assertAtomicFailure(state, input, normalized, 'ANSWER_UNAVAILABLE');
    const controller = new AbortController();
    const cancelled = adapter.request({ context: Runtime.context(state), input, signal: controller.signal });
    controller.abort();
    respond(envelope(plan([answer()], 'making')));
    await assert.rejects(cancelled, error => error.code === 'cancelled');
    assert.deepEqual(state.story.completed, []);
    assert.equal(state.world.objects.length, 0);
  } finally { adapter.disconnect(); }
});

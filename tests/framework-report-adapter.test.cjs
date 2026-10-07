'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../framework/model.js');
const Runtime = require('../framework/runtime.js');
const Packs = require('../framework/packs.js');
const Caps = require('../framework/capabilities.js');
const key = 'MOCK_ONLY_REPORT_ADAPTER_KEY';
const fresh = () => Runtime.create(Packs.get('rain-lab'));
const report = (quote, more = {}) => ({ type: 'memory.upsert', id: 'note_rain', title: '偏好', perspective: 'player_report', support: { quote }, ...more });
const rows = (operations, text = '我记下这句话了。') => ({ schema: 'her-world-turn-v3', lines: [{ text, operations }], topic: null });
const v2 = operations => ({ schema: Caps.SCHEMA, lines: ['我记下这句话了。'], beats: [{ afterLine: 0, operations }], topic: null });
const commit = (state, input, plan) => Runtime.commit(state, Runtime.propose(state, { text: input }), plan);
async function adapt(raw, input, state = fresh(), inspectRequest, context = Runtime.context(state)) {
  const adapter = Model.create({ fetch: async (_url, options) => {
    inspectRequest?.(JSON.parse(options.body), context);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] }), { status: 200 });
  } });
  assert(adapter.connect(key));
  try { return await adapter.request({ context, input }); }
  finally { adapter.disconnect(); }
}
const rejectsRow = async (raw, input, state, code = 'TURN_ROW_OPERATIONS') => assert.rejects(adapt(raw, input, state), error => {
  assert.equal(error.code, 'format');
  assert.deepEqual(error.diagnostic, { stage: 'JSON', code, path: 'content', rowIndex: 0 });
  return true;
});

test('model schema owns report body locally while canonical validation still requires it', () => {
  const state = fresh(), context = Runtime.context(state);
  const descriptor = context.capabilities.find(item => item.id === 'memory.upsert');
  assert.equal(descriptor.schema.additionalProperties, false);
  assert.equal(descriptor.schema.properties.support.additionalProperties, false);
  assert.deepEqual(descriptor.schema.required, ['type', 'id', 'title']);
  assert.deepEqual(descriptor.schema.anyOf, [
    { required: ['perspective', 'support'], properties: { perspective: { const: 'player_report' }, body: false } },
    { required: ['body'], properties: { perspective: { type: 'string', enum: ['character_interpretation', 'shared_event'] } } }
  ]);
  assert(Object.isFrozen(descriptor.schema.anyOf[0].properties));
  assert.equal(Caps.validate(report('我喜欢雨')), false);
  assert.equal(Caps.validate(report('我喜欢雨', { body: '我喜欢雨' })), true);
  for (const version of ['2', '3']) {
    const legacy = Caps.descriptors(['memory.upsert'], version)[0].schema;
    assert(legacy.required.includes('body'));
    assert.equal(legacy.anyOf, undefined);
    assert.equal(legacy.properties.support, undefined);
  }
  const prompt = Model.buildRequest(context, '我喜欢雨').messages[0].content;
  assert(prompt.includes('player_report必须显式填写perspective和support，不输出body'));
  assert(prompt.includes('精确转述的结构例子'));
  assert(prompt.includes('本轮临时别名'));
  assert(prompt.includes('不能复用旧note_slug'));
  assert(prompt.includes('player_report不能省略support'));
});

test('bodyless reports derive exact current quotes with sentence timing, local sources and strict v2 replay', async () => {
  const state = fresh(), input = '🌧我喜欢小雨，也喜欢灯光', quote = '我喜欢小雨';
  const raw = { schema: 'her-world-turn-v3', lines: [
    { text: '我先听你说。', operations: [] },
    { text: '你的偏好记下了。', operations: [report(quote, { kind: 'preference' })] }
  ], topic: null };
  const before = structuredClone(raw);
  const plan = await adapt(raw, input, state);
  assert.deepEqual(raw, before);
  assert.equal(plan.schema, Caps.SCHEMA);
  assert.deepEqual(plan.beats, [{ afterLine: 1, operations: [{ ...raw.lines[1].operations[0], body: quote }] }]);
  assert(Object.isFrozen(plan.beats[0].operations[0]));
  const result = commit(state, input, plan);
  assert(result.ok, JSON.stringify(result.error));
  assert.equal(result.frames[0].memories.length, 0);
  assert.equal(result.frames[1].memories[0].body, quote);
  const memory = result.state.memories[0];
  assert.equal(memory.source.text, input);
  assert.equal(memory.currentRevision.text, input);
  assert.deepEqual(memory.support, { eventId: 'event_1', channel: 'player', start: 1, end: 6, quote });
  const saved = Runtime.serialize(result.state);
  assert.equal(saved.events[0].plan.schema, Caps.SCHEMA);
  assert.equal(saved.events[0].plan.beats[0].operations[0].body, quote);
  assert(!JSON.stringify(saved).includes('model-current-input'));
  assert.deepEqual(Runtime.restore(saved, state.pack).state, result.state);
});

test('Unicode offsets disambiguate repeated current quotes without UTF-16 coercion', async () => {
  const input = '🌧雨，雨', quote = '雨';
  await rejectsRow(rows([report(quote)]), input, undefined, 'REPORT_SUPPORT_AMBIGUOUS');
  for (const start of [1, 3]) {
    const plan = await adapt(rows([report(quote, { support: { quote, start, end: start + 1 } })]), input);
    const result = commit(fresh(), input, plan);
    assert(result.ok, JSON.stringify(result.error));
    assert.equal(result.state.memories[0].support.start, start);
  }
  for (const support of [
    { quote, start: 2, end: 3 }, { quote, start: 4, end: 5 },
    { quote: '🌧', start: 0, end: 2 }, { quote, start: 1, end: 1 },
    { quote, start: 3, end: 2 }, { quote: '雪' }
  ]) await rejectsRow(rows([report(quote, { support })]), input, undefined, 'REPORT_SUPPORT_INVALID');
  const emoji = await adapt(rows([report('🌧', { support: { quote: '🌧', start: 0, end: 1 } })]), input);
  assert.equal(emoji.beats[0].operations[0].body, '🌧');
  await rejectsRow(rows([report('aa')]), 'aaa', undefined, 'REPORT_SUPPORT_AMBIGUOUS');
});

test('missing source, malformed support and unsupported metadata never become canonical reports', async () => {
  const input = '我喜欢雨';
  const noSupport = report(input); delete noSupport.support;
  await rejectsRow(rows([noSupport]), input, undefined, 'REPORT_SUPPORT_REQUIRED');
  for (const support of [null, false, input, [], {}, { quote: '' }, { quote: '雨'.repeat(201) },
    { quote: input, start: 0 }, { quote: input, end: 4 },
    { quote: input, start: '0', end: 4 }, { quote: input, start: 0, end: 4.5 },
    { quote: input, start: null, end: null }, { quote: input, start: -1, end: 4 },
    { quote: input, start: 0, end: 201 }, { quote: input, eventId: 'event_99' }
  ]) await rejectsRow(rows([report(input, { support })]), input);
  for (const quote of [' ' + input, input + '\n']) await rejectsRow(rows([report(quote)]), input, undefined, 'REPORT_SUPPORT_INVALID');
  for (const fields of [
    { id: 'memory_0' }, { title: 3 }, { title: '雨'.repeat(61) },
    { kind: 'invented_kind' }, { generation: 2 }, { source: { text: input } },
    { dependencies: [] }, { eventSupport: {} }, { input },
    { evidence: 7 }, { evidence: '' }, { evidence: '雨'.repeat(201) }
  ]) await rejectsRow(rows([report(input, fields)]), input);
});

test('a supplied body is never replaced, including wrong, malformed and oversized bodies', async () => {
  const state = fresh(), input = '我不喜欢雨', before = Runtime.serialize(state);
  for (const body of ['玩家喜欢雨', '我喜欢雨', '', null, 7, { quote: input }, '雨'.repeat(241)]) {
    const operation = report(input, { body });
    const plan = await adapt(rows([operation]), input, state);
    assert.deepEqual(plan.beats[0].operations[0], operation);
    const result = commit(state, input, plan);
    assert.equal(result.ok, false);
    if (body === '玩家喜欢雨' || body === '我喜欢雨') assert.equal(result.error.code, 'MEMORY_CLAIM_INVALID');
    assert.deepEqual(Runtime.serialize(state), before);
  }
  const valid = report(input, { body: input });
  assert(commit(state, input, await adapt(rows([valid]), input, state)).ok);
  const noSupport = { ...valid }; delete noSupport.support;
  assert(commit(state, input, await adapt(rows([noSupport]), input, state)).ok);
  const mismatch = { ...noSupport, body: '我喜欢雨' };
  assert.equal(commit(state, input, await adapt(rows([mismatch]), input, state)).error.code, 'MEMORY_CLAIM_INVALID');
});

test('raw secret and thought scans precede body derivation and legacy echo removal', async () => {
  const input = '我喜欢雨';
  for (const unsafe of [key, '<think>PRIVATE_THOUGHT</think>', '{"analysis":"PRIVATE_THOUGHT"}']) {
    for (const operation of [report(input, { body: unsafe }), report(input, { evidence: unsafe }), report(unsafe)]) {
      await assert.rejects(adapt(rows([operation]), input), error => {
        assert.equal(error.diagnostic.code, 'OUTPUT_UNSAFE');
        assert(!error.message.includes(key));
        assert(!error.message.includes('PRIVATE_THOUGHT'));
        return true;
      });
    }
  }
  const withEcho = report(input, { evidence: '非权威的旧格式说明' });
  const plan = await adapt(rows([withEcho]), input);
  assert.equal(plan.beats[0].operations[0].body, input);
  assert(!Object.hasOwn(plan.beats[0].operations[0], 'evidence'));
});

test('body derivation is limited to v3 explicit player reports and rules4 requests', async () => {
  const state = fresh(), input = '我喜欢雨';
  const legacy = v2([report(input)]);
  const unadapted = await adapt(legacy, input, state);
  assert.deepEqual(unadapted, legacy);
  assert.equal(commit(state, input, unadapted).error.code, 'OPERATION_INVALID');
  const explicit = v2([report(input, { body: input })]);
  assert.deepEqual(await adapt(explicit, input, state), explicit);
  const accepted = commit(state, input, explicit);
  assert(accepted.ok);
  const saved = structuredClone(Runtime.serialize(accepted.state));
  delete saved.events[0].plan.beats[0].operations[0].body;
  assert.equal(Runtime.restore(saved, state.pack).ok, false);
  for (const perspective of [undefined, 'character_interpretation', 'shared_event', null, 7]) {
    const operation = report(input, { perspective });
    if (perspective === undefined) delete operation.perspective;
    const plan = await adapt(rows([operation]), input, state);
    assert.deepEqual(plan.beats[0].operations[0], operation);
    assert.equal(commit(state, input, plan).ok, false);
  }
  const operation = { type: 'memory.upsert', id: 'note_rain', title: '理解', body: '她认为雨对玩家很重要' };
  const plan = await adapt(rows([operation]), input, state);
  assert.deepEqual(plan.beats[0].operations[0], operation);
  assert(commit(state, input, plan).ok);
});

test('only the locally captured current input supports the new body', async () => {
  const original = '我喜欢雨', changed = '我喜欢雪';
  let state = fresh();
  state = commit(state, original, v2([report(original, { body: original })])).state;
  await rejectsRow(rows([report(original, { id: 'note_old' })]), changed, state, 'REPORT_SUPPORT_INVALID');
  const raw = rows([report(changed)]);
  const context = structuredClone(Runtime.context(state));
  const plan = await adapt(raw, changed, state, (request, suppliedContext) => {
    assert.equal(JSON.parse(request.messages[1].content).playerSaid, changed);
    suppliedContext.pack.rulesVersion = '3';
  }, context);
  assert.equal(plan.beats[0].operations[0].body, changed);
  const legacyContext = structuredClone(Runtime.context(state));
  legacyContext.pack.rulesVersion = '3';
  const legacy = await adapt(raw, changed, state, (_request, suppliedContext) => {
    suppliedContext.pack.rulesVersion = '4';
  }, legacyContext);
  assert(!Object.hasOwn(legacy.beats[0].operations[0], 'body'), 'later context mutation cannot authorize rules4 derivation');
});

test('mixed creation and memory turns remain atomic and shared events keep their own proof', async () => {
  const state = fresh(), input = '放一盏灯。我喜欢雨', quote = '我喜欢雨';
  const create = { type: 'world.create', object: { label: '小灯', glyphs: '*', x: 4, y: 20, scale: 1 } };
  const shared = { type: 'memory.upsert', id: 'note_event', title: '经历', perspective: 'shared_event', body: '一起创建了世界中的「小灯」' };
  const valid = await adapt(rows([create, report(quote), shared]), input, state);
  const result = commit(state, input, valid);
  assert(result.ok, JSON.stringify(result.error));
  assert.equal(result.state.world.objects.length, 1);
  assert.equal(result.state.memories.length, 2);
  assert.deepEqual(valid.beats[0].operations[2], shared);
  assert.deepEqual(Runtime.restore(Runtime.serialize(result.state), state.pack).state, result.state);
  const before = Runtime.serialize(state);
  for (const suffix of [report(quote, { body: '我喜欢雪' }), { ...shared, body: '一起去了海边' }, { type: 'world.remove', target: 'obj_missing' }]) {
    const plan = await adapt(rows([create, report(quote), suffix]), input, state);
    assert.equal(commit(state, input, plan).ok, false);
    assert.deepEqual(Runtime.serialize(state), before);
  }
  await rejectsRow(rows([create, report('我喜欢雪')]), input, state, 'REPORT_SUPPORT_INVALID');
  assert.deepEqual(Runtime.serialize(state), before);
});

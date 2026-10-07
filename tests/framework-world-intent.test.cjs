'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../framework/model.js');
const Runtime = require('../framework/runtime.js');
const Packs = require('../framework/packs.js');
const Caps = require('../framework/capabilities.js');
const key = 'MOCK_ONLY_WORLD_INTENT_KEY';
const fresh = () => Runtime.create(Packs.get('rain-lab'));
const row = (operations = [], mode = 'discussion', text = '我听到了。') => ({ text, mode, operations });
const grant = (domain, quote, more = {}) => ({ domain, support: { quote, ...more } });
const v4 = (lines, requestedChanges = []) => ({ schema: 'her-world-turn-v4', requestedChanges, lines, topic: null });
const v3 = operations => ({ schema: 'her-world-turn-v3', lines: [{ text: '我听到了。', operations }], topic: null });
const v2 = operations => ({ schema: Caps.SCHEMA, lines: ['我听到了。'], beats: operations.length ? [{ afterLine: 0, operations }] : [], topic: null });
const cloud = () => ({ type: 'world.create', object: { label: '云', glyphs: '(__)', scale: 1 }, placement: { anchor: 'sky' } });
const weather = () => ({ type: 'weather.set', changes: { intensity: 1, paused: false } });
const report = (id, quote) => ({ type: 'memory.upsert', id, title: '声音偏好', kind: 'preference', perspective: 'player_report', support: { quote } });
const commit = (state, input, plan, method = Runtime.commitModel) => method(state, Runtime.propose(state, { text: input }), plan);
const succeeded = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result; };
async function adapt(raw, input, state = fresh(), inspect) {
  let calls = 0;
  const adapter = Model.create({ fetch: async (_url, options) => {
    calls++;
    inspect?.(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] }), { status: 200 });
  } });
  assert(adapter.connect(key));
  try { return await adapter.request({ context: Runtime.context(state), input }); }
  finally { assert.equal(calls, 1, 'intent classification must use the original single model call'); adapter.disconnect(); }
}
async function rejected(raw, input, code, rowIndex, state) {
  await assert.rejects(adapt(raw, input, state), error => {
    assert.equal(error.code, 'format');
    assert.equal(error.httpStatus, 200);
    assert.equal(error.diagnostic.code, code);
    assert.equal(error.diagnostic.rowIndex, rowIndex);
    assert.deepEqual(Object.keys(error.diagnostic).sort(), (rowIndex === undefined ? ['stage', 'code', 'path'] : ['stage', 'code', 'path', 'rowIndex']).sort());
    assert.equal(error.diagnostic.stage, 'JSON');
    assert(!error.message.includes(key));
    assert(!error.message.includes(input));
    return true;
  });
}
function withPreference() {
  const input = '我更喜欢风声。', operation = { ...report('note_sound', input), body: input };
  return succeeded(commit(fresh(), input, v2([operation]), Runtime.commit)).state;
}
const correction = '刚才我说风声，其实现在更喜欢雨落在叶子上的声音。把这个偏好改一下。';
const correctedQuote = '现在更喜欢雨落在叶子上的声音';

test('primary prompt declares the minimal current-request contract and semantic counterexamples', () => {
  const request = Model.buildRequest(Runtime.context(fresh()), correction), prompt = request.messages[0].content;
  assert(prompt.includes('her-world-turn-v4'));
  assert(!prompt.includes('her-world-turn-v3'));
  for (const phrase of ['requestedChanges', 'apply_now', 'discussion', correction, '也把眼前的雨调小一点，别暂停。', '我喜欢云', '她说把云拿走', '下次再放一朵云', '来源匹配只证明原文存在', 'world.annotate']) assert(prompt.includes(phrase), phrase);
  assert.equal(request.messages.length, 2);
  assert.equal(request.model, 'glm-5.3-flash');
  assert.equal(request.max_tokens, 2048);
  assert.equal(request.reasoning_effort, 'low');
  assert.equal(request.stream, false);
  assert.equal(JSON.parse(request.messages[1].content).playerSaid, correction);
});

test('a correction-only v4 report revises the existing opaque handle without changing weather', async () => {
  const state = withPreference(), handle = Runtime.context(state).memories[0].id;
  const raw = v4([row([report(handle, correctedQuote)], 'discussion', '声音的偏好已经改好了。')]);
  const before = structuredClone(raw), plan = await adapt(raw, correction, state);
  const result = succeeded(commit(state, correction, plan));
  assert.deepEqual(raw, before);
  assert.equal(result.state.memories.length, 1);
  assert.equal(result.state.memories[0].id, state.memories[0].id);
  assert.equal(result.state.memories[0].body, correctedQuote);
  assert.equal(result.state.memories[0].currentRevision.number, 2);
  assert.deepEqual(result.state.world, state.world);
  assert.deepEqual(result.state.story, state.story);
  assert.deepEqual(result.state.memories[0].source, state.memories[0].source);
});

test('a correction-only response with unsolicited weather fails before any memory or world commit', async () => {
  const state = withPreference(), before = Runtime.serialize(state), handle = Runtime.context(state).memories[0].id;
  for (const mode of ['discussion', 'apply_now']) {
    const raw = v4([row([report(handle, correctedQuote)], 'discussion'), row([weather()], mode, '以后会让雨轻轻落下。')]);
    await rejected(raw, correction, 'WORLD_INTENT_REQUIRED', 1, state);
    assert.deepEqual(Runtime.serialize(state), before);
  }
});

test('a separate current weather request permits its timed operation alongside the memory correction', async () => {
  const state = withPreference(), request = '也把眼前的雨调小一点，别暂停。', input = correction + request;
  const raw = v4([
    row([report(Runtime.context(state).memories[0].id, correctedQuote)], 'discussion', '你的偏好改好了。'),
    row([weather()], 'apply_now', '眼前是轻轻落下的雨。')
  ], [grant('weather', request)]);
  const plan = await adapt(raw, input, state), result = succeeded(commit(state, input, plan));
  assert.equal(plan.schema, Caps.SCHEMA);
  assert.deepEqual(Object.keys(plan).sort(), ['schema', 'lines', 'beats', 'topic'].sort());
  assert.deepEqual(plan.beats.map(beat => beat.afterLine), [0, 1]);
  assert.deepEqual(result.frames[0].world.weather, state.world.weather);
  assert.equal(result.frames[1].world.weather.intensity, 1);
  assert.equal(result.frames[1].world.weather.paused, false);
  assert.equal(result.state.memories.length, 1);
  const saved = Runtime.serialize(result.state);
  assert.equal(saved.events.at(-1).plan.schema, Caps.SCHEMA);
  assert(!JSON.stringify(saved).includes('requestedChanges'));
  assert(!JSON.stringify(saved).includes('model-current-input'));
  assert(Object.isFrozen(plan.beats[1].operations[0]));
  assert.deepEqual(Runtime.restore(saved, state.pack).state, result.state);
});

test('scene and weather scopes are independent and both domains can coexist', async () => {
  const input = '在天上放一朵云，再把雨调小。';
  await rejected(v4([row([cloud()], 'apply_now')], [grant('weather', '把雨调小')]), input, 'WORLD_INTENT_REQUIRED', 0);
  await rejected(v4([row([weather()], 'apply_now')], [grant('scene', '在天上放一朵云')]), input, 'WORLD_INTENT_REQUIRED', 0);
  const plan = await adapt(v4([row([cloud(), weather()], 'apply_now')], [grant('scene', '在天上放一朵云'), grant('weather', '把雨调小')]), input);
  const result = succeeded(commit(fresh(), input, plan));
  assert.equal(result.state.world.objects.length, 1);
  assert.equal(result.state.world.weather.intensity, 1);
});

test('a single scene request can cover ordered create, update and remove operations', async () => {
  const input = '先放一朵云，移到右边，再收起来。';
  const operations = [cloud(), { type: 'world.update', target: 'obj_1', changes: { x: 25 } }, { type: 'world.remove', target: 'obj_1' }];
  const plan = await adapt(v4(operations.map(operation => row([operation], 'apply_now')), [grant('scene', input)]), input);
  const result = succeeded(commit(fresh(), input, plan));
  assert.equal(result.frames[0].world.objects.length, 1);
  assert.equal(result.frames[1].world.objects[0].x, 25);
  assert.equal(result.frames[2].world.objects.length, 0);
});

test('discussion timing cannot execute physical operations even with a current source grant', async () => {
  const input = '以后再放云，也可以下点雨。';
  for (const [domain, operations] of [['scene', [cloud()]], ['scene', [{ type: 'world.update', target: 'obj_1', changes: { x: 15 } }]], ['scene', [{ type: 'world.remove', target: 'obj_1' }]], ['weather', [weather()]]]) {
    await rejected(v4([row([], 'discussion'), row(operations, 'discussion', '下次可以试试。')], [grant(domain, input)]), input, 'WORLD_INTENT_DISCUSSION', 1);
  }
});

test('ordinary paraphrases need no lexical command token and unused current grants need not cause extra actions', async () => {
  const input = '少来点儿，像刚才那样就好。';
  const accepted = await adapt(v4([row([weather()], 'apply_now')], [grant('weather', input)]), input);
  assert.equal(accepted.beats[0].operations[0].type, 'weather.set');
  for (const mode of ['discussion', 'apply_now']) {
    const deferred = await adapt(v4([row([], mode, '已经是这样了。')], [grant('weather', input)]), input);
    assert.deepEqual(deferred.beats, []);
  }
  for (const discussion of ['我喜欢云。', '她说把云拿走。', '要是有一朵云就好了。', '下次再放一朵云。']) {
    assert.deepEqual((await adapt(v4([row()]), discussion)).beats, []);
  }
});

test('world meanings and character state retain narrative semantics without physical grants', async () => {
  const input = '让这朵云代表等待。', seeded = succeeded(commit(fresh(), '放一朵云。', v2([cloud()]), Runtime.commit)).state;
  const annotate = { type: 'world.annotate', target: 'obj_1', field: 'meaning', value: '等待' };
  const character = { type: 'character.update', changes: { mood: '安静' } };
  for (const raw of [v4([row([annotate, character])]), v3([annotate, character]), v2([annotate, character])]) {
    const plan = await adapt(raw, input, seeded), result = succeeded(commit(seeded, input, plan));
    assert.equal(result.state.world.annotations.obj_1.meaning, '等待');
    assert.deepEqual(result.state.world.objects, seeded.world.objects);
    assert.deepEqual(result.state.world.weather, seeded.world.weather);
  }
});

test('legacy model v2 and v3 cannot bypass physical intent while saved canonical world plans still replay', async () => {
  const input = '放云、移动云、收起云、改变天气。';
  const operations = [cloud(), { type: 'world.update', target: 'obj_1', changes: { x: 15 } }, { type: 'world.remove', target: 'obj_1' }, weather()];
  for (const operation of operations) {
    await rejected(v2([operation]), input, 'WORLD_INTENT_REQUIRED');
    await rejected(v3([operation]), input, 'WORLD_INTENT_REQUIRED', 0);
  }
  const malformed = v2([weather()]); malformed.beats[0].afterLine = -1;
  await rejected(malformed, input, 'WORLD_INTENT_REQUIRED');
  const state = fresh(), result = succeeded(commit(state, input, v2([cloud(), weather()]), Runtime.commit));
  assert.deepEqual(Runtime.restore(Runtime.serialize(result.state), state.pack).state, result.state);
  for (const raw of [v2([]), v3([])]) assert.deepEqual((await adapt(raw, '你好。')).beats, []);
  const quote = '我喜欢雨。', reportPlan = await adapt(v3([report('note_rain', quote)]), quote);
  assert.equal(reportPlan.beats[0].operations[0].body, quote);
});

test('current source selectors reject historical quotes, normalization, forged channels and malformed spans', async () => {
  const input = '现在把雨停下。';
  for (const support of [{ quote: '以前放一朵云' }, { quote: '把雨停下 ' }, { quote: '' }, null, {}, { quote: input, start: 0 }, { quote: input, end: 7 }, { quote: input, start: '0', end: 7 }, { quote: input, start: 0, end: 7.5 }, { quote: input, start: 0, end: 201 }, { quote: input, start: null, end: null }, { quote: input, start: 0, end: null }, { quote: input, start: null, end: [...input].length }, { quote: input, start: false, end: [...input].length }, { quote: input, start: 0, end: true }, { quote: input, eventId: 'event_1' }, { quote: input, channel: 'player' }]) {
    await rejected(v4([row([weather()], 'apply_now')], [{ domain: 'weather', support }]), input, 'WORLD_INTENT_SUPPORT_INVALID');
  }
});

test('Unicode code-point spans disambiguate exact current requests without UTF-16 coercion', async () => {
  const input = '🌧停雨，再停雨';
  await rejected(v4([row([weather()], 'apply_now')], [grant('weather', '停雨')]), input, 'WORLD_INTENT_SUPPORT_AMBIGUOUS');
  for (const start of [1, 5]) {
    const plan = await adapt(v4([row([weather()], 'apply_now')], [grant('weather', '停雨', { start, end: start + 2 })]), input);
    assert.equal(plan.beats.length, 1);
  }
  await rejected(v4([row([weather()], 'apply_now')], [grant('weather', '停雨', { start: 2, end: 4 })]), input, 'WORLD_INTENT_SUPPORT_INVALID');
  await rejected(v4([row([weather()], 'apply_now')], [grant('weather', 'aa')]), 'aaa', 'WORLD_INTENT_SUPPORT_AMBIGUOUS');
});

test('requestedChanges is a closed bounded domain list with required exact source selectors', async () => {
  const input = '停雨，放云。', good = grant('weather', input);
  for (const requestedChanges of [null, {}, 'weather', [good, good], [good, grant('scene', input), good], [{ domain: 'memory', support: { quote: input } }], [{ domain: 'weather' }], [{ ...good, fields: ['paused'] }], [{ ...good, request: input }]]) {
    await rejected(v4([row()], requestedChanges), input, 'WORLD_INTENT_INVALID');
  }
  const missing = v4([row()]); delete missing.requestedChanges;
  await rejected(missing, input, 'TURN_ROOT_FIELDS');
});

test('v4 row timing, cardinality, Unicode text and total operation bounds remain strict', async () => {
  const input = '你好。';
  await rejected(v4([row([], 'future')]), input, 'TURN_ROW_MODE', 0);
  const missing = row(); delete missing.mode;
  await rejected(v4([missing]), input, 'TURN_ROW_FIELDS', 0);
  await rejected(v4([{ ...row(), afterLine: 0 }]), input, 'TURN_ROW_FIELDS', 0);
  await rejected(v4([row([], 'discussion', '🌧'.repeat(501))]), input, 'TURN_ROW_TEXT', 0);
  for (const length of [0, 5]) await rejected(v4(Array.from({ length }, () => row())), input, 'TURN_LINES_INVALID');
  const note = { type: 'log.note', text: '安静地听着。' };
  const max = await adapt(v4([row(Array.from({ length: 12 }, () => note), 'discussion', '🌧'.repeat(500))]), input);
  assert.equal(max.beats[0].operations.length, 12);
  await rejected(v4([row(Array.from({ length: 6 }, () => note)), row(Array.from({ length: 7 }, () => note))]), input, 'TURN_OPERATION_LIMIT', 1);
});

test('raw grant metadata receives secret and thought screening before it can be removed', async () => {
  const input = '停雨。';
  for (const quote of [key, '<think>PRIVATE_WORLD_INTENT</think>', '{"analysis":"PRIVATE_WORLD_INTENT"}', '{"requestedChanges":[]}']) {
    await rejected(v4([row()], [grant('weather', quote)]), input, 'OUTPUT_UNSAFE');
  }
  const raw = v4([row()], [{ ...grant('weather', input), [key]: 'hidden' }]);
  await rejected(raw, input, 'OUTPUT_UNSAFE');
  for (const extra of [{ analysis: 'PRIVATE_WORLD_INTENT' }, { debug: 'PRIVATE_WORLD_INTENT' }]) {
    await rejected(v4([row()], [{ ...grant('weather', input), ...extra }]), input, 'OUTPUT_UNSAFE');
  }
});

test('an accepted intent never drops malformed operations or weakens atomic runtime validation', async () => {
  const state = fresh(), before = Runtime.serialize(state), input = '放一朵云。';
  for (const suffix of [{ type: 'unknown.capability' }, { type: 'world.remove', target: 'obj_missing' }, { ...weather(), unexpected: true }]) {
    const plan = await adapt(v4([row([cloud(), suffix], 'apply_now')], [grant('scene', input), grant('weather', input)]), input, state);
    assert.equal(plan.beats[0].operations.length, 2);
    assert.equal(commit(state, input, plan).ok, false);
    assert.deepEqual(Runtime.serialize(state), before);
  }
});

test('intent diagnostics never reflect source text or unchecked row positions', () => {
  for (const rowIndex of [-1, 4, '0', Infinity, key]) {
    const error = new Model.SafeError('format', 200, { stage: 'JSON', path: 'content', code: 'WORLD_INTENT_REQUIRED', rowIndex });
    assert.equal(error.diagnostic.rowIndex, undefined);
    assert(!JSON.stringify(error).includes(key));
  }
  const error = new Model.SafeError('format', 200, { stage: 'JSON', path: key, code: key, rowIndex: 0, quote: key });
  assert.deepEqual(error.diagnostic, { stage: 'JSON' });
});

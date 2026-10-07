'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../framework/model.js');
const E = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const C = require('../framework/capabilities.js');
const key = 'MOCK_ONLY_SENTENCE_ADAPTER_KEY';
const fresh = () => E.create(P.get('rain-lab'));
const rowPlan = (lines, topic = null) => ({ schema: 'her-world-turn-v3', lines, topic });
const oldPlan = (beats, lines = ['第一句。', '第二句。']) => ({ schema: 'her-world-turn-v2', lines, beats, topic: null });
const cloud = extra => ({ type: 'world.create', object: { label: '云', glyphs: '(__)', scale: 2 }, placement: { anchor: 'sky' }, ...extra });
async function proposal(raw, state = fresh(), input = '在天上加两朵云。') {
  const adapter = M.create({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] }), { status: 200 }) });
  adapter.connect(key);
  try { return await adapter.request({ context: E.context(state), input }); }
  finally { adapter.disconnect(); }
}
const commit = (state, plan, input) => E.commit(state, E.propose(state, { text: input }), plan);

test('production prompt uses sentence-owned operations and advertised schemas omit redundant evidence', () => {
  const state = fresh(), request = M.buildRequest(E.context(state), '你好');
  assert.match(request.messages[0].content, /her-world-turn-v3/);
  assert.match(request.messages[0].content, /"text":"对白","operations":\[\]/);
  assert.match(request.messages[0].content, /不要输出evidence/);
  for (const item of E.context(state).capabilities) assert(!Object.hasOwn(item.schema.properties, 'evidence'));
  assert(C.validate({ ...cloud(), evidence: '完整历史输入' }), 'strict local legacy evidence remains accepted by its saved-plan schema');
});

test('two sentence rows convert to strict v2 with exact reveal timing, local sources and replay', async () => {
  const state = fresh(), input = '在天上加两朵云。';
  const raw = rowPlan([{ text: '我先看一看天空。', operations: [] }, { text: '两朵云已经放好了。', operations: [cloud(), cloud()] }]);
  const before = JSON.stringify(raw), normalized = await proposal(raw, state, input), result = commit(state, normalized, input);
  assert(result.ok, JSON.stringify(result.error));assert.equal(JSON.stringify(raw), before);
  assert.equal(normalized.schema, 'her-world-turn-v2');assert.deepEqual(normalized.beats.map(beat => beat.afterLine), [1]);
  assert.equal(result.frames[0].world.objects.length, 0);assert.equal(result.frames[1].world.objects.length, 2);
  assert.notEqual(result.state.world.objects[0].x, result.state.world.objects[1].x);
  for (const object of result.state.world.objects) assert.equal(object.source.createdBy, input);
  assert.equal(result.state.events[0].plan.schema, 'her-world-turn-v2');assert.deepEqual(result.state.story.completed, []);
  assert.deepEqual(E.restore(E.serialize(result.state), state.pack).state, result.state);
});

test('bounded optional legacy evidence is discarded without weakening current memory support or consent', async () => {
  const input = '先不讲雨。我更喜欢风声。', state = fresh();
  for (const evidence of ['我更喜欢风声', '模型的非权威解释', input]) {
    const raw = rowPlan([{ text: '这条偏好记下了。', operations: [{ type: 'memory.upsert', id: 'note_wind', title: '风声', body: '我更喜欢风声。', perspective: 'player_report', support: { quote: '我更喜欢风声。' }, evidence }] }]);
    const plan = await proposal(raw, state, input);assert(!Object.hasOwn(plan.beats[0].operations[0], 'evidence'));
    const result = commit(state, plan, input);assert(result.ok, JSON.stringify(result.error));assert.equal(result.state.memories[0].source.text, input);
    const wrong = structuredClone(plan);wrong.beats[0].operations[0].support.quote = '我更喜欢雨声。';
    assert.equal(commit(state, wrong, input).error.code, 'MEMORY_SUPPORT_INVALID');
  }
});

test('raw secret and thought checks run before evidence removal or row conversion', async () => {
  for (const evidence of [key, '<think>PRIVATE_THOUGHT</think>', '{"analysis":"PRIVATE"}']) {
    await assert.rejects(proposal(rowPlan([{ text: '云来了。', operations: [cloud({ evidence })] }])), error => {
      assert.equal(error.diagnostic.code, 'OUTPUT_UNSAFE');assert(!error.message.includes(key));assert(!error.message.includes('PRIVATE'));return true;
    });
  }
});

test('malformed echoes and fields on operations that never had evidence are not silently dropped', async () => {
  const state = fresh(), input = '开世界面板。';
  for (const evidence of ['', 'x'.repeat(201), { quote: input }, 1, null]) {
    const plan = await proposal(rowPlan([{ text: '云来了。', operations: [cloud({ evidence })] }]), state, input);
    assert.equal(commit(state, plan, input).ok, false);
  }
  const panel = await proposal(rowPlan([{ text: '看一看。', operations: [{ type: 'panel.open', panel: 'world', evidence: input }] }]), state, input);
  assert.equal(commit(state, panel, input).error.code, 'OPERATION_INVALID');
});

test('legacy explicit timing is stably grouped while equal-line operation order remains exact', async () => {
  const state = fresh(), input = '先造云，再移动并赋予含义。';
  const raw = oldPlan([{ afterLine: 1, operations: [{ type: 'world.update', target: 'obj_1', changes: { x: 15 } }] }, { afterLine: 0, operations: [cloud()] }, { afterLine: 1, operations: [{ type: 'world.annotate', target: 'obj_1', field: 'meaning', value: '一段停留' }] }]);
  const normalized = await proposal(raw, state, input);assert.deepEqual(normalized.beats.map(beat => beat.afterLine), [0, 1]);
  assert.deepEqual(normalized.beats[1].operations.map(op => op.type), ['world.update', 'world.annotate']);
  const result = commit(state, normalized, input);assert(result.ok, JSON.stringify(result.error));assert.equal(result.frames[0].world.objects.length, 1);
  assert.equal(result.state.world.objects[0].x, 15);assert.deepEqual(E.restore(E.serialize(result.state), state.pack).state, result.state);
});

test('invalid legacy timing is rejected without shifting indices or moving operations to satisfy targets', async () => {
  const state = fresh(), input = '放一朵云。';
  for (const afterLine of [1, -1, 4, '0', null, undefined]) {
    const beat = { afterLine, operations: [cloud()] };if (afterLine === undefined) delete beat.afterLine;
    const plan = await proposal(oldPlan([beat], ['一朵云。']), state, input);
    assert.equal(commit(state, plan, input).error.code, 'BEATS_INVALID');
  }
  const wrongOrder = await proposal(oldPlan([{ afterLine: 0, operations: [{ type: 'world.update', target: 'obj_1', changes: { x: 1 } }] }, { afterLine: 1, operations: [cloud()] }]), state, input);
  assert.equal(commit(state, wrongOrder, input).error.code, 'TARGET_MISSING');assert.equal(state.world.objects.length, 0);
});

test('mixed row/beat protocols, extra row keys, malformed rows and overflow reject before any commit', async () => {
  const cases = [
    { ...rowPlan([{ text: '好。', operations: [] }]), beats: [] },
    rowPlan(['字符串不能冒充句子对象']), rowPlan([{ text: '好。' }]),
    rowPlan([{ text: '好。', operations: [], afterLine: 0 }]), rowPlan([{ text: '', operations: [] }]),
    rowPlan([{ text: 'x'.repeat(501), operations: [] }]), rowPlan([{ text: '好。', operations: {} }]),
    rowPlan(Array.from({ length: 5 }, () => ({ text: '好。', operations: [] }))),
    rowPlan([{ text: '好。', operations: Array.from({ length: 13 }, () => cloud()) }])
  ];
  for (const raw of cases) await assert.rejects(proposal(raw), error => error.code === 'format');
});

test('invalid suffix, unknown operations and forged consent still roll the entire converted turn back', async () => {
  const state = fresh(), input = '没有同意任何事。', before = E.serialize(state);
  for (const op of [{ type: 'world.remove', target: 'obj_missing' }, { type: 'unknown.capability', evidence: input }, { type: 'story.answer', questionId: 'q_visitor', value: 'allow' }]) {
    const plan = await proposal(rowPlan([{ text: '一朵云。', operations: [cloud()] }, { text: '下一步。', operations: [op] }], 'visitor'), state, input);
    assert.equal(commit(state, plan, input).ok, false);assert.deepEqual(E.serialize(state), before);
  }
});

test('row diagnostics expose only fixed reasons and the actual bounded row position', async () => {
  for (const [row, code] of [[{text:'好。'},'TURN_ROW_FIELDS'],[{text:'',operations:[]},'TURN_ROW_TEXT'],[{text:'好。',operations:{}},'TURN_ROW_OPERATIONS'],[{text:'好。',operations:Array.from({length:13},()=>cloud())},'TURN_OPERATION_LIMIT']]) {
    await assert.rejects(proposal(rowPlan([{text:'第一句。',operations:[]},row])), error => {assert.deepEqual(error.diagnostic,{stage:'JSON',code,path:'content',rowIndex:1});return true;});
  }
  for (const rowIndex of ['1',-1,4,Infinity,key]) {
    const error=new M.SafeError('format',200,{stage:'JSON',code:'TURN_ROW_FIELDS',path:'content',rowIndex});assert.equal(error.diagnostic.rowIndex,undefined);assert(!error.message.includes(key));
  }
  assert.equal(new M.SafeError('format',200,{stage:'JSON',code:'ROOT_INVALID',path:'content',rowIndex:1}).diagnostic.rowIndex,undefined);
});

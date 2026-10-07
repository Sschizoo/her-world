const test = require('node:test');
const assert = require('node:assert/strict');
const Caps = require('../framework/capabilities.js');
const Model = require('../framework/model.js');
const Runtime = require('../framework/runtime.js');
const Packs = require('../framework/packs.js');

const note = extra => ({ type: 'memory.upsert', id: 'note_concept', title: '一起理解', body: '角色的当前理解', ...extra });
const plan = (operations, lines = ['我听懂了。']) => ({ schema: 'her-world-turn-v2', lines, beats: operations.length ? [{ afterLine: lines.length - 1, operations }] : [], topic: null });
const fresh = () => Runtime.create(Packs.get('rain-lab'));
async function modeledTurn(state, input, operations, lines) {
  const supplied = plan(operations, lines);
  let request;
  const model = Model.create({ fetch: async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(supplied) }, finish_reason: 'stop' }] }));
  } });
  assert(model.connect('MOCK_ACTIVE_MEMORY_PASSWORD'));
  const actual = await model.request({ context: Runtime.context(state), input });
  assert.deepEqual(actual, supplied, 'the adapter must not repair or invent memory metadata');
  const result = Runtime.commit(state, Runtime.propose(state, { text: input }), actual);
  return { result, request };
}

test('rules4 memory schemas accept bounded optional metadata and exact quote-only support', () => {
  assert.equal(Caps.RULES_VERSION, '4');
  assert.equal(Caps.validate(note()), true);
  for (const kind of ['concept', 'preference', 'experience', 'promise', 'note']) {
    for (const perspective of ['player_report', 'character_interpretation', 'shared_event']) {
      assert.equal(Caps.validate(note({ kind, perspective, support: { quote: '🌧我喜欢雨' } })), true);
    }
  }
  assert.equal(Caps.validate(note({ support: { quote: '🌧', start: 0, end: 1 } })), true);
  assert.equal(Caps.validate(note({ support: { quote: '雨', start: 199, end: 200 } })), true);
  for (const id of ['memory_1', 'memory_14', 'memory_12014', 'memory_99999']) {
    assert.equal(Caps.validate(note({ id })), true);
    assert.equal(Caps.validate({ type: 'memory.remove', id }), true);
    assert.equal(Caps.validate({ type: 'memory.remove', id, support: { quote: '忘掉雨声' } }), true);
  }
  const descriptor = Caps.descriptors(['memory.upsert'])[0];
  assert.equal(descriptor.schema.additionalProperties, false);
  assert.equal(descriptor.schema.properties.support.additionalProperties, false);
  assert(Object.isFrozen(descriptor.schema.properties.support));
});

test('memory schemas reject fabricated provenance, unbounded metadata and partial spans', () => {
  const invalid = [
    { kind: 'diagnosis' }, { perspective: 'objective_fact' }, { support: {} },
    { support: { quote: '' } }, { support: { quote: '🌧'.repeat(201) } },
    { support: { quote: '雨', start: 0 } }, { support: { quote: '雨', end: 1 } },
    { support: { quote: '雨', start: -1, end: 1 } }, { support: { quote: '雨', start: 0.5, end: 1 } },
    { support: { quote: '雨', start: 0, end: 201 } },
    { support: { quote: '雨', eventId: 'event_1' } },
    { source: { eventId: 'event_1', text: 'fabricated' } }, { generation: 2 },
    { currentRevision: { number: 2 } }, { dependencies: [] }, { tombstones: [] },
    { eventSupport: { eventId: 'event_1', index: 0, type: 'world.create' } }
  ];
  for (const extra of invalid) assert.equal(Caps.validate(note(extra)), false, JSON.stringify(extra));
  for (const extra of [{ generation: 1 }, { support: { quote: '雨', eventId: 'event_1' } }, { source: {} }, { tombstones: [] }]) {
    assert.equal(Caps.validate({ type: 'memory.remove', id: 'note_concept', ...extra }), false);
  }
  for (const id of ['memory_0', 'memory_01', 'memory_-1', 'memory_100000', 'memory_1x', 'memory_1.0']) {
    assert.equal(Caps.validate(note({ id })), false);
    assert.equal(Caps.validate({ type: 'memory.remove', id }), false);
  }
  for (const support of [{ quote: '忘掉雨声', start: 0 }, { quote: '忘掉雨声', end: 4 }, { quote: '忘掉雨声', start: 0, end: 201 }, { quote: '' }]) {
    assert.equal(Caps.validate({ type: 'memory.remove', id: 'memory_1', support }), false);
  }
});

test('legacy rules reject rules4 metadata while preserving old exact memory operation fields', () => {
  for (const rulesVersion of ['2', '3']) {
    assert.equal(Caps.validate(note(), rulesVersion), true);
    for (const extra of [{ kind: 'concept' }, { perspective: 'character_interpretation' }, { support: { quote: '雨' } }]) {
      assert.equal(Caps.validate(note(extra), rulesVersion), false);
    }
    const schema = Caps.descriptors(['memory.upsert'], rulesVersion)[0].schema;
    assert.deepEqual(Object.keys(schema.properties), ['type', 'id', 'title', 'body']);
    assert.equal(Caps.validate(note({ evidence: '完整历史输入' }), rulesVersion), true, 'legacy validator retains optional echo although model advertisement omits it');
    assert.equal(Caps.validate({ type: 'memory.remove', id: 'note_concept' }, rulesVersion), true);
    assert.equal(Caps.validate(note({ id: 'memory_1' }), rulesVersion), false);
    assert.equal(Caps.validate({ type: 'memory.remove', id: 'memory_1' }, rulesVersion), false);
    assert.equal(Caps.validate({ type: 'memory.remove', id: 'note_concept', support: { quote: '忘掉' } }, rulesVersion), false);
  }
  assert.equal(Caps.validate(note(), 'unknown'), false);
  assert.deepEqual(Caps.descriptors(['memory.upsert'], 'unknown'), []);
});

test('captured current prompt allows selective memory initiative while preserving action and consent boundaries', () => {
  const request = Model.buildRequest(Runtime.context(fresh()), '雨是天空落下的水滴');
  const system = request.messages[0].content;
  for (const required of [
    '不必等玩家说“记住”', '普通问候、随口回应、重复信息无需每轮入记忆',
    '主动记忆不授权额外造物、天气、故事推进或同意', '不改写原始来源',
    'body必须逐字等于', 'character_interpretation', 'Unicode码点',
    '实际一起经历的事件或明确承诺', '同意须来自当前输入',
    '不要声称抹去了独立的原始审计', '不声称仍记得被遗忘的原话',
    '不透明操作句柄', '新记忆使用note_slug', '准确引用本轮要求忘记的子句',
    '省略support会排除完整本轮输入', '不重叠且独立的真实陈述',
    'withheld不是空位', '不能把context.memories.length当总用量',
    '不要自动删除、清理或替换条目来腾空间'
  ]) assert(system.includes(required), required);
  assert.equal(request.max_tokens, 2048);
  assert.equal(request.reasoning_effort, 'low');
  assert.equal(request.stream, false);
  assert(Buffer.byteLength(JSON.stringify(request)) <= 128 * 1024);
});

test('mocked salient memory plans need no remember command and preserve exact player source', async () => {
  let state = fresh();
  const cases = [
    ['雨是天空落下的水滴', 'concept', 'note_rain'],
    ['我更喜欢小雨的声音', 'preference', 'note_preference'],
    ['我答应明天再来看看你', 'promise', 'note_promise']
  ];
  for (const [input, kind, id] of cases) {
    assert(!input.includes('记住'));
    const { result } = await modeledTurn(state, input, [note({ id, kind, perspective: 'player_report', body: input, support: { quote: input } })]);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    state = result.state;
    const memory = state.memories.find(item => item.id === id);
    assert.equal(memory.kind, kind);
    assert.equal(memory.body, input);
    assert.equal(memory.source.text, input);
    assert.equal(memory.support.quote, input);
  }
  const { result } = await modeledTurn(state, '嗯，晚上好', []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.memories, state.memories, 'a quiet turn can remain free of memory writes');
});

test('quote-only Unicode support is resolved locally and repeated quotes need explicit disambiguation', async () => {
  const input = '🌧我喜欢小雨，也喜欢灯光';
  const result = (await modeledTurn(fresh(), input, [note({ body: '我喜欢小雨', perspective: 'player_report', support: { quote: '我喜欢小雨' } })])).result;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.state.memories[0].support.start, 1);
  assert.equal(result.state.memories[0].support.end, 6);
  const repeated = '🌧雨，雨';
  const ambiguous = (await modeledTurn(fresh(), repeated, [note({ body: '雨', perspective: 'player_report', support: { quote: '雨' } })])).result;
  assert.equal(ambiguous.ok, false);
  const precise = (await modeledTurn(fresh(), repeated, [note({ body: '雨', perspective: 'player_report', support: { quote: '雨', start: 3, end: 4 } })])).result;
  assert.equal(precise.ok, true, JSON.stringify(precise.error));
});

test('corrections reuse the active ID without rewriting the original quoted source', async () => {
  const first = '我喜欢雨声';
  let result = (await modeledTurn(fresh(), first, [note({ kind: 'preference', perspective: 'player_report', body: first })])).result;
  assert.equal(result.ok, true);
  const original = result.state.memories[0].source;
  const handle = Runtime.context(result.state).memories[0].id;
  const correction = '刚才说错了，我更喜欢雪落下时的安静';
  result = (await modeledTurn(result.state, correction, [note({ id: handle, kind: 'preference', perspective: 'player_report', body: correction, support: { quote: correction } })])).result;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.state.memories.length, 1);
  assert.deepEqual(result.state.memories[0].source, original);
  assert.equal(result.state.memories[0].currentRevision.text, correction);
  assert.equal(result.state.memories[0].currentRevision.number, 2);
});

test('ordinary summaries remain interpretations; a paraphrase cannot claim to be an exact player report', async () => {
  const input = '对我来说，这个灯代表回家';
  const summary = note({ kind: 'concept', body: '角色理解：这盏灯和回家有关' });
  const accepted = (await modeledTurn(fresh(), input, [summary])).result;
  assert.equal(accepted.ok, true, JSON.stringify(accepted.error));
  assert.equal(accepted.state.memories[0].perspective, 'character_interpretation');
  const rejected = (await modeledTurn(fresh(), input, [{ ...summary, perspective: 'player_report', support: { quote: input } }])).result;
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'MEMORY_CLAIM_INVALID');
});

test('shared events need an earlier actual operation and its exact locally verified summary', async () => {
  const create = { type: 'world.create', object: { label: '小灯', glyphs: '*', x: 4, y: 20, scale: 1 } };
  const shared = note({ kind: 'experience', perspective: 'shared_event', body: '一起创建了世界中的「小灯」' });
  const input = '我们在这里做一盏小灯';
  const result = (await modeledTurn(fresh(), input, [create, shared])).result;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.state.memories[0].perspective, 'shared_event');
  for (const operations of [
    [shared], [shared, create],
    [{ type: 'log.note', text: '一起做了小灯' }, shared],
    [create, { ...shared, body: '一起去了真正的海边' }]
  ]) {
    const state = fresh();
    const rejected = (await modeledTurn(state, input, operations)).result;
    assert.equal(rejected.ok, false);
    assert.equal(state.world.objects.length, 0);
    assert.equal(state.memories.length, 0);
  }
});

test('forgotten quotation and derivative recall are absent from both actual request messages', async () => {
  const secret = '我小时候把那条纸船叫作暮色八号';
  let result = (await modeledTurn(fresh(), secret, [note({ perspective: 'player_report', body: secret, support: { quote: secret } })], ['我会记得暮色八号这条纸船。'])).result;
  assert.equal(result.ok, true);
  result = (await modeledTurn(result.state, '那条船听起来怎么样', [
    { type: 'character.update', changes: { stance: '我想起你说过的暮色八号' } },
    note({ id: 'note_derivative', body: '暮色八号也许是一次告别的象征', perspective: 'character_interpretation' })
  ], ['也许暮色八号代表某次告别。'])).result;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const handle = Runtime.context(result.state).memories.find(item => item.body === secret).id;
  result = (await modeledTurn(result.state, '忘掉那条纸船的记忆', [{ type: 'memory.remove', id: handle }], ['这条记忆已经移出了我现在能回忆的内容。'])).result;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const serialized = JSON.stringify(Runtime.serialize(result.state));
  assert(serialized.includes(secret), 'the independent audit is retained');
  const current = Runtime.context(result.state);
  const request = Model.buildRequest(current, '你还能记得什么');
  assert(!JSON.stringify(request.messages).includes('暮色八号'));
  assert(!current.memories.some(item => item.id === 'note_derivative'));
  assert(!JSON.stringify(request.messages).includes('tombstones'));
  const reintroduced = '我今天给一颗星起名暮色八号';
  const recreated = (await modeledTurn(result.state, reintroduced, [note({ body: reintroduced, perspective: 'player_report', support: { quote: reintroduced } })])).result;
  assert.equal(recreated.ok, true, JSON.stringify(recreated.error));
  const memory = recreated.state.memories.find(item => item.id === 'note_concept');
  assert.equal(memory.source.text, reintroduced);
  assert.equal(memory.currentRevision.number, 1);
  assert.equal(memory.generation, 2);
});

test('opaque handles hide semantic IDs, normalize in the audit and reject unknown or stale generations', async () => {
  const id = 'note_rain_preference', input = '我喜欢小雨';
  let result = (await modeledTurn(fresh(), input, [note({ id, body: input, perspective: 'player_report' })])).result;
  assert.equal(result.ok, true);
  const state = result.state, handle = Runtime.context(state).memories[0].id;
  assert.match(handle, /^memory_[1-9][0-9]{0,4}$/u);
  assert(!JSON.stringify(Model.buildRequest(Runtime.context(state), '继续')).includes(id));
  const correction = '我现在更喜欢雪';
  result = (await modeledTurn(state, correction, [note({ id: handle, body: correction, perspective: 'player_report' })])).result;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.state.memories[0].id, id);
  assert.equal(Runtime.serialize(result.state).events.at(-1).plan.beats[0].operations[0].id, id);
  for (const operation of [note({ id: 'memory_99999' }), { type: 'memory.remove', id: 'memory_99999' }]) {
    const rejected = (await modeledTurn(state, '继续', [operation])).result;
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'MEMORY_HANDLE_INVALID');
  }
  result = (await modeledTurn(result.state, '忘掉天气偏好', [{ type: 'memory.remove', id: handle }])).result;
  assert.equal(result.ok, true);
  result = (await modeledTurn(result.state, input, [note({ id, body: input, perspective: 'player_report' })])).result;
  assert.equal(result.ok, true);
  assert.notEqual(Runtime.context(result.state).memories[0].id, handle);
  const stale = (await modeledTurn(result.state, correction, [note({ id: handle, body: correction, perspective: 'player_report' })])).result;
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'MEMORY_HANDLE_INVALID');
});

test('precise deletion clause hides its full transcript while preserving a disjoint exact player report', async () => {
  const original = '我喜欢雨声';
  let result = (await modeledTurn(fresh(), original, [note({ body: original, perspective: 'player_report' })])).result;
  assert.equal(result.ok, true);
  const before = result.state, handle = Runtime.context(before).memories[0].id;
  const removal = '忘掉雨声的偏好', independent = '我现在喜欢桂花香';
  const input = removal + '，' + independent;
  const report = note({ id: 'note_flower', body: independent, perspective: 'player_report', support: { quote: independent } });
  result = (await modeledTurn(before, input, [{ type: 'memory.remove', id: handle, support: { quote: removal } }, report], ['已经忘掉雨声的偏好，也记下了桂花香。'])).result;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const current = Runtime.context(result.state), request = Model.buildRequest(current, '还记得什么');
  assert.equal(current.memories.length, 1);
  assert.equal(current.memories[0].body, independent);
  assert.equal(current.memories[0].source.text, independent);
  assert(!JSON.stringify(request.messages).includes('雨声'));
  assert(!current.recentTranscript.some(item => item.text === input));
  assert(!current.recentTranscript.some(item => item.text.includes('桂花香')));
  assert(JSON.stringify(request.messages).includes(independent));
  const broad = (await modeledTurn(before, input, [{ type: 'memory.remove', id: handle }, report])).result;
  assert.equal(broad.ok, true, JSON.stringify(broad.error));
  assert.equal(Runtime.context(broad.state).memories.length, 0, 'omitted support conservatively suppresses the complete mixed input');
});

test('actual request reports all occupied memory slots without leaking withheld content and supports explicit inventory removal', async () => {
  const secret = '晚霞秘密木船四十三号';
  let result = (await modeledTurn(fresh(), secret, [note({ id: 'note_hidden_root', body: secret, perspective: 'player_report' })])).result;
  assert.equal(result.ok, true);
  const derivatives = Array.from({ length: 13 }, (_, i) => note({
    id: 'note_hidden_' + i, title: secret + i, body: secret + '的衍生理解' + i,
    perspective: 'character_interpretation'
  }));
  for (const operations of [derivatives.slice(0, 12), derivatives.slice(12)]) {
    result = (await modeledTurn(result.state, '继续理解那条船', operations, ['我们可以继续理解它。'])).result;
    assert.equal(result.ok, true, JSON.stringify(result.error));
  }
  const rootHandle = Runtime.context(result.state).memories.find(memory => memory.body === secret).id;
  result = (await modeledTurn(result.state, '忘掉那条船的原始记忆', [{ type: 'memory.remove', id: rootHandle }])).result;
  assert.equal(result.ok, true);
  assert.equal(result.state.memories.length, 13);
  assert.equal(Runtime.context(result.state).memories.length, 0);
  const visible = '我喜欢桂花香';
  result = (await modeledTurn(result.state, visible, [note({ id: 'note_flower', body: visible, perspective: 'player_report' })])).result;
  assert.equal(result.ok, true);
  const current = Runtime.context(result.state);
  assert.equal(current.memories.length, 1);
  assert.equal(current.memoryCapacity.limit, 14);
  assert.equal(current.memoryCapacity.used, 14);
  assert.equal(current.memoryCapacity.withheld.length, 13);
  for (const entry of current.memoryCapacity.withheld) {
    assert.deepEqual(Object.keys(entry), ['id']);
    assert.match(entry.id, /^memory_[1-9][0-9]{0,4}$/u);
  }
  const request = Model.buildRequest(current, '还可以记住什么');
  const sent = JSON.parse(request.messages[1].content).context;
  assert.deepEqual(sent.memoryCapacity, current.memoryCapacity);
  assert(!JSON.stringify(request).includes(secret));
  assert(!JSON.stringify(request).includes('note_hidden_'));
  assert(Buffer.byteLength(JSON.stringify(request)) <= 128 * 1024);
  const removal = '删除一条没有正文的记忆', freshReport = '我喜欢热茶';
  const input = removal + '，再记住' + freshReport;
  result = (await modeledTurn(result.state, input, [
    { type: 'memory.remove', id: current.memoryCapacity.withheld[0].id, support: { quote: removal } },
    note({ id: 'note_tea', body: freshReport, perspective: 'player_report', support: { quote: freshReport } })
  ])).result;
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const after = Runtime.context(result.state);
  assert.equal(result.state.memories.length, 14);
  assert.equal(after.memoryCapacity.used, 14);
  assert.equal(after.memoryCapacity.withheld.length, 12);
  assert(after.memories.some(memory => memory.body === freshReport));
  assert(!JSON.stringify(Model.buildRequest(after, '继续')).includes(secret));
});

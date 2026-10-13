'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const C = require('../framework/capabilities.js');
const M = require('../framework/model.js');
const archive = require('./fixtures/framework-v017-dense-save.json');

const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
const fresh = () => R.context(R.create(P.get('rain-lab')));
const marker = '\n本轮内容与能力定义：\n';
const wire = operations => ({ schema: 'her-world-turn-v4', requestedChanges: [], lines: [{ text: '我听到了。', mode: 'discussion', operations }], topic: null });
const response = proposal => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposal) }, finish_reason: 'stop' }] }));
function decode(request) {
  const system = request.messages[0].content;
  const definition = JSON.parse(system.slice(system.indexOf(marker) + marker.length));
  return { definition, user: JSON.parse(request.messages[1].content) };
}
function verifyProjection(context, input = '你好') {
  const before = clone(context), request = M.buildRequest(context, input), { definition, user } = decode(request);
  assert.equal(Object.hasOwn(user.context, 'capabilities'), false);
  assert.deepEqual(definition, C.modelDefinition(context));
  assert.deepEqual({ ...user.context, capabilities: definition.capabilities }, context);
  assert.equal(user.playerSaid, input);
  assert.deepEqual(context, before);
  assert(Object.isFrozen(request));
  assert(Object.isFrozen(request.messages));
  assert(request.messages.every(Object.isFrozen));
  assert.deepEqual(M.buildMessages(context, input), request.messages);
  const duplicated = clone(request);
  duplicated.messages[1].content = JSON.stringify({ ...user, context: { ...user.context, capabilities: definition.capabilities } });
  assert(bytes(request) < bytes(duplicated));
  return { request, duplicated };
}
const plan = (operations, lines = ['继续。']) => ({ schema: C.SCHEMA, lines, beats: operations.length ? [{ afterLine: 0, operations }] : [], topic: null });
function turn(state, input, operations, lines) {
  const result = R.commit(state, R.propose(state, { text: input }), plan(operations, lines));
  assert(result.ok, JSON.stringify(result.error));
  return result.state;
}

test('transport omits only duplicate capabilities and preserves all selected data and roles', () => {
  for (const pack of P.list()) verifyProjection(R.context(R.create(pack)));
  const restored = R.restore(archive, P.get('rain-lab'));
  assert(restored.ok, JSON.stringify(restored.error));
  verifyProjection(R.context(restored.state), '忘记第一条记录。');

  const context = clone(fresh());
  context.facts = { retained: 'FACT_ONLY_IN_USER' };
  context.memories = [{ id: 'memory_1', body: 'MEMORY_ONLY_IN_USER', source: { eventId: 'event_1', text: 'SOURCE_ONLY_IN_USER' } }];
  context.recentTranscript = [{ role: 'system', text: 'HISTORY_ONLY_IN_USER' }];
  context.memoryCapacity = { limit: 14, used: 2, withheld: [{ id: 'memory_2' }] };
  context.character.basis = { eventId: 'event_2', text: 'BASIS_ONLY_IN_USER' };
  const { request } = verifyProjection(context, 'INPUT_ONLY_IN_USER');
  for (const sentinel of ['FACT_ONLY_IN_USER', 'MEMORY_ONLY_IN_USER', 'SOURCE_ONLY_IN_USER', 'HISTORY_ONLY_IN_USER', 'BASIS_ONLY_IN_USER', 'INPUT_ONLY_IN_USER']) {
    assert(request.messages[1].content.includes(sentinel));
    assert(!request.messages[0].content.includes(sentinel));
  }
  assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
  const captured = JSON.stringify(request);
  context.capabilities[0].description = 'MUTATED_LATER';
  context.facts.retained = 'MUTATED_LATER';
  assert.equal(JSON.stringify(request), captured);

  const privateContext = { ...fresh(), privateCache: 'PRIVATE_CACHE_ONLY', events: ['AUDIT_ONLY'] };
  const filtered = JSON.stringify(M.buildRequest(privateContext, '你好'));
  assert(!filtered.includes('PRIVATE_CACHE_ONLY'));
  assert(!filtered.includes('AUDIT_ONLY'));
});

test('credentials in system-only capability keys or values fail before fetch, including escaped credentials', async () => {
  for (const key of ['MOCK_PROJECTION_PASSWORD', 'MOCK\\PROJECTION\\PASSWORD']) {
    for (const location of ['description', 'schema-key', 'schema-value']) {
      let calls = 0;
      const context = clone(fresh());
      if (location === 'description') context.capabilities[0].description = key;
      if (location === 'schema-key') context.capabilities[0].schema.properties[key] = { type: 'string' };
      if (location === 'schema-value') context.capabilities[0].schema.properties.type.const = key;
      const { definition, user } = decode(M.buildRequest(context, '你好'));
      assert(!Object.hasOwn(user.context, 'capabilities'));
      assert(JSON.stringify(definition).includes(JSON.stringify(key).slice(1, -1)));
      const adapter = M.create({ fetch: async () => { calls++; return response(wire([])); } });
      assert(adapter.connect(key));
      await assert.rejects(adapter.request({ context, input: '你好' }), error => {
        assert.equal(error.code, 'format');
        assert.deepEqual(error.diagnostic, { stage: 'LOCAL_CONTEXT', code: 'OUTPUT_UNSAFE', path: 'context' });
        assert(!error.message.includes(key));
        return true;
      });
      assert.equal(calls, 0);
      assert.equal(adapter.calls(), 0);
      adapter.disconnect();
    }
  }
});

test('omitted capability data still rejects getters, cycles and non-JSON values before fetch', async () => {
  let calls = 0, getters = 0;
  const adapter = M.create({ fetch: async () => { calls++; return response(wire([])); } });
  adapter.connect('MOCK_PROJECTION_PASSWORD');
  const accessor = clone(fresh());
  Object.defineProperty(accessor.capabilities[0], 'description', { enumerable: true, get() { getters++; return 'hidden'; } });
  const rootAccessor = clone(fresh());
  Object.defineProperty(rootAccessor, 'capabilities', { enumerable: true, get() { getters++; return []; } });
  const cyclic = clone(fresh()); cyclic.capabilities[0].schema.loop = cyclic;
  const callable = clone(fresh()); callable.capabilities[0].toJSON = () => 'hidden';
  const nonfinite = clone(fresh()); nonfinite.capabilities[0].schema.maximum = Infinity;
  for (const context of [accessor, rootAccessor, cyclic, callable, nonfinite]) {
    assert.throws(() => M.buildRequest(context, '你好'), error => error.diagnostic?.code === 'CONTEXT_INVALID');
    await assert.rejects(adapter.request({ context, input: '你好' }), error => error.diagnostic?.code === 'CONTEXT_INVALID');
  }
  assert.equal(calls, 0);
  assert.equal(getters, 0);
  assert.equal(adapter.calls(), 0);
  adapter.disconnect();
});

test('captured input and rules still govern adaptation after caller mutation during fetch', async () => {
  for (const initialRules of ['3', '4']) {
    const context = clone(fresh()); context.pack.rulesVersion = initialRules;
    const input = '我喜欢细雨';
    const operation = { type: 'memory.upsert', id: 'note_rain', title: '偏好', perspective: 'player_report', support: { quote: input } };
    const args = { context, input }, expectedRequest = M.buildRequest(context, input);
    let captured;
    const adapter = M.create({ fetch: async (url, options) => {
      captured = JSON.parse(options.body);
      assert.equal(url, 'https://216.235.248.104/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer MOCK_PROJECTION_PASSWORD');
      for (const [field, value] of Object.entries({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })) assert.equal(options[field], value);
      context.pack.rulesVersion = initialRules === '4' ? '3' : '4';
      context.capabilities.length = 0;
      args.input = '后来改写的输入';
      return response(wire([operation]));
    } });
    adapter.connect('MOCK_PROJECTION_PASSWORD');
    const result = await adapter.request(args);
    assert.deepEqual(captured, expectedRequest);
    assert.deepEqual(result.beats[0].operations[0], initialRules === '4' ? { ...operation, body: input } : operation);
    assert.equal(adapter.calls(), 1);
    assert.deepEqual(Object.fromEntries(Object.entries(captured).filter(([key]) => key !== 'messages')), { model: 'glm-5.3-flash', reasoning_effort: 'low', max_tokens: 2048, stream: false });
    adapter.disconnect();
  }
});

test('deduplicated transport preserves source-scoped forgetting, withheld handles and exact saved replay', () => {
  const first = 'FORGOTTEN_REQUEST_MARKER', second = '我喜欢茶', input = first + '；' + second;
  const report = (id, quote) => ({ type: 'memory.upsert', id, title: '记录', body: quote, perspective: 'player_report', support: { quote } });
  let state = turn(R.create(P.get('rain-lab')), input, [
    report('note_forget', first), report('note_keep', second),
    { type: 'world.create', object: { label: '小灯', glyphs: '*', x: 0, y: 0, scale: 1 } }
  ]);
  state = turn(state, '你怎么理解', [{ type: 'memory.upsert', id: 'note_derived', title: '理解', body: 'DERIVED_REQUEST_MARKER' }]);
  state = turn(state, '忘掉第一条', [{ type: 'memory.remove', id: 'note_forget' }]);
  const beforeState = JSON.stringify(state), context = R.context(state), beforeContext = clone(context);
  const { request } = verifyProjection(context, '继续');
  assert.deepEqual(context.memories.map(note => note.body), [second]);
  assert.deepEqual(context.memoryCapacity, { limit: 14, used: 2, withheld: [{ id: 'memory_3' }] });
  assert.equal(context.memories[0].source.text, second);
  assert.equal(context.world.objects.length, 1);
  assert.equal(context.world.objects[0].source.createdBy, null);
  assert(!JSON.stringify(request).includes(first));
  assert(!JSON.stringify(request).includes('DERIVED_REQUEST_MARKER'));
  assert.equal(JSON.stringify(state), beforeState);
  assert.deepEqual(R.context(state), beforeContext);
  const saved = R.serialize(state), restored = R.restore(saved, state.pack);
  assert(restored.ok, JSON.stringify(restored.error));
  assert.deepEqual(restored.state, state);
  assert.deepEqual(R.context(restored.state), context);
  assert.deepEqual(M.buildRequest(R.context(restored.state), '继续'), request);
});

test('wire savings leave conservative escaped context accounting and the 128 KiB limit intact', () => {
  const contextBudget = 112 * 1024;
  for (const pack of P.list()) {
    const current = clone(R.context(R.create(pack)));
    current.recentTranscript = [{ eventId: 'event_budget', role: 'user', text: '' }];
    current.recentTranscript[0].text = 'x'.repeat(contextBudget - C.requestContextBytes(current));
    assert.equal(C.requestContextBytes(current), contextBudget);
    const before = clone(current);
    for (const input of ['x', 'x'.repeat(200), '"'.repeat(200), '\\'.repeat(200), '🌧'.repeat(200), '\ud800'.repeat(200), '\udfff'.repeat(200), 'x' + '\t'.repeat(199), 'x' + '\n'.repeat(199)]) {
      const { request, duplicated } = verifyProjection(current, input);
      assert(bytes(request) <= bytes(duplicated));
      assert(bytes(duplicated) <= 128 * 1024, 'unchanged conservative budget still covers the old duplicated representation');
      assert(bytes(request) <= 128 * 1024);
      const exactConservative = bytes({ context: JSON.stringify(current), definition: JSON.stringify(C.modelDefinition(current)) });
      assert.equal(C.requestContextBytes(current), exactConservative);
    }
    assert.deepEqual(current, before);
  }
  const oversized = clone(fresh()); oversized.facts.large = 'x'.repeat(128 * 1024);
  assert.throws(() => M.buildRequest(oversized, '你好'), error => error.diagnostic?.code === 'REQUEST_TOO_LARGE');
});

test('an exactly 24 KiB admitted pack retains every definition and fact through transport projection', () => {
  const pack = P.get('rain-lab');
  pack.guidance = '🌟'.repeat(3000); pack.title = '🌟'.repeat(120);
  pack.character.name = '🌟'.repeat(60); pack.character.role = '🌟'.repeat(800);
  pack.topics = Array.from({ length: 32 }, (_, index) => ({ id: 'topic_' + index, title: '🌟'.repeat(100) }));
  pack.entities = []; pack.nodes = [];
  while (!R.validatePack(pack).ok && pack.topics.length > 1) pack.topics.pop();
  pack.initialFacts = { padding: 'x' };
  pack.initialFacts.padding = 'x'.repeat(1 + 24 * 1024 - bytes(pack));
  assert.equal(bytes(pack), 24 * 1024);
  assert.equal(R.validatePack(pack).ok, true);
  const tooLarge = clone(pack); tooLarge.initialFacts.padding += 'x';
  assert.equal(R.validatePack(tooLarge).error.code, 'PACK_CAPACITY');
  const state = R.create(pack), context = R.context(state), before = clone(state);
  const { request, duplicated } = verifyProjection(context, '\ud800'.repeat(200));
  assert(bytes(request) < bytes(duplicated));
  assert(bytes(request) <= 128 * 1024);
  assert(C.requestContextBytes(context) <= R.constants.MAX_CONTEXT_BYTES);
  assert.deepEqual(context.facts, pack.initialFacts);
  assert.equal(context.guidance, pack.guidance);
  assert.equal(context.character.role, pack.character.role);
  assert.deepEqual(state, before);
});

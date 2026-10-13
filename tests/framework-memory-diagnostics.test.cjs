'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const C = require('../framework/capabilities.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const secret = 'MODEL_PRIVATE_SENTINEL_987654321';
const clone = value => JSON.parse(JSON.stringify(value));
const fresh = () => R.create(P.get('rain-lab'));
const note = extra => ({ type: 'memory.upsert', id: 'note_test', title: '偏好', body: '我喜欢风声', ...extra });
const plan = operations => ({ schema: C.SCHEMA, topic: null, lines: ['记好了。'], beats: [{ afterLine: 0, operations }] });
const commit = (state, operations, model = true, input = '我喜欢风声') => R[model ? 'commitModel' : 'commit'](state, R.propose(state, { text: input }), plan(operations));
const without = (value, field) => { const copy = clone(value); delete copy[field]; return copy; };
const cases = [
  [without(note(), 'id'), 'REQUIRED_FIELD_MISSING', 'id'],
  [without(note(), 'title'), 'REQUIRED_FIELD_MISSING', 'title'],
  [without(note(), 'body'), 'REQUIRED_FIELD_MISSING', 'body'],
  [note({ [secret]: secret }), 'UNKNOWN_FIELD'],
  [note({ memoryReason: secret, memoryField: secret }), 'UNKNOWN_FIELD'],
  [note({ id: { [secret]: secret } }), 'TYPE_INVALID', 'id'],
  [note({ id: secret }), 'ID_FORMAT_INVALID', 'id'],
  [note({ id: 'memory_01' }), 'ID_FORMAT_INVALID', 'id'],
  [note({ id: 'note_' + 'x'.repeat(33) }), 'STRING_LENGTH_INVALID', 'id'],
  [note({ title: secret.repeat(4) }), 'STRING_LENGTH_INVALID', 'title'],
  [note({ title: null }), 'TYPE_INVALID', 'title'],
  [note({ body: null }), 'TYPE_INVALID', 'body'],
  [note({ body: '' }), 'STRING_LENGTH_INVALID', 'body'],
  [note({ body: '🌧'.repeat(241) }), 'STRING_LENGTH_INVALID', 'body'],
  [note({ kind: secret }), 'ENUM_INVALID', 'kind'],
  [note({ perspective: secret }), 'ENUM_INVALID', 'perspective'],
  [note({ evidence: { [secret]: secret } }), 'TYPE_INVALID', 'evidence'],
  [note({ support: secret }), 'TYPE_INVALID', 'support'],
  [note({ support: {} }), 'REQUIRED_FIELD_MISSING', 'support.quote'],
  [note({ support: { quote: '我喜欢风声', [secret]: secret } }), 'UNKNOWN_FIELD', 'support'],
  [note({ support: { quote: { [secret]: secret } } }), 'TYPE_INVALID', 'support.quote'],
  [note({ support: { quote: '' } }), 'STRING_LENGTH_INVALID', 'support.quote'],
  [note({ support: { quote: '风', start: secret, end: 1 } }), 'TYPE_INVALID', 'support.start'],
  [note({ support: { quote: '风', start: 0, end: 1.5 } }), 'TYPE_INVALID', 'support.end'],
  [note({ support: { quote: '风', start: -1, end: 1 } }), 'NUMBER_RANGE_INVALID', 'support.start'],
  [note({ support: { quote: '风', start: 0, end: 201 } }), 'NUMBER_RANGE_INVALID', 'support.end'],
  [note({ support: { quote: '风', start: 0 } }), 'SUPPORT_OFFSETS_UNPAIRED', 'support'],
  [note({ support: { quote: '风', end: 1 } }), 'SUPPORT_OFFSETS_UNPAIRED', 'support'],
  [{ type: 'memory.remove' }, 'REQUIRED_FIELD_MISSING', 'id'],
  [{ type: 'memory.remove', id: 'memory_1', [secret]: secret }, 'UNKNOWN_FIELD'],
  [{ type: 'memory.remove', id: secret }, 'ID_FORMAT_INVALID', 'id'],
  [{ type: 'memory.remove', id: 'memory_1', support: { quote: '风', start: 0 } }, 'SUPPORT_OFFSETS_UNPAIRED', 'support']
];

test('32 structural memory failures gain only fixed diagnostic enums without changing rejection or state', () => {
  const state = commit(fresh(), [note()]).state, before = clone(state), save = R.serialize(state);
  for (const model of [false, true]) for (const [op, reason, field] of cases) {
    const original = clone(op), result = commit(state, [op], model);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'OPERATION_INVALID'); assert.equal(result.error.path, '$');
    assert.deepEqual(result.error.diagnostic, { stage: 'RUNTIME', reason: 'OPERATION_REJECTED', path: 'beats[0].operations[0]', beatIndex: 0, operationIndex: 0, operationType: op.type, memoryReason: reason, ...(field ? { memoryField: field } : {}) });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.state, undefined); assert.equal(result.frames, undefined);
    assert.deepEqual(op, original); assert.deepEqual(state, before); assert.deepEqual(R.serialize(state), save);
  }
});

test('diagnostic classification is separate from current and historical schema acceptance', () => {
  const valid = [note(), note({ kind: 'preference', perspective: 'player_report', support: { quote: '我喜欢风声' } }), { type: 'memory.remove', id: 'memory_1' }];
  for (const op of valid) { assert.equal(C.validate(op), true); assert.deepEqual(C.memoryDiagnostic(op), {}); }
  for (const [op] of cases) assert.equal(C.validate(op), false);
  for (const version of ['2', '3']) {
    assert.equal(C.validate(note(), version), true); assert.deepEqual(C.memoryDiagnostic(note(), version), {});
    assert.equal(C.validate(note({ kind: 'note' }), version), false);
    assert.deepEqual(C.memoryDiagnostic(note({ kind: 'note' }), version), { memoryReason: 'UNKNOWN_FIELD' });
    assert.equal(C.validate(note({ id: 'memory_1' }), version), false);
    assert.deepEqual(C.memoryDiagnostic(note({ id: 'memory_1' }), version), { memoryReason: 'ID_FORMAT_INVALID', memoryField: 'id' });
  }
  for (const value of [null, false, [], { type: secret }, { type: 'panel.open', panel: 'memory' }]) assert.deepEqual(C.memoryDiagnostic(value), {});
  assert.deepEqual(C.memoryDiagnostic(note(), 'unknown'), {});
});

test('the diagnostic helper does not invoke getters or emit arbitrary properties and values', () => {
  let reads = 0;
  const getter = { get() { reads++; throw new Error(secret); }, enumerable: true };
  const root = note(); Object.defineProperty(root, 'body', getter);
  assert.deepEqual(C.memoryDiagnostic(root), { memoryReason: 'TYPE_INVALID', memoryField: 'body' });
  const nested = note({ support: { quote: '风' } }); Object.defineProperty(nested.support, 'start', getter); nested.support.end = 1;
  assert.deepEqual(C.memoryDiagnostic(nested), { memoryReason: 'TYPE_INVALID', memoryField: 'support.start' });
  const unknown = note(); Object.defineProperty(unknown, secret, getter);
  assert.deepEqual(C.memoryDiagnostic(unknown), { memoryReason: 'UNKNOWN_FIELD' });
  const typed = note(); Object.defineProperty(typed, 'type', getter);
  assert.deepEqual(C.memoryDiagnostic(typed), {});
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error(secret); } });
  assert.deepEqual(C.memoryDiagnostic(proxy), {}); assert.equal(reads, 0);
});

test('later structural failure rolls back memory, weather and dialogue and never writes diagnostics', () => {
  const state = fresh(), before = clone(state);
  const result = commit(state, [note(), { type: 'weather.set', changes: { name: '叶信', intensity: 1, paused: false } }, note({ id: 'note_second', body: null })]);
  assert.equal(result.error.code, 'OPERATION_INVALID'); assert.equal(result.error.diagnostic.operationIndex, 2);
  assert.equal(result.error.diagnostic.memoryReason, 'TYPE_INVALID');
  assert.deepEqual(state, before); assert.equal(result.frames, undefined);
  const accepted = commit(state, [note()]); assert.equal(accepted.ok, true);
  const saved = R.serialize(accepted.state), restored = R.restore(saved, accepted.state.pack);
  assert.equal(restored.ok, true); assert.deepEqual(restored.state, accepted.state);
  assert.equal(JSON.stringify(saved).includes('memoryReason'), false); assert.equal(JSON.stringify(saved).includes('memoryField'), false);
});

test('current report revision retains identity and source; omitted kind still defaults to note', async () => {
  const initial = commit(fresh(), [note({ kind: 'preference', perspective: 'player_report', support: { quote: '我喜欢风声' } })]);
  assert(initial.ok); const state = initial.state, input = '我现在更喜欢树叶声';
  for (const kind of ['preference', undefined]) {
    const report = { type: 'memory.upsert', id: 'memory_1', title: '声音偏好', perspective: 'player_report', support: { quote: input }, ...(kind ? { kind } : {}) };
    const wire = { schema: 'her-world-turn-v4', requestedChanges: [], topic: null, lines: [{ text: '偏好已修订。', mode: 'discussion', operations: [report] }] };
    const model = M.create({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(wire) }, finish_reason: 'stop' }] })) });
    assert(model.connect('SYNTHETIC_ONLY_TEST_KEY'));
    let canonical; try { canonical = await model.request({ context: R.context(state), input }); } finally { model.disconnect(); }
    const result = R.commitModel(state, R.propose(state, { text: input }), canonical); assert.equal(result.ok, true);
    const revised = result.state.memories[0];
    assert.equal(revised.kind, kind || 'note'); assert.equal(revised.perspective, 'player_report'); assert.equal(revised.body, input);
    assert.equal(revised.id, state.memories[0].id); assert.deepEqual(revised.source, state.memories[0].source); assert.equal(revised.currentRevision.number, 2);
    assert.deepEqual(result.state.world, state.world); assert.equal(result.state.memories.length, 1);
    assert.deepEqual(R.restore(R.serialize(result.state), result.state.pack).state, result.state);
  }
});

test('provenance and identity errors do not masquerade as structural diagnostics', () => {
  const state = fresh();
  for (const [op, code] of [
    [note({ perspective: 'player_report', body: '转述', support: { quote: '我喜欢风声' } }), 'MEMORY_CLAIM_INVALID'],
    [note({ id: 'memory_999' }), 'MEMORY_HANDLE_INVALID'],
    [note({ support: { quote: '未知原文' } }), 'MEMORY_SUPPORT_INVALID'],
    [note({ perspective: 'shared_event' }), 'MEMORY_SHARED_EVENT_UNVERIFIED']
  ]) {
    const result = commit(state, [op]); assert.equal(result.error.code, code);
    assert.equal(result.error.diagnostic.memoryReason, undefined); assert.equal(result.error.diagnostic.memoryField, undefined);
  }
});

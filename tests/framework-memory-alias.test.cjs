'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const R = require('../framework/runtime.js');
const C = require('../framework/capabilities.js');
const P = require('../framework/packs.js');
const fixture = require('./fixtures/framework-memory-surrogate.json');
const clone = value => JSON.parse(JSON.stringify(value));
const fresh = () => R.create(P.get('rain-lab'));
const note = (id, body = '新的想法', extra = {}) => ({ type: 'memory.upsert', id, title: '笔记', body, ...extra });
const report = (id, body, extra = {}) => note(id, body, { perspective: 'player_report', support: { quote: body }, ...extra });
const remove = id => ({ type: 'memory.remove', id });
const plan = operations => ({ schema: C.SCHEMA, topic: null, lines: ['我听到了。'], beats: operations.length ? [{ afterLine: 0, operations }] : [] });
const commit = (state, text, operations, method = R.commitModel) => method(state, R.propose(state, { text }), plan(operations));
const turn = (...args) => { const result = commit(...args); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const canonical = (state, text, operations) => turn(state, text, operations, R.commit);
const savedIds = state => state.events.at(-1).plan.beats.flatMap(beat => beat.operations.filter(op => /^memory\./u.test(op.type)).map(op => op.id));
const roundTrip = state => {
  const saved = R.serialize(state), restored = R.restore(JSON.stringify(saved), state.pack);
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  assert.deepEqual(restored.state, state);
  assert.deepEqual(R.context(restored.state), R.context(state));
  assert.deepEqual(R.serialize(restored.state), saved);
  return restored.state;
};

test('repeated model slugs create distinct notes without revising a known canonical record', () => {
  const original = canonical(fresh(), '我喜欢雨', [report('note_preference', '我喜欢雨')]);
  const requested = plan([report('note_preference', '我喜欢海')]), before = clone(requested);
  const result = R.commitModel(original, R.propose(original, { text: '我喜欢海' }), requested);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(requested, before);
  assert.deepEqual(result.state.memories[0], original.memories[0]);
  let state = turn(result.state, '我喜欢云', [report('note_preference', '我喜欢云')]);
  assert.deepEqual(state.memories.map(memory => memory.id), ['note_preference', 'note_local_1', 'note_local_2']);
  assert.deepEqual(state.memories.map(memory => memory.body), ['我喜欢雨', '我喜欢海', '我喜欢云']);
  assert.deepEqual(state.memories.map(memory => memory.currentRevision.number), [1, 1, 1]);
  assert.deepEqual(state.memories.map(memory => memory.source.eventId), ['event_1', 'event_2', 'event_3']);
  assert.deepEqual(R.context(state).memories.map(memory => memory.id), ['memory_1', 'memory_2', 'memory_3']);
  assert.doesNotMatch(JSON.stringify(R.context(state)), /note_preference|note_local_[12]/u);
  state = roundTrip(state);
  assert.equal(turn(state, '新的事情', [note('note_preference')]).memories.at(-1).id, 'note_local_3');
});

test('new aliases skip active, withheld and forgotten IDs throughout the recall namespace', () => {
  let state = canonical(fresh(), '雨是秘密', [report('note_local_2', '雨是秘密')]);
  state = canonical(state, '你怎样理解', [note('note_local_1', '她对秘密的理解')]);
  state = canonical(state, '白云', [report('note_local_3', '白云')]);
  state = canonical(state, '忘掉秘密', [remove('note_local_2')]);
  const before = state;
  assert.deepEqual(R.context(state).memoryCapacity.withheld, [{ id: 'memory_2' }]);
  assert.deepEqual(R.context(state).memories.map(memory => memory.id), ['memory_3']);
  const aliases = ['note_local_1', 'note_local_2', 'note_local_3'];
  state = turn(state, '甲；乙；丙', aliases.map((id, index) => report(id, ['甲', '乙', '丙'][index])));
  assert.deepEqual(savedIds(state), ['note_local_4', 'note_local_5', 'note_local_6']);
  assert.deepEqual(state.memories.slice(0, 2), before.memories);
  assert.deepEqual(state.recall.tombstones, before.recall.tombstones);
  assert.equal(state.recall.generations.note_local_2, 1, 'a forgotten record is never reused');
  assert.equal(state.memories.some(memory => memory.id === 'note_local_2'), false);
  for (const id of savedIds(state)) assert.equal(state.recall.generations[id], 1);
  assert.doesNotMatch(JSON.stringify(R.context(state)), /她对秘密的理解|note_local_[1-6]/u);
  roundTrip(state);
});

test('imported notes reserve local IDs even after deletion and save restoration', () => {
  const imported = R.importLegacy({
    origin: { type: 'legacy-v3', version: '0.5.4', milestones: [] },
    world: { objects: [], annotations: {}, weather: { kind: 'rain', name: '雨', intensity: 1, paused: false, source: null } },
    memories: [{ id: 'note_local_1', title: '旧记录', body: '旧秘密', source: null, latestSource: null }],
    transcript: [], facts: {}
  }, P.get('rain-lab'));
  assert.equal(imported.ok, true, JSON.stringify(imported.error));
  let state = turn(imported.state, '忘掉旧记录', [remove('memory_1')]);
  state = roundTrip(state);
  state = turn(state, '新事物', [report('note_local_1', '新事物')]);
  assert.deepEqual(savedIds(state), ['note_local_2']);
  assert.equal(state.memories[0].generation, 1);
  assert.equal(state.memories[0].source.eventId, 'event_2');
  roundTrip(state);
});

test('same-turn aliases resolve across beats for creation, revision and removal', () => {
  const original = canonical(fresh(), '旧记录', [report('note_shared', '旧记录')]);
  const requested = {
    schema: C.SCHEMA, topic: null, lines: ['先记下。', '再修正。', '移开这条。'],
    beats: [
      { afterLine: 0, operations: [report('note_shared', '甲'), report('note_local_1', '乙')] },
      { afterLine: 1, operations: [report('note_shared', '乙')] },
      { afterLine: 2, operations: [remove('note_shared')] }
    ]
  };
  const result = R.commitModel(original, R.propose(original, { text: '甲；乙；移开' }), requested);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(savedIds(result.state), ['note_local_1', 'note_local_2', 'note_local_1', 'note_local_1']);
  assert.deepEqual(result.state.memories[0], original.memories[0]);
  assert.equal(result.frames[0].memories[1].body, '甲');
  assert.equal(result.frames[1].memories[1].body, '乙');
  assert.equal(result.frames[1].memories[1].currentRevision.number, 2);
  assert.deepEqual(result.frames[2].memories.map(memory => memory.id), ['note_shared', 'note_local_2']);
  result.frames.forEach((frame, line) => assert.deepEqual(R.view(result.state, { event: 1, line }), frame));
  roundTrip(result.state);
});

test('a removed alias cannot be reused or resurrected during its turn', () => {
  const state = fresh(), before = JSON.stringify(state);
  for (const last of [note('note_temp'), remove('note_temp')]) {
    const result = commit(state, '暂时记下再移开', [note('note_temp'), remove('note_temp'), last]);
    assert.equal(result.error.code, 'MEMORY_HANDLE_INVALID');
    assert.equal(result.error.diagnostic.operationIndex, 2);
    assert.equal(result.frames, undefined);
    assert.equal(JSON.stringify(state), before);
  }
  const distinct = turn(state, '移开一条再新建另一条', [note('note_temp'), remove('note_temp'), note('note_other')]);
  assert.deepEqual(savedIds(distinct), ['note_local_1', 'note_local_1', 'note_local_2']);
  assert.equal(distinct.memories[0].generation, 1);
});

test('only exposed memory handles can revise or remove previous-turn records', () => {
  const original = canonical(fresh(), '旧偏好', [report('note_preference', '旧偏好')]);
  const corrected = turn(original, '新偏好', [report('memory_1', '新偏好')]);
  assert.deepEqual(savedIds(corrected), ['note_preference']);
  assert.equal(corrected.memories.length, 1);
  assert.equal(corrected.memories[0].currentRevision.number, 2);
  assert.deepEqual(corrected.memories[0].source, original.memories[0].source);
  assert.equal(turn(corrected, '移开它', [remove('memory_1')]).memories.length, 0);
  for (const id of ['note_preference', 'note_unknown', 'memory_2']) {
    const result = commit(original, '移开它', [remove(id)]);
    assert.equal(result.error.code, 'MEMORY_HANDLE_INVALID');
    assert.deepEqual(result.error.diagnostic, { stage: 'RUNTIME', reason: 'OPERATION_REJECTED', path: 'beats[0].operations[0]', beatIndex: 0, operationIndex: 0, operationType: 'memory.remove' });
  }
  assert.equal(commit(original, '新偏好', [report('memory_99999', '新偏好')]).error.code, 'MEMORY_HANDLE_INVALID');
  assert.equal(commit(original, '新的一条', [note('note_new'), remove('memory_2')]).error.code, 'MEMORY_HANDLE_INVALID', 'newly allocated handles are not exposed until the next turn');
  roundTrip(corrected);
});

test('withheld handles still support an explicit current revision and removal', () => {
  let state = canonical(fresh(), '秘密', [report('note_root', '秘密')]);
  state = canonical(state, '你的想法', [note('note_hidden')]);
  state = turn(state, '忘掉第一条', [remove('memory_1')]);
  assert.deepEqual(R.context(state).memoryCapacity.withheld, [{ id: 'memory_2' }]);
  const corrected = turn(state, '新的明确事实', [report('memory_2', '新的明确事实')]);
  assert.deepEqual(savedIds(corrected), ['note_hidden']);
  assert.equal(corrected.memories[0].currentRevision.number, 2);
  assert.deepEqual(R.context(corrected).memories.map(memory => memory.body), ['新的明确事实']);
  assert.equal(turn(state, '忘掉剩下的一条', [remove('memory_2')]).memories.length, 0);
  roundTrip(corrected);
});

test('invalid plans roll back allocation and cannot weaken normal validation or proposal binding', () => {
  const state = fresh(), candidate = R.propose(state, { text: '当前事实' }), before = JSON.stringify(state);
  const valid = plan([report('note_new', '当前事实')]);
  const failures = [
    [plan([note('note_new'), { type: 'world.remove', target: 'missing' }]), 'TARGET_MISSING'],
    [plan([note('note_new'), report('note_second', '不是当前事实')]), 'MEMORY_SUPPORT_INVALID'],
    [plan([note('note_new', '想法', { evidence: '错误证据' })]), 'EVIDENCE_INVALID'],
    [plan([note('note_' + 'x'.repeat(33))]), 'OPERATION_INVALID'],
    [plan([note('note_new', '想法', { generation: 1 })]), 'OPERATION_INVALID'],
    [{ ...valid, model: true }, 'PLAN_INVALID'],
    [{ ...valid, beats: [{ afterLine: 1, operations: [note('note_new')] }] }, 'BEATS_INVALID'],
    [plan(Array.from({ length: 13 }, (_, index) => note('note_' + index))), 'OPERATION_CAPACITY']
  ];
  for (const [requested, code] of failures) {
    const result = R.commitModel(state, candidate, requested);
    assert.equal(result.error.code, code);
    assert.equal(result.state, undefined); assert.equal(result.frames, undefined);
    assert.equal(JSON.stringify(state), before);
  }
  const accepted = R.commitModel(state, candidate, valid);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.error));
  assert.deepEqual(savedIds(accepted.state), ['note_local_1']);
  assert.deepEqual(R.commitModel(state, candidate, valid).state, accepted.state, 'retry allocation is deterministic');
  assert.equal(R.commitModel(accepted.state, candidate, valid).error.code, 'STALE_PROPOSAL');
  assert.equal(R.commitModel(state, clone(candidate), valid).error.code, 'STALE_PROPOSAL');
  assert.equal(R.commitModel(clone(state), candidate, valid).error.code, 'STATE_INVALID');
});

test('a colliding new alias at full capacity cannot overwrite a note to bypass the bound', () => {
  let state = canonical(fresh(), '初始笔记', Array.from({ length: 12 }, (_, index) => note('note_' + index)));
  state = canonical(state, '补足笔记', [note('note_12'), note('note_13')]);
  const before = JSON.stringify(state);
  assert.equal(commit(state, '新笔记', [note('note_0')]).error.code, 'MEMORY_CAPACITY');
  assert.equal(JSON.stringify(state), before);
  const revised = turn(state, '修正现有笔记', [note('memory_1')]);
  assert.equal(revised.memories.length, 14);
  assert.equal(revised.memories[0].currentRevision.number, 2);
});

test('placement retries allocate the same IDs and store replayable canonical geometry', () => {
  const cloud = { type: 'world.create', object: { label: '云', glyphs: 'CCCCCCCCCCCC\nCCCCCCCCCCCC\nCCCCCCCCCCCC', scale: 3 }, placement: { anchor: 'sky' } };
  const state = fresh(), candidate = R.propose(state, { text: '加两朵大云' });
  const requested = { schema: C.SCHEMA, topic: null, lines: ['第一朵。', '第二朵。'], beats: [
    { afterLine: 0, operations: [note('note_cloud'), cloud] },
    { afterLine: 1, operations: [note('note_cloud', '两朵云'), cloud, note('note_second')] }
  ] };
  const result = R.commitModel(state, candidate, requested);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(savedIds(result.state), ['note_local_1', 'note_local_1', 'note_local_2']);
  assert.deepEqual(result.state.world.objects.map(({ x, y }) => ({ x, y })), [{ x: 4, y: 6 }, { x: 40, y: 6 }]);
  assert.deepEqual(R.commitModel(state, candidate, requested).state, result.state);
  roundTrip(result.state);
});

test('canonical commits preserve historical stable IDs and frozen model fixture replay', () => {
  let canonicalState = R.create(P.get(fixture.pack)), modelState = R.create(P.get(fixture.pack));
  const before = JSON.stringify(fixture);
  for (const record of fixture.records) {
    assert.equal(crypto.createHash('sha256').update(record.raw).digest('hex'), record.sha256);
    const requested = JSON.parse(record.raw);
    const canonicalResult = R.commit(canonicalState, R.propose(canonicalState, { text: record.input }), requested);
    const modelResult = R.commitModel(modelState, R.propose(modelState, { text: record.input }), requested);
    assert.equal(canonicalResult.ok, true, JSON.stringify(canonicalResult.error));
    assert.equal(modelResult.ok, true, JSON.stringify(modelResult.error));
    canonicalState = canonicalResult.state; modelState = modelResult.state;
    assert.deepEqual(R.context(canonicalState), R.context(modelState), 'opaque model context is independent of canonical note allocation');
    roundTrip(canonicalState); roundTrip(modelState);
  }
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(canonicalState.events[0].plan.beats[1].operations[0].id, 'note_wind_preference');
  assert.equal(modelState.events[0].plan.beats[1].operations[0].id, 'note_local_1');
  const old = canonical(fresh(), '旧记录', [note('note_stable')]);
  const revised = canonical(old, '更正', [note('note_stable', '更正的记录')]);
  assert.equal(revised.memories.length, 1);
  assert.equal(revised.memories[0].currentRevision.number, 2);
  roundTrip(revised);
  const tampered = clone(R.serialize(modelState));
  tampered.events[0].plan.beats[1].operations[0].id = 'memory_1';
  assert.equal(R.restore(tampered, modelState.pack).error.code, 'EVENT_INVALID', 'saved handles must never trigger model alias resolution');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const O = require('../framework/offline.js');
const M = require('../framework/memory-policy.js');
const clone = value => JSON.parse(JSON.stringify(value));
const pack = () => P.get('lantern-lab');
const priorPack = () => { const value = pack(); delete value.nodes.find(node => node.id === 'make').completion.existing; return value; };
const shape = { label: '长椅', glyphs: '[____]', x: 20, y: 35, scale: 1 };
const create = () => ({ type: 'world.create', object: clone(shape) });
const purpose = () => ({ type: 'story.answer', questionId: 'q_purpose', value: '我想在这里读书' });
const plan = (operations, topic = null) => ({ schema: 'her-world-turn-v2', lines: ['好。'], beats: operations.length ? [{ afterLine: 0, operations }] : [], topic });
function commit(state, input, value) {
  const result = R.commit(state, R.propose(state, { text: input }), value);
  assert.equal(result.ok, true, JSON.stringify(result.error)); return result;
}
const turn = (state, input, operations = [], topic = null) => commit(state, input, plan(operations, topic)).state;
const command = (state, input) => commit(state, input, O.respond(R.context(state), input)).state;
function roundTrip(state) {
  const result = R.restore(R.serialize(state), state.pack);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(result.state, state); return result.state;
}

test('the existing-state opt-in is a closed author predicate only for untargeted creation nodes', () => {
  assert.equal(R.validatePack(pack()).ok, true);
  for (const completion of [
    { type: 'operation', operation: 'world.create', existing: true },
    { type: 'operation', operation: 'world.create', existing: 'any-history' },
    { type: 'operation', operation: 'world.create', existing: 'created-object', target: 'window' },
    { type: 'operation', operation: 'world.update', existing: 'created-object' },
    { type: 'answer', existing: 'created-object' },
    { type: 'ui', panel: 'world', existing: 'created-object' },
    { type: 'operation', operation: 'world.create', existing: 'created-object', expression: 'true' }
  ]) {
    const value = pack(); value.nodes[1].completion = completion;
    assert.equal(R.validatePack(value).ok, false, JSON.stringify(completion));
  }
});

test('create before answering recognizes the extant controlled object without a second creation or UI credit', () => {
  let state = command(R.create(pack()), '/新建 长椅');
  const original = clone(state.world.objects[0]);
  assert.deepEqual(state.story.completed, []);
  state = command(roundTrip(state), '/回答 我想在这里读书');
  assert.deepEqual(state.story.completed, ['purpose', 'make']);
  assert.equal(R.view(state).activeQuestionId, 'q_inspect');
  assert.equal(state.facts.world_seen, undefined);
  assert.deepEqual(state.world.objects, [original]);
  assert.deepEqual(state.events.map(event => event.completionVersion), [2, 2]);
  const proof = state.recall.records[state.recall.bindings[M.recordIds.fact('object_made')]];
  assert.deepEqual(proof.ownSources.map(ref => ref.eventId), ['event_1', 'event_2']);
  roundTrip(state);
});

test('reverse-order compound actions settle only at their accepted sentence and replay identical frames', () => {
  const initial = R.create(pack());
  const value = { schema: 'her-world-turn-v2', topic: 'purpose', lines: ['放一张长椅。', '看看它。', '在这里读书。'], beats: [
    { afterLine: 0, operations: [create()] }, { afterLine: 2, operations: [purpose()] }
  ] };
  const result = commit(initial, '先放一张长椅，我想在这里读书', value);
  assert.equal(result.frames[0].world.objects.length, 1);
  assert.deepEqual(result.frames[0].story.completed, []);
  assert.deepEqual(result.frames[1].story.completed, []);
  assert.deepEqual(result.frames[2].story.completed, ['purpose', 'make']);
  assert.equal(result.frames[2].facts.world_seen, undefined);
  for (let line = 0; line < 3; line++) assert.deepEqual(R.view(result.state, { event: 0, line }), result.frames[line]);
  roundTrip(result.state);
  const sameSentence = turn(initial, '先放一张长椅，我想在这里读书', [create(), purpose()], 'purpose');
  assert.deepEqual(sameSentence.story.completed, ['purpose', 'make']);
  roundTrip(sameSentence);
});

test('objects removed before a prerequisite is accepted do not satisfy current-state completion', () => {
  let state = command(R.create(pack()), '/新建 长椅');
  state = command(state, '/删除 obj_1');
  state = command(state, '/回答 我想在这里读书');
  assert.equal(state.world.objects.length, 0);
  assert.deepEqual(state.story.completed, ['purpose']);
  assert.equal(R.view(state).activeQuestionId, 'q_make');
  const together = turn(R.create(pack()), '先造再删，想在这里读书', [create(), { type: 'world.remove', target: 'obj_1' }, purpose()], 'purpose');
  assert.deepEqual(together.story.completed, ['purpose']);
  roundTrip(together);
});

test('legacy snapshot objects and forged source fields cannot satisfy the opt-in', () => {
  const snapshot = { origin: { type: 'legacy-v3', version: '0.5.4', milestones: [] }, world: {
    objects: [{ id: 'obj_1', ...shape, source: { createdBy: '旧物件', lastChangedBy: '旧物件' } }],
    annotations: {}, weather: { kind: 'rain', name: '窗外天气', intensity: 0, paused: true, source: null }
  }, memories: [], transcript: [], facts: {} };
  const imported = R.importLegacy(snapshot, pack()); assert.equal(imported.ok, true);
  const state = command(imported.state, '/回答 我想在这里读书');
  assert.deepEqual(state.story.completed, ['purpose']);
  assert.equal(state.world.objects[0].source.createdEventId, 'legacy');
  roundTrip(state);
  const forged = clone(snapshot); forged.world.objects[0].source.createdEventId = 'event_1';
  assert.equal(R.importLegacy(forged, pack()).ok, false);
  assert.equal(R.commit({ ...state }, R.propose(state, { text: '继续' }), plan([])).error.code, 'STATE_INVALID');
});

test('unmarked operation nodes still require a new matching successful operation', () => {
  const value = pack(); value.nodes.push({ id: 'future_make', topic: 'making', requires: { purpose_known: true }, question: { id: 'q_future_make', text: '现在再添一个。', kind: 'open' }, completion: { type: 'operation', operation: 'world.create' }, sets: { future_made: true } });
  let state = turn(R.create(value), '先造物', [create()]);
  state = turn(state, '读书', [purpose()], 'purpose');
  assert.equal(state.facts.object_made, true);
  assert.equal(state.facts.future_made, undefined);
  state = turn(state, '继续聊');
  assert.equal(state.facts.future_made, undefined);
  state = turn(state, '再造一个', [create()]);
  assert.equal(state.facts.future_made, true);
  roundTrip(state);
});

test('accepted-answer boundaries and whole-turn rollback remain necessary', () => {
  const initial = turn(R.create(pack()), '造物', [create()]);
  for (const value of [
    plan([purpose()]),
    plan([purpose(), { type: 'story.answer', questionId: 'q_route', value: 'stay' }], 'purpose'),
    plan([purpose(), { type: 'world.remove', target: 'obj_missing' }], 'purpose')
  ]) {
    const rejected = R.commit(initial, R.propose(initial, { text: '读书' }), value);
    assert.equal(rejected.ok, false); assert.equal(rejected.frames, undefined);
    assert.deepEqual(initial.story.completed, []);
  }
  const state = turn(initial, '随便聊聊');
  assert.deepEqual(state.story.completed, []);
});

test('a prior panel visit cannot pre-credit newly unlocked discovery or answer gates', () => {
  let state = turn(R.create(pack()), '造物', [create()]);
  state = R.observe(state, { type: 'panel.viewed', panel: 'world', questionIds: [] });
  state = turn(state, '读书', [purpose()], 'purpose');
  assert.equal(state.facts.world_seen, undefined);
  state = R.observe(state, { type: 'panel.viewed', panel: 'world', questionIds: [] });
  assert.equal(state.facts.world_seen, undefined);
  state = R.observe(state, { type: 'panel.viewed', panel: 'world', questionIds: ['q_inspect'] });
  assert.equal(state.facts.world_seen, true);
  assert.equal(state.facts.route_chosen, undefined);
  assert.equal(R.view(state).activeQuestionId, 'q_route');
  roundTrip(state);
});

test('a fresh actual UI discovery can unlock an existing-state node without fabricating the next visit', () => {
  const value = pack(), make = value.nodes.find(node => node.id === 'make'), inspect = value.nodes.find(node => node.id === 'inspect');
  make.requires = { records_seen: true };
  value.nodes = [{ id: 'read', topic: 'purpose', requires: {}, question: { id: 'q_read', text: '打开日志。', kind: 'open' }, completion: { type: 'ui', panel: 'logs' }, sets: { records_seen: true } }, make, inspect];
  let state = turn(R.create(value), '先造长椅', [create()]);
  const early = R.observe(state, { type: 'panel.viewed', panel: 'logs', questionIds: [] });
  assert.deepEqual(early.story.completed, []);
  state = R.observe(early, { type: 'panel.viewed', panel: 'logs', questionIds: ['q_read'] });
  assert.deepEqual(state.story.completed, ['read', 'make']);
  assert.equal(state.facts.world_seen, undefined);
  assert.equal(state.events.at(-1).completionVersion, 2);
  assert.deepEqual(state.events.at(-1).questionIds, ['q_read']);
  const proof = state.recall.records[state.recall.bindings[M.recordIds.fact('object_made')]];
  assert(proof.ownSources.some(ref => ref.eventId === 'event_1' && ref.channel === 'player'));
  assert(proof.ownSources.some(ref => ref.eventId === 'event_3' && ref.channel === 'operation'));
  assert.throws(() => R.observe(state, { type: 'panel.viewed', panel: 'world', completionVersion: 2 }), /OBSERVATION_INVALID/);
  roundTrip(state);
  const downgraded = clone(R.serialize(state)); delete downgraded.events[2].completionVersion;
  assert.equal(R.restore(downgraded, value).error.code, 'EVENT_INVALID');
});

test('newly eligible authored predicates settle through a bounded chain while ordinary nodes stay pending', () => {
  const value = pack();
  value.nodes.splice(2, 0, { id: 'already_furnished', topic: 'making', requires: { object_made: true }, question: { id: 'q_furnished', text: '确认已有造物。', kind: 'open' }, completion: { type: 'operation', operation: 'world.create', existing: 'created-object' }, sets: { furnished: true } });
  let state = turn(R.create(value), '先造物', [create()]);
  state = turn(state, '读书', [purpose()], 'purpose');
  assert.deepEqual(state.story.completed, ['purpose', 'make', 'already_furnished']);
  assert.equal(state.facts.world_seen, undefined);
  roundTrip(state);
});

test('new prerequisite answers may recognize successful old creations, but migration never completes them by itself', () => {
  const old = turn(R.create(priorPack()), '旧的成功造物', [create()]);
  const raw = clone(R.serialize(old)), original = JSON.stringify(raw);
  assert.equal(raw.pack.digest, 'd11120d9');
  const restored = R.restore(raw, pack()); assert.equal(restored.ok, true, JSON.stringify(restored.error));
  assert.deepEqual(restored.migration, { type: 'current-object-completion-v2', fromRulesVersion: '4', toRulesVersion: '4', fromPackDigest: 'd11120d9', toPackDigest: 'cae92e8e' });
  assert.deepEqual(restored.state.story, old.story);
  assert.deepEqual(restored.state.events, old.events);
  assert.deepEqual(restored.state.world, old.world);
  assert.equal(JSON.stringify(raw), original);
  let state = turn(restored.state, '随便聊聊');
  assert.deepEqual(state.story.completed, []);
  state = turn(state, '现在明确想在这里读书', [purpose()], 'purpose');
  assert.deepEqual(state.story.completed, ['purpose', 'make']);
  assert.deepEqual(state.world.objects[0].source, old.world.objects[0].source);
  assert.equal(R.view(state, { event: 0, line: 0 }).facts.object_made, undefined);
  roundTrip(state);
});

test('old already-pending progress and historical cursors remain exact through restore and idle turns', () => {
  let old = turn(R.create(priorPack()), '旧的成功造物', [create()]);
  old = turn(old, '旧的用途回答', [purpose()], 'purpose');
  assert.deepEqual(old.story.completed, ['purpose']);
  const restored = R.restore(R.serialize(old), pack()); assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.story, old.story);
  assert.deepEqual(restored.state.facts, old.facts);
  assert.deepEqual(restored.state.events, old.events);
  let state = turn(restored.state, '你好');
  state = turn(state, '只把已有长椅移开', [{ type: 'world.update', target: 'obj_1', changes: { x: 30 } }]);
  assert.deepEqual(state.story, old.story);
  assert.equal(R.view(state).activeQuestionId, 'q_make');
  assert.deepEqual(R.view(state, { event: 1, line: 0 }).story, old.story);
  roundTrip(state);
  state = turn(state, '现在再造一个', [create()]);
  assert.deepEqual(state.story.completed, ['purpose', 'make']);
  roundTrip(state);
});

test('old completed progress stays completed without inventing new completion or source evidence', () => {
  let old = turn(R.create(priorPack()), '读书', [purpose()], 'purpose');
  old = turn(old, '造物', [create()]);
  old = R.observe(old, { type: 'panel.viewed', panel: 'world', questionIds: ['q_inspect'] });
  old = turn(old, '留在这里', [{ type: 'story.answer', questionId: 'q_route', value: 'stay' }], 'route');
  const result = R.restore(R.serialize(old), pack()); assert.equal(result.ok, true);
  assert.deepEqual(result.state.story, old.story);
  assert.deepEqual(result.state.facts, old.facts);
  assert.deepEqual(result.state.recall, old.recall);
  assert.deepEqual(result.state.events, old.events);
  roundTrip(result.state);
});

test('new completion markers are local, prefix-monotonic, and cannot be injected into predecessor saves', () => {
  const initial = R.create(pack()), candidate = R.propose(initial, { text: '造物' });
  assert.equal(R.commit(initial, candidate, { ...plan([create()]), completionVersion: 2 }).error.code, 'PLAN_INVALID');
  assert.equal(R.commit(initial, candidate, plan([{ ...create(), completionVersion: 2 }])).error.code, 'OPERATION_INVALID');
  let state = turn(initial, '造物', [create()]); state = turn(state, '随便聊聊');
  const saved = clone(R.serialize(state));
  for (const marker of [0, 1, 3, '2', null]) { const invalid = clone(saved); invalid.events[0].completionVersion = marker; assert.equal(R.restore(invalid, pack()).error.code, 'EVENT_INVALID'); }
  const downgraded = clone(saved); delete downgraded.events[1].completionVersion;
  assert.equal(R.restore(downgraded, pack()).error.code, 'EVENT_INVALID');
  const historical = clone(R.serialize(turn(R.create(priorPack()), '旧造物', [create()])));
  historical.events[0].completionVersion = 2;
  assert.equal(R.restore(historical, pack()).error.code, 'EVENT_INVALID');
});

test('content migration requires both exact predecessor and exact authored successor pack digests', () => {
  const saved = R.serialize(turn(R.create(priorPack()), '旧造物', [create()]));
  for (const change of [value => value.title += '改动', value => value.nodes[1].completion.existing = undefined, value => value.nodes[1].question.text += '改动']) {
    const value = pack(); change(value); assert.equal(R.restore(saved, value).ok, false);
  }
  const unknown = clone(saved); unknown.pack.digest = '00000000';
  assert.equal(R.restore(unknown, pack()).error.code, 'PACK_MISMATCH');
  const crossed = clone(saved); crossed.pack.id = 'rain-lab';
  assert.equal(R.restore(crossed, pack()).error.code, 'PACK_MISMATCH');
  for (const malformed of [['4'], 4, {}, null, '__proto__']) {
    const invalid = clone(saved); invalid.pack.rulesVersion = malformed;
    assert.equal(R.restore(invalid, pack()).error.code, 'PACK_MISMATCH');
  }
});

test('existing-object completion has one local audit reason in the same accepted sentence frame', () => {
  const initial = turn(R.create(pack()), '原始来源句不复制进完成日志', [create()]);
  const value = { schema: 'her-world-turn-v2', topic: 'purpose', lines: ['先想想。', '在这里读书。', '继续看一看。'], beats: [{ afterLine: 1, operations: [purpose()] }] };
  const result = commit(initial, '明确回答用途的句子', value), audit = view => view.logs.filter(log => log.kind === 'story_completion');
  assert.deepEqual(audit(result.frames[0]), []);
  assert.equal(result.frames[0].facts.object_made, undefined);
  const expected = { id: 'event_2.completion.make', kind: 'story_completion', text: '采用已创建物件 obj_1 完成节点 make（创建 event_1，触发 event_2）', eventId: 'event_2', source: null, reason: 'created-object', nodeId: 'make', objectId: 'obj_1', creatorEventId: 'event_1', triggerEventId: 'event_2' };
  assert.deepEqual(audit(result.frames[1]), [expected]);
  assert.equal(result.frames[1].facts.object_made, true);
  assert.deepEqual(audit(result.frames[2]), [expected]);
  assert.deepEqual(audit(R.view(result.state, { event: 1, line: 1 })), [expected]);
  assert.equal(Object.hasOwn(R.context(result.state), 'logs'), false);
  assert.equal(JSON.stringify(expected).includes('原始来源句'), false);
  const idle = turn(result.state, '继续聊聊');
  assert.deepEqual(audit(R.view(idle)), [expected]);
  roundTrip(idle);
});

test('unmarked historical replay keeps its exact audit logs without retroactive completion reasons', () => {
  let old = turn(R.create(priorPack()), '旧的创建来源', [create()]);
  old = turn(old, '旧的用途回答', [purpose()], 'purpose');
  const original = clone(R.serialize(old)), restored = R.restore(original, pack());
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.logs, old.logs);
  assert.deepEqual(R.view(restored.state, { event: 1, line: 0 }).logs, R.view(old, { event: 1, line: 0 }).logs);
  assert.equal(restored.state.logs.some(log => log.kind === 'story_completion'), false);
  const idle = turn(restored.state, '闲聊不会补记完成原因');
  assert.deepEqual(idle.logs.slice(0, old.logs.length), old.logs);
  assert.equal(idle.logs.some(log => log.kind === 'story_completion'), false);
  assert.deepEqual(R.serialize(old), original);
  roundTrip(idle);
});

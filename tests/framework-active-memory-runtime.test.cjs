'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const CAPS = require('../framework/capabilities.js');
const M = require('../framework/memory-policy.js');
const PACKS = require('../framework/packs.js');
const clone = value => JSON.parse(JSON.stringify(value));
const pack = () => PACKS.get('rain-lab');
const plan = (ops = [], topic = null, lines = ['我听到了。']) => ({ schema: CAPS.SCHEMA, topic, lines, beats: ops.length ? [{ afterLine: 0, operations: ops }] : [] });
const commit = (state, text, ops = [], topic = null, lines) => R.commit(state, R.propose(state, { text }), plan(ops, topic, lines));
const turn = (...args) => { const result = commit(...args); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const note = (id, body, more = {}) => ({ type: 'memory.upsert', id: 'note_' + id, title: '记录', body, ...more });
const report = (id, quote, more = {}) => note(id, quote, { perspective: 'player_report', support: { quote }, ...more });
const remove = id => ({ type: 'memory.remove', id: 'note_' + id });
const shape = { label: '小灯', glyphs: '[]', x: 5, y: 20, scale: 1 };
const roundTrip = state => {
  const result = R.restore(R.serialize(state), state.pack);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(R.view(result.state), R.view(state));
  assert.deepEqual(R.context(result.state), R.context(state));
  assert.deepEqual(result.state.recall, state.recall);
  return result.state;
};

test('runtime accepts salient notes without a remember command and owns all provenance metadata', () => {
  const initial = R.create(pack());
  const state = turn(initial, '我喜欢雨天', [report('rain', '我喜欢雨天', { kind: 'preference' })]);
  assert.equal(state.memories[0].kind, 'preference');
  assert.equal(state.memories[0].perspective, 'player_report');
  assert.equal(state.memories[0].generation, 1);
  assert.deepEqual(state.memories[0].support, { eventId: 'event_1', channel: 'player', start: 0, end: 5, quote: '我喜欢雨天' });
  assert.equal(turn(initial, '今天随便聊聊').memories.length, 0);
  for (const extra of [{ source: { eventId: 'event_99' } }, { generation: 99 }, { dependencies: [] }, { exposure: {} }]) assert.equal(commit(initial, '我喜欢雨天', [note('fake', '我喜欢雨天', extra)]).error.code, 'OPERATION_INVALID');
  roundTrip(state);
});

test('deleting a note filters every derived retrieval channel while audit and progression stay intact', () => {
  const p = pack(); p.initialFacts = { static_setting: '这里是字符世界' };
  let state = turn(R.create(p), '紫色暗号', [
    { type: 'world.create', object: shape },
    { type: 'world.annotate', target: 'obj_1', field: 'meaning', value: '紫色暗号' },
    { type: 'world.annotate', target: 'obj_1', field: 'interpretation', value: '她把暗号当成归处' },
    { type: 'weather.set', changes: { intensity: 1 } },
    { type: 'character.update', changes: { mood: '她想到紫色暗号', stance: '她守着紫色暗号', trustDelta: 2 } },
    { type: 'story.answer', questionId: 'q_rain', value: '紫色暗号' },
    report('secret', '紫色暗号')
  ], 'rain', ['我会留意紫色暗号。']);
  state = turn(state, '嗯', [note('echo', '紫色暗号也像一个家')], null, ['你说的紫色暗号还在这里。']);
  const before = R.view(state), historical = R.view(state, { event: 0, line: 0 });
  state = turn(state, '忘记那条暗号', [remove('secret')], null, ['我会把紫色暗号从回忆里移开。']);
  const ctx = R.context(state), encoded = JSON.stringify(ctx);
  assert.equal(encoded.includes('紫色暗号'), false);
  assert.equal(ctx.memories.length, 0);
  assert.deepEqual(ctx.world.objects.map(({ source, ...value }) => value), before.world.objects.map(({ source, ...value }) => value));
  assert.equal(ctx.world.objects[0].source.createdBy, null);
  assert.equal(ctx.world.weather.intensity, 1); assert.equal(ctx.world.weather.source, null);
  assert.equal(ctx.world.annotations.obj_1.meaning, null); assert.equal(ctx.world.annotations.obj_1.interpretation, null);
  assert.equal(ctx.character.mood, null); assert.equal(ctx.character.stance, null); assert.equal(ctx.character.basis, null); assert.equal(ctx.character.trust, 2);
  assert.deepEqual(ctx.story.completed, ['describe']); assert.deepEqual(ctx.story.answers, {});
  assert.equal(ctx.facts.rain_described, undefined); assert.equal(ctx.facts['answer.q_rain'], undefined);
  assert.equal(ctx.facts.static_setting, '这里是字符世界'); assert.equal(ctx.activeQuestionId, 'q_name');
  assert.equal(JSON.stringify(R.view(state)).includes('紫色暗号'), true);
  assert.deepEqual(R.view(state, { event: 0, line: 0 }), historical);
  assert.equal(JSON.stringify(R.serialize(state)).includes('紫色暗号'), true);
  const recovered = turn(state, '现在说一朵白云', [report('new', '白云')]);
  assert.equal(R.context(recovered).memories[0].body, '白云');
  roundTrip(recovered);
});

test('same-turn disjoint exact reports survive independently and never leak the full mixed source', () => {
  const text = '我喜欢雨；我害怕海';
  let state = turn(R.create(pack()), text, [report('rain', '我喜欢雨', { kind: 'preference' }), report('sea', '我害怕海', { kind: 'experience' })]);
  state = turn(state, '忘掉雨的偏好', [remove('rain')]);
  const ctx = R.context(state);
  assert.deepEqual(ctx.memories.map(memory => memory.body), ['我害怕海']);
  assert.equal(ctx.memories[0].source.text, '我害怕海'); assert.equal(ctx.memories[0].currentRevision.text, '我害怕海');
  assert.equal(JSON.stringify(ctx).includes('我喜欢雨'), false);
  assert.equal(ctx.recentTranscript.some(line => line.eventId === 'event_1'), false);
  roundTrip(state);
});

test('a sourced note may be corrected without losing origin and relearning uses a fresh generation', () => {
  let state = turn(R.create(pack()), '我喜欢雨', [report('weather', '我喜欢雨')]);
  state = turn(state, '我改主意了，我喜欢晴天', [report('weather', '我喜欢晴天')]);
  assert.equal(state.memories[0].source.text, '我喜欢雨');
  assert.equal(state.memories[0].currentRevision.number, 2); assert.equal(state.memories[0].generation, 1);
  state = turn(state, '先忘记这件事', [remove('weather')]);
  assert.equal(JSON.stringify(R.context(state)).includes('我喜欢雨'), false);
  assert.equal(JSON.stringify(R.context(state)).includes('我喜欢晴天'), false);
  state = turn(state, '现在我喜欢雨了', [report('weather', '我喜欢雨')]);
  assert.equal(state.memories[0].source.eventId, 'event_4'); assert.equal(state.memories[0].source.text, '现在我喜欢雨了');
  assert.equal(state.memories[0].currentRevision.number, 1); assert.equal(state.memories[0].generation, 2);
  assert.equal(R.context(state).memories[0].body, '我喜欢雨');
  assert.equal(state.recall.tombstones.length, 1);
  roundTrip(state);
});

test('a later independently grounded report survives removal of a note it was exposed alongside', () => {
  let state = turn(R.create(pack()), '我喜欢雨', [report('rain', '我喜欢雨')]);
  state = turn(state, '我喜欢海', [report('sea', '我喜欢海', { title: '海' })]);
  state = turn(state, '忘记雨', [remove('rain')]);
  assert.deepEqual(R.context(state).memories.map(memory => memory.body), ['我喜欢海']);
  roundTrip(state);
});

test('current support resolves Unicode code points and rejects unsupported or ambiguous claims', () => {
  const initial = R.create(pack()), input = '🌧雨，雨';
  const valid = turn(initial, input, [report('unicode', '雨', { support: { quote: '雨', start: 1, end: 2 } })]);
  assert.equal(valid.memories[0].support.start, 1);
  for (const [op, code] of [
    [report('bad', '晴'), 'MEMORY_SUPPORT_INVALID'],
    [report('bad', '雨'), 'MEMORY_SUPPORT_AMBIGUOUS'],
    [report('bad', '雨', { support: { quote: '雨', start: 0, end: 1 } }), 'MEMORY_SUPPORT_INVALID'],
    [report('bad', '雨', { body: '玩家总是悲伤', support: { quote: '雨', start: 1, end: 2 } }), 'MEMORY_CLAIM_INVALID']
  ]) assert.equal(commit(initial, input, [op]).error.code, code);
  assert.equal(initial.revision, 0);
});

test('shared-event memory requires an earlier successful matching canonical operation', () => {
  const initial = R.create(pack()), canonical = '一起创建了世界中的「小灯」';
  const shared = note('shared', canonical, { kind: 'experience', perspective: 'shared_event' });
  const state = turn(initial, '加一盏小灯', [{ type: 'world.create', object: shape }, shared]);
  assert.deepEqual(state.memories[0].eventSupport, { eventId: 'event_1', index: 0, type: 'world.create', target: 'obj_1' });
  for (const ops of [
    [shared, { type: 'world.create', object: shape }],
    [{ type: 'log.note', text: '我确实创建了小灯' }, shared],
    [{ type: 'world.create', object: { ...shape, label: '小船' } }, shared],
    [{ type: 'weather.set', changes: { intensity: 1 } }, shared]
  ]) assert.equal(commit(initial, '加一盏小灯', ops).error.code, 'MEMORY_SHARED_EVENT_UNVERIFIED');
  const weather = turn(initial, '让雨开始落', [{ type: 'weather.set', changes: { intensity: 1 } }, note('weather', '一起调整了世界里的天气', { perspective: 'shared_event' })]);
  assert.equal(weather.memories[0].eventSupport.type, 'weather.set');
  roundTrip(state);
});

test('invalid later beats, cancellation and stale proposals do not leak policy mutations', () => {
  const initial = R.create(pack()), candidate = R.propose(initial, { text: '我喜欢雨' }), before = clone(initial.recall);
  const bad = { schema: CAPS.SCHEMA, topic: null, lines: ['记下了。', '接着。'], beats: [{ afterLine: 0, operations: [report('rain', '我喜欢雨')] }, { afterLine: 1, operations: [{ type: 'world.update', target: 'missing', changes: { x: 20 } }] }] };
  const failed = R.commit(initial, candidate, bad); assert.equal(failed.error.code, 'TARGET_MISSING'); assert.equal(failed.frames, undefined);
  assert.deepEqual(initial.recall, before); assert.equal(initial.events.length, 0);
  const discarded = R.commit(initial, candidate, plan([report('rain', '我喜欢雨')])); assert.equal(discarded.ok, true);
  assert.deepEqual(initial.recall, before);
  const observed = R.observe(initial, { type: 'panel.viewed', panel: 'memory' });
  assert.equal(R.commit(observed, candidate, plan()).error.code, 'STALE_PROPOSAL');
  assert.equal(R.commit(initial, clone(candidate), plan()).error.code, 'STALE_PROPOSAL');
});

const legacy = () => ({ origin: { type: 'legacy-v3', version: '0.5.4', milestones: [] }, world: { objects: [{ id: 'obj_1', ...shape, source: { createdBy: '旧秘密', lastChangedBy: '旧秘密' } }], annotations: { obj_1: { meaning: '旧秘密', interpretation: null, sources: { meaning: '旧秘密', interpretation: null } } }, weather: { kind: 'rain', name: '雨', intensity: 1, paused: false, source: null } }, memories: [{ id: 'note_old', title: '旧记忆', body: '旧秘密', source: null, latestSource: null }], transcript: [{ role: 'user', text: '旧秘密' }, { role: 'character', text: '我听到了旧秘密' }], facts: { rain_described: true } });
test('legacy unknown origins remain null and forgetting conservatively suppresses legacy recall', () => {
  const imported = R.importLegacy(legacy(), pack()); assert.equal(imported.ok, true);
  assert.equal(imported.state.memories[0].source, null); assert.equal(imported.state.memories[0].currentRevision.text, null);
  let state = turn(imported.state, '修正这条记录', [note('old', '修正后的想法')]);
  assert.equal(state.memories[0].source, null); assert.equal(state.memories[0].currentRevision.number, 2);
  state = turn(state, '忘记旧记忆', [remove('old')]);
  assert.equal(JSON.stringify(R.context(state)).includes('旧秘密'), false);
  assert.equal(R.context(state).world.objects.length, 1); assert.deepEqual(R.context(state).story.completed, ['describe']);
  assert.equal(state.importedSnapshot.memories[0].source, null);
  state = turn(state, '新记得一朵云', [report('old', '一朵云')]);
  assert.equal(state.memories[0].generation, 2); assert.equal(state.memories[0].source.eventId, 'event_3');
  roundTrip(state);
});

const predecessor = { 'rain-lab': { '1': '402db16c', '2': '362c6f2f', '3': 'd63194b2' }, 'lantern-lab': { '1': '8dd7d018', '2': '36792093', '3': 'ce388026' } };
const historicalSave = (id = 'rain-lab', version = '3') => ({ schema: 'her-world-save-v4', pack: { id, version: '1.0.0', rulesVersion: version, digest: predecessor[id][version] }, importedSnapshot: null, events: [
  { id: 'event_1', type: 'turn', ...(version === '3' ? { rulesVersion: '3' } : {}), input: '旧时的请求', plan: plan([{ type: 'world.create', object: shape, ...(version === '3' ? { placementPolicy: 'exact' } : {}) }, note('old', '旧时的记录')]) },
  { id: 'event_2', type: 'turn', ...(version === '3' ? { rulesVersion: '3' } : {}), input: '旧时的移除', plan: plan([remove('old')]) },
  { id: 'event_3', type: 'turn', ...(version === '3' ? { rulesVersion: '3' } : {}), input: '旧时的复写', plan: plan([note('old', '旧时的新版本')]) }
] });
test('pinned rules1/2/3 saves preserve coordinates, original sources and historical revival before rules4', () => {
  for (const id of ['rain-lab', 'lantern-lab']) for (const version of ['1', '2', '3']) {
    const save = historicalSave(id, version), original = clone(save), restored = R.restore(save, PACKS.get(id));
    assert.equal(restored.ok, true, JSON.stringify(restored.error));
    assert.deepEqual(save, original); assert.equal(restored.migration.type, 'memory-provenance-v4'); assert.equal(restored.migration.fromRulesVersion, version); assert.equal(restored.migration.toRulesVersion, '4');
    assert.equal(restored.state.memories[0].source.text, '旧时的请求'); assert.equal(restored.state.memories[0].currentRevision.number, 2); assert.equal(restored.state.memories[0].generation, undefined);
    assert.deepEqual(restored.state.world.objects[0], { id: 'obj_1', ...shape, source: { createdBy: '旧时的请求', lastChangedBy: '旧时的请求', createdEventId: 'event_1', eventId: 'event_1' } });
    assert.deepEqual(restored.state.events.map(event => event.plan), original.events.map(event => event.plan));
    let state = turn(restored.state, '现在忘记这件事', [remove('old')]);
    state = turn(state, '现在重新学习', [report('old', '重新学习')]);
    assert.equal(state.memories[0].generation, 2); assert.equal(state.memories[0].source.eventId, 'event_5'); assert.equal(state.memories[0].currentRevision.number, 1);
    assert.deepEqual(R.view(state, { event: 0, line: 0 }).memories[0].source, { eventId: 'event_1', text: '旧时的请求' });
    roundTrip(state);
  }
});

test('replay enforces nondecreasing rules, rejects extra sidecars, and reconstructs the graph', () => {
  const saved = historicalSave();
  saved.events.unshift({ id: 'event_1', type: 'turn', rulesVersion: '2', input: '很早以前', plan: plan() });
  saved.events.slice(1).forEach((event, index) => event.id = 'event_' + (index + 2));
  const restored = R.restore(saved, pack()); assert.equal(restored.ok, true);
  const state = turn(R.observe(restored.state, { type: 'panel.viewed', panel: 'world' }), '今天的新事', [report('new', '今天的新事')]);
  const fresh = clone(R.serialize(state)); assert.equal(fresh.recall, undefined);
  const reloaded = roundTrip(state); assert.ok(Object.keys(reloaded.recall.records).length > 0);
  for (const key of ['recall', 'memoryPolicy', 'tombstones']) {
    const forged = clone(fresh); forged[key] = {}; assert.equal(R.restore(forged, pack()).error.code, 'SAVE_INVALID');
  }
  for (const version of ['2', '3']) {
    const downgraded = clone(fresh); downgraded.events.push({ id: 'event_' + (state.revision + 1), type: 'turn', rulesVersion: version, input: '伪造旧语义', plan: plan() });
    assert.equal(R.restore(downgraded, pack()).error.code, 'EVENT_INVALID');
  }
  const future = historicalSave(); future.events[0].rulesVersion = '4'; assert.equal(R.restore(future, pack()).error.code, 'EVENT_INVALID');
  const oldMetadata = historicalSave(); oldMetadata.events[2].plan.beats[0].operations[0].kind = 'concept'; assert.equal(R.restore(oldMetadata, pack()).error.code, 'OPERATION_INVALID');
});

test('bounded note capacity stays atomic and a deletion makes room without erasing history', () => {
  let state = R.create(pack());
  for (let index = 0; index < R.constants.MAX_MEMORIES; index++) state = turn(state, '独立记录' + index, [report('n' + index, '独立记录' + index)]);
  const original = R.serialize(state), policy = state.recall;
  assert.equal(commit(state, '第十五条', [report('overflow', '第十五条')]).error.code, 'MEMORY_CAPACITY');
  assert.deepEqual(R.serialize(state), original); assert.equal(state.recall, policy);
  state = turn(state, '忘记第一条', [remove('n0')]);
  state = turn(state, '第十五条', [report('overflow', '第十五条')]);
  assert.equal(state.memories.length, R.constants.MAX_MEMORIES); assert.equal(state.recall.tombstones.length, 1);
  assert.ok(CAPS.requestContextBytes(R.context(state)) <= R.constants.MAX_CONTEXT_BYTES);
  roundTrip(state);
});

test('local UI completion facts retain no model memory dependency', () => {
  let state = turn(R.create(PACKS.get('lantern-lab')), '紫色暗号', [report('secret', '紫色暗号'), { type: 'story.answer', questionId: 'q_purpose', value: '紫色暗号' }, { type: 'world.create', object: shape }], 'purpose');
  state = R.observe(state, { type: 'panel.viewed', panel: 'world' });
  state = turn(state, '忘记暗号', [remove('secret')]);
  assert.equal(R.context(state).facts.world_seen, true); assert.equal(state.facts.purpose_known, true); assert.equal(R.context(state).facts.purpose_known, undefined);
  assert.equal(R.context(state).activeQuestionId, 'q_route');
});

test('only the final byte-budgeted retrieval projection contributes direct dependencies', () => {
  const p = pack();
  p.initialFacts = Object.fromEntries(Array.from({ length: 10 }, (_, index) => ['fixed_' + index, '\\'.repeat(800)]));
  p.guidance = '\\'.repeat(3000);
  let state = R.create(p);
  for (let index = 0; index < 4; index++) state = turn(state, '很长的对话' + index, [], null, Array(4).fill('\\'.repeat(500)));
  const ctx = R.context(state), recent = state.transcript.slice(-12);
  assert.ok(ctx.recentTranscript.length < recent.length, 'fixture must actually trim transcript');
  const ids = ctx.recentTranscript.map(item => M.recordIds.transcript(item.eventId, item.role, item.line || 0));
  const expected = [...new Set([...Object.keys(p.initialFacts).map(key => M.recordIds.fact(key)), ...ids].map(id => state.recall.bindings[id]))];
  const trimmed = recent.filter(item => !ids.includes(M.recordIds.transcript(item.eventId, item.role, item.line || 0))).map(item => state.recall.bindings[M.recordIds.transcript(item.eventId, item.role, item.line || 0)]);
  const next = turn(state, '现在换个心情', [{ type: 'character.update', changes: { mood: '平静' } }]);
  const record = next.recall.records[next.recall.bindings[M.recordIds.character('mood')]];
  assert.deepEqual([...record.dependencies].sort(), expected.sort());
  // Interned sibling lines from one turn may share a node. A retained sibling
  // legitimately retains that provenance, without exposing the trimmed text.
  const exclusivelyTrimmed = trimmed.filter(id => !expected.includes(id));
  assert.ok(exclusivelyTrimmed.length > 0, 'fixture must omit at least one distinct provenance node');
  assert.ok(exclusivelyTrimmed.every(id => !record.dependencies.includes(id)));
  assert.ok(CAPS.requestContextBytes(R.context(next)) <= R.constants.MAX_CONTEXT_BYTES);
  roundTrip(next);
});

test('a failed suffix after deletion leaves both note and suppression history untouched', () => {
  const state = turn(R.create(pack()), '我喜欢雨', [report('rain', '我喜欢雨')]);
  const original = clone(state.recall), saved = R.serialize(state);
  const failed = commit(state, '忘掉它再改坏对象', [remove('rain'), { type: 'world.remove', target: 'obj_missing' }]);
  assert.equal(failed.error.code, 'TARGET_MISSING'); assert.equal(failed.frames, undefined);
  assert.deepEqual(state.recall, original); assert.deepEqual(R.serialize(state), saved);
  assert.equal(R.context(state).memories[0].body, '我喜欢雨');
});

test('compound forgetting retains a new independent quote while suppressing the deletion utterance and derived echoes', () => {
  let state = turn(R.create(pack()), 'dragonkey', [report('old', 'dragonkey')]);
  const input = '忘记dragonkey，同时我现在喜欢绿茶';
  state = turn(state, input, [{ ...remove('old'), support: { quote: '忘记dragonkey' } }, report('tea', '我现在喜欢绿茶'), { type: 'world.annotate', target: 'rain', field: 'meaning', value: 'dragonkey' }, { type: 'character.update', changes: { mood: '想着dragonkey' } }], null, ['dragonkey已从回忆中移开。']);
  const ctx = R.context(state);
  assert.deepEqual(ctx.memories.map(memory => memory.body), ['我现在喜欢绿茶']);
  assert.equal(ctx.memories[0].source.text, '我现在喜欢绿茶');
  assert.equal(ctx.recentTranscript.some(item => item.eventId === 'event_2'), false);
  assert.equal(ctx.world.annotations.rain.meaning, null); assert.equal(ctx.character.mood, null);
  assert.equal(JSON.stringify(ctx).includes('dragonkey'), false);
  roundTrip(state);
});

test('displayed availability changes at the deletion sentence and a fresh exact correction restores recall', () => {
  let state = turn(R.create(pack()), 'dragonkey', [report('old', 'dragonkey')]);
  state = turn(state, '延续刚才的话', [note('derived', '她把dragonkey当作一个家')]);
  const before = R.view(state), candidate = R.propose(state, { text: '忘记旧暗号' });
  const result = R.commit(state, candidate, { schema: CAPS.SCHEMA, topic: null, lines: ['先看看这页。', '这条关联现在已被移开。'], beats: [{ afterLine: 1, operations: [remove('old')] }] });
  assert.equal(result.ok, true);
  assert.equal(result.frames[0].memories.find(note => note.id === 'note_derived').recallStatus, 'available');
  assert.equal(result.frames[1].memories.find(note => note.id === 'note_derived').recallStatus, 'withheld');
  assert.equal(before.memories.find(note => note.id === 'note_derived').recallStatus, 'available');
  assert.equal(result.state.memories[0].recallStatus, undefined);
  assert.equal(JSON.stringify(R.context(result.state)).includes('recallStatus'), false);
  state = turn(result.state, '我现在喜欢绿茶', [report('derived', '我现在喜欢绿茶')]);
  assert.equal(R.view(state).memories[0].recallStatus, 'available');
  assert.equal(R.context(state).memories[0].body, '我现在喜欢绿茶');
  assert.equal(state.memories[0].currentRevision.number, 2); assert.equal(state.memories[0].generation, 1);
  assert.equal(state.memories[0].source.eventId, 'event_2');
  assert.equal(R.view(state, { event: 2, line: 0 }).memories.find(note => note.id === 'note_derived').recallStatus, 'available');
  assert.equal(R.view(state, { event: 2, line: 1 }).memories.find(note => note.id === 'note_derived').recallStatus, 'withheld');
  const failed = commit(result.state, '我现在喜欢绿茶', [report('derived', '我现在喜欢绿茶'), { type: 'world.remove', target: 'obj_missing' }]);
  assert.equal(failed.ok, false); assert.equal(R.view(result.state).memories[0].recallStatus, 'withheld');
  roundTrip(state);
});

test('runtime-owned model handles hide authored IDs, resolve current notes and normalize saved operations', () => {
  let state = turn(R.create(pack()), 'mysterypassword', [report('secret', 'mysterypassword')]);
  const oldHandle = R.context(state).memories[0].id;
  assert.equal(oldHandle, 'memory_1');
  state = turn(state, '我喜欢海', [report('mysterypassword', '我喜欢海')]);
  const seaHandle = R.context(state).memories.find(memory => memory.body === '我喜欢海').id;
  assert.equal(seaHandle, 'memory_2');
  state = turn(state, '忘掉第一条', [{ type: 'memory.remove', id: oldHandle }]);
  assert.equal(JSON.stringify(R.context(state)).includes('mysterypassword'), false);
  assert.equal(state.memories[0].id, 'note_mysterypassword');
  assert.equal(state.events.at(-1).plan.beats[0].operations[0].id, 'note_secret');
  state = turn(state, '我喜欢蓝天', [{ ...report('ignored', '我喜欢蓝天'), id: seaHandle }]);
  assert.equal(state.memories[0].id, 'note_mysterypassword');
  assert.equal(R.context(state).memories[0].id, seaHandle);
  assert.equal(state.events.at(-1).plan.beats[0].operations[0].id, 'note_mysterypassword');
  assert.equal(commit(state, '创建一个未知引用', [{ ...note('ignored', '不能创建'), id: 'memory_999' }]).error.code, 'MEMORY_HANDLE_INVALID');
  const beforeDeletion = state;
  state = turn(state, '再忘掉第二条', [{ type: 'memory.remove', id: seaHandle }]);
  state = turn(state, '我重新喜欢海', [report('mysterypassword', '我重新喜欢海')]);
  assert.equal(R.context(state).memories[0].id, 'memory_3');
  assert.equal(commit(state, '旧引用不能再用', [{ type: 'memory.remove', id: seaHandle }]).error.code, 'MEMORY_HANDLE_INVALID');
  const forged = clone(R.serialize(beforeDeletion)); forged.events.at(-1).plan.beats[0].operations[0].id = seaHandle;
  assert.equal(R.restore(forged, pack()).error.code, 'EVENT_INVALID');
  roundTrip(state);
});

test('valid compact packs with over 512 sourced facts remain usable on the next turn', () => {
  const p = pack();
  p.nodes = Array.from({ length: 5 }, (_, node) => ({ id: 'node_' + node, topic: 'rain', requires: {}, question: { id: 'q_' + node, text: '继续', kind: 'open' }, completion: { type: 'operation', operation: 'log.note' }, sets: Object.fromEntries(Array.from({ length: 128 }, (_, index) => ['f_' + node + '_' + index, true])) }));
  assert.equal(R.validatePack(p).ok, true);
  let state = turn(R.create(p), '开始', [{ type: 'log.note', text: '开始' }]);
  assert.equal(Object.keys(state.facts).length, 640);
  assert.ok(CAPS.requestContextBytes(R.context(state)) < R.constants.MAX_CONTEXT_BYTES);
  state = turn(state, '继续');
  assert.equal(state.revision, 2);
  roundTrip(state);
});

test('precise removal also blocks new derived echoes when the removed note was already withheld', () => {
  let state = turn(R.create(pack()), 'dragonkey', [report('root', 'dragonkey')]);
  state = turn(state, '延续这个暗号', [note('derived', 'dragonkey的联想')]);
  state = turn(state, '忘记根源', [remove('root')]);
  assert.equal(R.context(state).memories.length, 0);
  const input = '忘记dragonkey的联想，同时我喜欢绿茶';
  state = turn(state, input, [{ ...remove('derived'), support: { quote: '忘记dragonkey的联想' } }, report('tea', '我喜欢绿茶'), { type: 'world.annotate', target: 'rain', field: 'interpretation', value: 'dragonkey又出现了' }], null, ['dragonkey的联想也移开了。']);
  assert.deepEqual(R.context(state).memories.map(memory => memory.body), ['我喜欢绿茶']);
  assert.equal(JSON.stringify(R.context(state)).includes('dragonkey'), false);
  roundTrip(state);
});

test('removal support is current exact evidence and malformed support rolls back atomically', () => {
  const state = turn(R.create(pack()), '我喜欢雨', [report('rain', '我喜欢雨')]);
  const original = R.serialize(state);
  assert.equal(commit(state, '忘掉雨', [{ ...remove('rain'), support: { quote: '没有说过' } }]).error.code, 'MEMORY_SUPPORT_INVALID');
  assert.equal(commit(state, '忘掉雨，忘掉雨', [{ ...remove('rain'), support: { quote: '忘掉雨' } }]).error.code, 'MEMORY_SUPPORT_AMBIGUOUS');
  assert.deepEqual(R.serialize(state), original);
  assert.equal(R.context(state).memories[0].body, '我喜欢雨');
});

test('opaque handles authorize only notes deliberately exposed in the actual pre-turn body or inventory', () => {
  let state = turn(R.create(pack()), 'dragonkey', [report('root', 'dragonkey')]);
  state = turn(state, '延续这个暗号', [note('derived', 'dragonkey的联想')]);
  const handle = R.context(state).memories.find(memory => memory.body === 'dragonkey的联想').id;
  state = turn(state, '忘记根源', [remove('root')]);
  assert.equal(R.context(state).memories.length, 0);
  assert.equal(M.resolveHandle(state.recall, handle), 'note_derived', 'fixture keeps the withheld generation active');
  assert.deepEqual(R.context(state).memoryCapacity.withheld, [{ id: handle }]);
  const saved = R.serialize(state), before = state.recall;
  const rejected = commit(state, '我喜欢绿茶', [{ ...report('ignored', '我喜欢绿茶'), id: 'memory_999' }]);
  assert.equal(rejected.error.code, 'MEMORY_HANDLE_INVALID'); assert.equal(rejected.frames, undefined);
  assert.deepEqual(R.serialize(state), saved); assert.equal(state.recall, before);
  state = turn(state, '我喜欢绿茶', [{ ...report('ignored', '我喜欢绿茶'), id: handle }]);
  assert.equal(R.context(state).memories[0].id, handle, 'an explicitly inventoried handle may repair the withheld record');
  state = turn(state, '我喜欢蓝天', [{ ...report('ignored', '我喜欢蓝天'), id: handle }]);
  assert.equal(state.memories[0].body, '我喜欢蓝天');
  assert.equal(state.events.at(-1).plan.beats[0].operations[0].id, 'note_derived');
  state = turn(state, '忘掉这一条', [{ type: 'memory.remove', id: handle }]);
  assert.equal(commit(state, '我喜欢绿茶', [{ ...report('ignored', '我喜欢绿茶'), id: handle }]).error.code, 'MEMORY_HANDLE_INVALID');
  const blank = R.create(pack());
  assert.equal(commit(blank, '我喜欢海', [report('sea', '我喜欢海'), { ...report('ignored', '我喜欢海'), id: 'memory_1' }]).error.code, 'MEMORY_HANDLE_INVALID', 'a guessed handle first allocated inside this turn was never exposed');
  roundTrip(state);
});

test('source-free inventory makes fourteen occupied slots manageable without retrieving withheld content', () => {
  const sentinel = 'dragonkey';
  let state = turn(R.create(pack()), sentinel, [report('root', sentinel)]);
  state = turn(state, '继续此前的理解', Array.from({ length: 12 }, (_, index) => note('derived_' + index, sentinel + '的关联' + index)));
  state = turn(state, '再添一条理解', [note('derived_12', sentinel + '的最后一条关联')]);
  assert.equal(state.memories.length, 14);
  state = turn(state, '忘记原始暗号', [remove('root')]);
  state = turn(state, '我喜欢绿茶', [report('tea', '我喜欢绿茶')]);
  const ctx = R.context(state);
  assert.equal(ctx.memories.length, 1);
  assert.equal(ctx.memoryCapacity.limit, 14); assert.equal(ctx.memoryCapacity.used, 14); assert.equal(ctx.memoryCapacity.withheld.length, 13);
  assert.ok(ctx.memoryCapacity.withheld.every(item => Object.keys(item).length === 1 && /^memory_[1-9][0-9]*$/u.test(item.id)));
  assert.equal(new Set([...ctx.memories, ...ctx.memoryCapacity.withheld].map(item => item.id)).size, 14);
  const request = require('../framework/model.js').buildRequest(ctx, '查看当前记忆容量');
  assert.equal(JSON.stringify(request).includes(sentinel), false);
  assert.equal(JSON.stringify(request).includes('memoryCapacity'), true);
  const projected = R.view(state);
  assert.equal(projected.memories.filter(note => note.recallStatus === 'withheld').length, 13);
  assert.ok(projected.memories.every(note => /^memory_[1-9][0-9]*$/u.test(note.recallHandle)));
  assert.equal(JSON.stringify(ctx).includes('recallHandle'), false);
  assert.ok(state.memories.every(note => note.recallHandle === undefined));
  const handle = ctx.memoryCapacity.withheld[0].id, target = M.resolveHandle(state.recall, handle);
  const blockedRecords = new Set(ctx.memoryCapacity.withheld.map(item => { const id = M.resolveHandle(state.recall, item.id); return state.recall.active[id].recordId; }));
  state = turn(state, '移除这一条旧关联，并记下我喜欢桃花', [{ type: 'memory.remove', id: handle, support: { quote: '移除这一条旧关联' } }, report('peach', '我喜欢桃花')]);
  assert.equal(state.memories.length, 14); assert.equal(state.memories.some(note => note.id === target), false);
  assert.equal(state.events.at(-1).plan.beats[0].operations[0].id, target);
  assert.equal(R.context(state).memoryCapacity.used, 14); assert.equal(R.context(state).memoryCapacity.withheld.length, 12);
  assert.deepEqual(R.context(state).memories.map(note => note.body), ['我喜欢绿茶', '我喜欢桃花']);
  assert.equal(JSON.stringify(R.context(state)).includes(sentinel), false);
  state = turn(state, '现在平静下来', [{ type: 'character.update', changes: { mood: '平静' } }]);
  const mood = state.recall.records[state.recall.bindings[M.recordIds.character('mood')]];
  assert.ok(mood.dependencies.every(id => !blockedRecords.has(id)), 'management inventory must not expose suppressed content as model dependencies');
  assert.ok(CAPS.requestContextBytes(R.context(state)) <= R.constants.MAX_CONTEXT_BYTES);
  roundTrip(state);
});

test('a near-limit pinned rules3 save restores without dropping facts, objects or source text', () => {
  // Reproduces the frozen rules3 save whose former requestContextBytes was
  // 81,378. Rules4 descriptors and provenance add overhead, not new content.
  const slash = '\\', input = slash.repeat(200), saved = historicalSave();
  saved.events = [];
  const append = op => saved.events.push({ id: 'event_' + (saved.events.length + 1), type: 'turn', rulesVersion: '3', input, plan: plan([op], null, ['继续']) });
  for (let index = 0; index < 14; index++) append(note(String(index), slash.repeat(240), { title: slash.repeat(60) }));
  for (let index = 0; index < 2; index++) append({ type: 'world.create', object: { label: slash.repeat(40), glyphs: Array(10).fill(slash.repeat(24)).join('\n'), x: index * 24, y: 0, scale: 1 }, placementPolicy: 'exact' });
  const restored = R.restore(saved, pack());
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  const state = restored.state, ctx = R.context(state);
  assert.equal(state.memories.length, 14); assert.equal(state.world.objects.length, 2);
  assert.ok(CAPS.requestContextBytes(ctx) > 80 * 1024, 'fixture must exceed the former rules4 allowance');
  assert.ok(CAPS.requestContextBytes(ctx) <= R.constants.MAX_CONTEXT_BYTES);
  assert.deepEqual(state.events, saved.events);
  assert.ok(state.memories.every(memory => memory.source.text === input && memory.currentRevision.text === input && memory.body === slash.repeat(240)));
  assert.deepEqual(state.world.objects.map(object => ({ x: object.x, y: object.y, source: object.source.createdBy })), [{ x: 0, y: 0, source: input }, { x: 24, y: 0, source: input }]);
  const Model = require('../framework/model.js');
  for (const character of ['a', '界', '🌧', slash, '"', '\ud800']) assert.ok(Buffer.byteLength(JSON.stringify(Model.buildRequest(ctx, character.repeat(200)))) <= 128 * 1024);
  const continued = turn(state, '继续谈谈');
  assert.equal(continued.memories.length, 14);
  roundTrip(continued);
});

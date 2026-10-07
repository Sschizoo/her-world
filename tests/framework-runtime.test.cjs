'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const CAPS = require('../framework/capabilities.js');
const PACKS = require('../framework/packs.js');
const clone = value => JSON.parse(JSON.stringify(value));
const rain = () => R.create(PACKS.get('rain-lab'));
const workshop = () => R.create(PACKS.get('lantern-lab'));
const plan = (operations = [], topic = null, lines = ['好。'], afterLine = 0) => ({ schema: 'her-world-turn-v2', lines, beats: operations.length ? [{ afterLine, operations }] : [], topic });
const result = (state, text, operations = [], topic = null, lines, afterLine) => R.commit(state, R.propose(state, { text }), plan(operations, topic, lines, afterLine));
const turn = (...args) => { const value = result(...args); assert.equal(value.ok, true, JSON.stringify(value.error)); return value.state; };
const answer = (state, questionId, value, topic) => turn(state, value, [{ type: 'story.answer', questionId, value }], topic);
const object = (label = '小灯') => ({ label, glyphs: ' /\\\n|__|', x: 10, y: 20, scale: 1 });

test('both actual packs validate and context derives every story and capability from data', () => {
  for (const pack of PACKS.list()) {
    assert.equal(R.validatePack(pack).ok, true);
    const ctx = R.context(R.create(pack));
    assert.deepEqual(ctx.topics, pack.topics);
    assert.equal(ctx.character.role, pack.character.role);
    assert.equal(ctx.guidance, pack.guidance);
    assert.equal(ctx.capabilities.length, pack.capabilities.length);
    assert.equal(ctx.pendingQuestions[0].id, pack.nodes[0].question.id);
    assert.ok(ctx.capabilities.every(capability => capability.schema.additionalProperties === false));
    assert.ok(Object.isFrozen(ctx));
  }
  assert.notDeepEqual(R.context(rain()).pendingQuestions, R.context(workshop()).pendingQuestions);
});

test('pack validation rejects executable/unknown data, invalid references and invalid choice graph', () => {
  for (const alter of [p => p.code = 'run()', p => p.nodes[0].requires = { 'answer.missing': true }, p => p.world.capacity = 9, p => p.nodes[0].sets = { 'answer.q_rain': 'fake' }, p => p.character.realTrust = 1, p => p.nodes[0].question.kind = 'random', p => p.nodes[0].completion = { type: 'script' }]) {
    const pack = PACKS.get('rain-lab'); alter(pack); assert.equal(R.validatePack(pack).ok, false);
  }
});

test('unrelated turns and early independent edits leave a pending question unanswered', () => {
  let state = rain();
  for (const input of ['今天有点累', '你的窗口是什么颜色', '随便聊聊']) state = turn(state, input);
  state = turn(state, '画个能放光的东西', [{ type: 'world.create', object: object('折纸灯') }]);
  assert.deepEqual(state.story.completed, []);
  assert.equal(R.view(state).pendingQuestions[0].id, 'q_rain');
  assert.equal(state.world.objects[0].label, '折纸灯');
  assert.equal(state.world.objects[0].source.createdBy, '画个能放光的东西');
});

test('questions defer, survive off-topic turns, and resume without consuming them', () => {
  let state = turn(rain(), '先不聊这个', [{ type: 'story.defer', questionId: 'q_rain' }]);
  assert.equal(R.view(state).pendingQuestions[0].deferred, true);
  state = turn(state, '我们说点别的');
  assert.equal(state.story.deferred[0], 'q_rain');
  state = turn(state, '回到雨', [], 'rain');
  assert.deepEqual(state.story.deferred, []);
  assert.deepEqual(state.story.completed, []);
  state = answer(state, 'q_rain', '像一层会移动的纱', 'rain');
  assert.equal(state.facts.rain_described, true);
  assert.equal(R.view(state).pendingQuestions[0].id, 'q_name');
});

test('answer boundaries reject newly unlocked, unknown, duplicate and topic-mismatched answers atomically', () => {
  const state = rain();
  const first = { type: 'story.answer', questionId: 'q_rain', value: '轻轻的' };
  for (const p of [plan([first]), plan([{ ...first, questionId: 'q_name' }], 'naming'), plan([first, first], 'rain'), plan([first, { ...first, questionId: 'q_name' }], 'rain')]) {
    assert.equal(R.commit(state, R.propose(state, { text: '轻轻的' }), p).ok, false);
    assert.deepEqual(state.facts, {});
  }
});

test('nonlinear choice branches are selected by declarative answer facts', () => {
  for (const route of ['stay', 'explore']) {
    let state = answer(workshop(), 'q_purpose', '读书', 'purpose');
    state = turn(state, '添一盏灯', [{ type: 'world.create', object: object() }], 'making');
    assert.equal(state.facts.object_made, true);
    state = R.observe(state, { type: 'panel.viewed', panel: 'world' });
    state = answer(state, 'q_route', route, 'route');
    assert.equal(state.facts['answer.q_route'], route);
    assert.deepEqual(R.view(state).pendingQuestions.map(question => question.id), ['q_' + route]);
    state = answer(state, 'q_' + route, '有光的方向', route);
    state = turn(state, '还想在这里修改灯', [{ type: 'world.update', target: 'obj_1', changes: { x: 30 } }]);
    assert.equal(state.world.objects[0].x, 30);
  }
});

test('multiple sentences stage objects, memories, role, logs and panel after their beats', () => {
  const initial = rain();
  const p = { schema: 'her-world-turn-v2', topic: null, lines: ['先看这里。', '添一盏灯。', '我会记下来。', '日志在这里。'], beats: [
    { afterLine: 1, operations: [{ type: 'world.create', object: object() }] },
    { afterLine: 2, operations: [{ type: 'memory.upsert', id: 'note_lamp', title: '小灯', body: '窗边有光' }, { type: 'character.update', changes: { mood: '安静', trustDelta: 2 } }] },
    { afterLine: 3, operations: [{ type: 'panel.open', panel: 'logs' }] }
  ] };
  const committed = R.commit(initial, R.propose(initial, { text: '加一盏灯并记下来' }), p);
  assert.equal(committed.ok, true);
  assert.equal(committed.frames[0].world.objects.length, 0);
  assert.equal(committed.frames[0].memories.length, 0);
  assert.equal(committed.frames[1].world.objects.length, 1);
  assert.equal(committed.frames[1].character.trust, 0);
  assert.equal(committed.frames[2].character.trust, 2);
  assert.equal(committed.frames[2].memories.length, 1);
  assert.equal(committed.frames[2].panel, null);
  assert.equal(committed.frames[3].panel, 'logs');
  assert.deepEqual(committed.frames[0].focus.operations, []);
  assert.equal(initial.world.objects.length, 0);
  assert.equal(committed.state.events.length, 1);
  assert.equal(committed.state.logs.some(log => log.kind === 'ui'), false);
  assert.deepEqual(R.view(committed.state, { event: 0, line: 1 }), committed.frames[1]);
});

test('a malformed later operation rejects the whole batch and exposes no frames', () => {
  const state = rain(), candidate = R.propose(state, { text: '造一盏灯' });
  const p = { schema: 'her-world-turn-v2', topic: null, lines: ['一盏灯。', '改好。'], beats: [{ afterLine: 0, operations: [{ type: 'world.create', object: object() }] }, { afterLine: 1, operations: [{ type: 'world.update', target: 'missing', changes: { x: 20 } }] }] };
  const rejected = R.commit(state, candidate, p);
  assert.equal(rejected.ok, false); assert.equal(rejected.frames, undefined);
  assert.equal(state.world.objects.length, 0); assert.equal(state.revision, 0);
  assert.equal(R.commit(state, candidate, plan([{ type: 'world.create', object: object() }])).ok, true);
});

test('unknown fields and malformed operations always fail closed', () => {
  const state = rain();
  const bad = [
    { type: 'world.create', object: { ...object(), run: 'x' } },
    { type: 'weather.set', changes: { paused: 'yes' } },
    { type: 'world.create', object: { ...object(), glyphs: '🌧' } },
    { type: 'world.create', object: { ...object(), glyphs: 'a'.repeat(25) } },
    { type: 'world.create', object: { ...object(), x: 99, scale: 3 } },
    { type: 'character.update', changes: { role: 'overridden' } },
    { type: 'panel.viewed', panel: 'logs' },
    { type: 'story.answer', questionId: 'q_rain', value: 'x', facts: { hacked: true } },
    { type: 'log.note', text: 'ok', evidence: 'a different input' }
  ];
  for (const op of bad) assert.equal(result(state, '测试', [op]).ok, false, JSON.stringify(op));
  assert.equal(R.commit(state, R.propose(state, { text: '测试' }), { ...plan(), state: {} }).ok, false);
  assert.equal(result(state, '测试', [], null, ['<analysis>secret</analysis>']).ok, false);
});

test('cancel before or after validation leaves original unchanged and newer state rejects stale proposal', () => {
  const state = rain(), candidate = R.propose(state, { text: '加灯' });
  const before = JSON.stringify(R.serialize(state));
  const discarded = R.commit(state, candidate, plan([{ type: 'world.create', object: object() }]));
  assert.equal(discarded.ok, true); assert.equal(JSON.stringify(R.serialize(state)), before);
  const observed = R.observe(state, { type: 'panel.viewed', panel: 'world' });
  assert.equal(R.commit(observed, candidate, plan()).error.code, 'STALE_PROPOSAL');
  assert.equal(R.commit(state, clone(candidate), plan()).error.code, 'STALE_PROPOSAL');
});

test('repeated edits, resize reversals, remove and recreate use stable geometry and monotonic IDs', () => {
  let state = turn(rain(), '加灯', [{ type: 'world.create', object: object() }]);
  const original = clone(state.world.objects[0]);
  for (let i = 0; i < 4; i++) {
    state = turn(state, '放大', [{ type: 'world.update', target: 'obj_1', changes: { scale: 2 }, placement: { anchor: 'keep_base' } }]);
    state = turn(state, '缩回去', [{ type: 'world.update', target: 'obj_1', changes: { scale: 1 }, placement: { anchor: 'keep_base' } }]);
    assert.equal(state.world.objects[0].x, original.x); assert.equal(state.world.objects[0].y, original.y);
  }
  state = turn(state, '把它靠窗摆好', [{ type: 'world.update', target: 'obj_1', changes: {}, placement: { anchor: 'window_right' } }]);
  assert.equal(state.world.objects[0].x, 45);
  state = turn(state, '拿走', [{ type: 'world.remove', target: 'obj_1' }]);
  state = turn(state, '再添个不同的', [{ type: 'world.create', object: { label: '纸船', glyphs: '\\__/', scale: 1 }, placement: { anchor: 'ground' } }]);
  assert.equal(state.world.objects[0].id, 'obj_2');
  assert.equal(state.world.objects[0].source.createdBy, '再添个不同的');
});

test('meaning, interpretation and memory revision remain independent and preserve originals', () => {
  let state = turn(rain(), '做个东西代表家', [{ type: 'world.create', object: object('归处') }, { type: 'world.annotate', target: 'obj_1', field: 'meaning', value: '家' }, { type: 'world.annotate', target: 'obj_1', field: 'interpretation', value: '可以回来' }, { type: 'memory.upsert', id: 'note_home', title: '归处', body: '有灯的地方' }]);
  state = turn(state, '现在它代表远行，记忆也改一下', [{ type: 'world.annotate', target: 'obj_1', field: 'meaning', value: '远行' }, { type: 'memory.upsert', id: 'note_home', title: '出发', body: '带着光走远' }]);
  assert.equal(state.world.annotations.obj_1.interpretation, '可以回来');
  assert.equal(state.memories[0].source.text, '做个东西代表家');
  assert.equal(state.memories[0].currentRevision.text, '现在它代表远行，记忆也改一下');
  assert.equal(state.memories[0].currentRevision.number, 2);
  assert.equal(state.events[0].plan.beats[0].operations.at(-1).body, '有灯的地方');
  state = turn(state, '清掉你的解释', [{ type: 'world.annotate', target: 'obj_1', field: 'interpretation', value: null }]);
  assert.equal(state.world.annotations.obj_1.meaning, '远行');
});

test('UI completion only follows actual observation, and model cannot forge one', () => {
  let state = answer(rain(), 'q_rain', '细细的', 'rain');
  state = answer(state, 'q_name', '夜信', 'naming');
  state = turn(state, '打开日志', [{ type: 'panel.open', panel: 'logs' }], 'records');
  assert.equal(state.facts.records_seen, undefined);
  assert.equal(result(state, '我看了', [{ type: 'story.answer', questionId: 'q_read', value: '看了' }], 'records').ok, false);
  state = R.observe(state, { type: 'panel.viewed', panel: 'logs' });
  assert.equal(state.facts.records_seen, true);
  assert.equal(R.view(state).pendingQuestions[0].id, 'q_visitor');
});

test('consent is checked only for the relevant consent question and cannot be cherry-picked', () => {
  let state = answer(rain(), 'q_rain', '任意创意描述', 'rain');
  state = answer(state, 'q_name', '新的名字', 'naming');
  state = R.observe(state, { type: 'panel.viewed', panel: 'logs' });
  for (const text of ['不要记住我', '我以前同意过', '如果我同意呢', '他说：我同意', '可以吗？']) assert.equal(result(state, text, [{ type: 'story.answer', questionId: 'q_visitor', value: 'allow' }], 'visitor').ok, false, text);
  const allowed = turn(state, '你可以记住我', [{ type: 'story.answer', questionId: 'q_visitor', value: 'allow' }], 'visitor');
  assert.equal(allowed.facts['answer.q_visitor'], 'allow');
  assert.equal(result(rain(), '我同意', [{ type: 'story.answer', questionId: 'q_visitor', value: 'allow' }], 'visitor').ok, false);
});

test('fictional relationship deltas are source based, staged and bounded for the whole turn', () => {
  const state = rain();
  assert.equal(result(state, '好', [{ type: 'character.update', changes: { trustDelta: 4 } }, { type: 'character.update', changes: { trustDelta: 4 } }]).ok, false);
  const changed = turn(state, '喜欢这个地方', [{ type: 'character.update', changes: { mood: '轻松', stance: '慢慢来', trustDelta: 3, familiarityDelta: 1 } }]);
  assert.equal(changed.character.trust, 3);
  assert.equal(changed.character.basis.text, '喜欢这个地方');
  const negative = turn(changed, '我们还不熟', [{ type: 'character.update', changes: { familiarityDelta: -5 } }]);
  assert.equal(negative.character.familiarity, 0);
});

test('save v4 validates every replayed event and rejects wrong pack, rules, content or tampering', () => {
  let state = answer(rain(), 'q_rain', '一层纱', 'rain');
  state = turn(state, '加灯', [{ type: 'world.create', object: object() }]);
  const saved = R.serialize(state), restored = R.restore(JSON.stringify(saved), PACKS.get('rain-lab'));
  assert.equal(restored.ok, true); assert.deepEqual(R.view(restored.state), R.view(state));
  assert.equal(R.restore(saved, PACKS.get('lantern-lab')).error.code, 'PACK_MISMATCH');
  for (const field of ['version', 'rulesVersion', 'title']) { const pack = PACKS.get('rain-lab'); pack[field] += '-changed'; assert.equal(R.restore(saved, pack).error.code, field === 'rulesVersion' ? 'RULES_VERSION_UNSUPPORTED' : 'PACK_MISMATCH'); }
  const forged = clone(saved); forged.events[1].plan.beats[0].operations[0].object.x = 999;
  assert.equal(R.restore(forged, PACKS.get('rain-lab')).ok, false);
  const ui = clone(saved); ui.events[1] = { id: 'event_2', type: 'panel.viewed', panel: 'world', facts: {} };
  assert.equal(R.restore(ui, PACKS.get('rain-lab')).ok, false);
});

test('capability restrictions and input codepoint limits are enforced locally', () => {
  const pack = PACKS.get('rain-lab'); pack.capabilities = pack.capabilities.filter(id => id !== 'world.create');
  assert.equal(result(R.create(pack), '加灯', [{ type: 'world.create', object: object() }]).error.code, 'CAPABILITY_DISABLED');
  assert.doesNotThrow(() => R.propose(rain(), { text: '字'.repeat(200) }));
  assert.throws(() => R.propose(rain(), { text: '字'.repeat(201) }), /INPUT_INVALID/);
  assert.equal(CAPS.validate({ type: 'log.note', text: '没有证据也由本地记录' }), true);
});

test('strict legacy projection preserves values, provenance and dialogue across v4 replay', () => {
  const snapshot = { origin: { type: 'legacy-v3', version: '0.5.4', milestones: ['connected', 'rain_taught'] }, world: { objects: [{ id: 'obj_3', ...object('旧纸灯'), source: { createdBy: '原来的输入', lastChangedBy: '后来改过' } }], annotations: { obj_3: { meaning: '以前', interpretation: '仍然在', sources: { meaning: '意义来源', interpretation: '理解来源' } } }, weather: { kind: 'rain', name: '旧名字', intensity: 2, paused: false, source: '旧命名输入' } }, memories: [{ id: 'note_old', title: '旧记忆', body: '保留原文', source: '原始记录', latestSource: '一次修改' }], transcript: [{ role: 'user', text: '曾经的话' }, { role: 'character', text: '曾经的回答' }], facts: { rain_described: true } };
  const imported = R.importLegacy(snapshot, PACKS.get('rain-lab'));
  assert.equal(imported.ok, true, JSON.stringify(imported.error));
  assert.equal(imported.state.world.nextId, 4); assert.equal(imported.state.memories[0].source.text, '原始记录');
  assert.equal(imported.state.transcript[0].text, '曾经的话'); assert.equal(R.view(imported.state).pendingQuestions[0].id, 'q_name');
  const changed = turn(imported.state, '再改名', [{ type: 'weather.set', changes: { name: '新名字' } }]);
  const restored = R.restore(R.serialize(changed), PACKS.get('rain-lab'));
  assert.equal(restored.ok, true); assert.deepEqual(R.view(restored.state), R.view(changed));
  const unknown = clone(snapshot); unknown.facts.hacked = true; assert.equal(R.importLegacy(unknown, PACKS.get('rain-lab')).ok, false);
  const malformed = clone(snapshot); malformed.world.objects[0].x = 999; assert.equal(R.importLegacy(malformed, PACKS.get('rain-lab')).ok, false);
});

test('relationship clipping never amplifies a bounded turn delta', () => {
  const initial = rain();
  const state = turn(initial, '我们慢慢熟悉', [-5, 5, 5].map(trustDelta => ({ type: 'character.update', changes: { trustDelta } })));
  assert.equal(state.character.trust, 5);
  assert.ok(Math.abs(state.character.trust - initial.character.trust) <= 5);
});

test('changing topic cannot make a bare yes authorize an unrelated pending consent', () => {
  const pack = PACKS.get('rain-lab'); pack.nodes.find(node => node.question.id === 'q_visitor').requires = {};
  const state = R.create(pack);
  assert.equal(R.view(state).pendingQuestions.length, 2);
  assert.equal(result(state, '好的', [{ type: 'story.answer', questionId: 'q_visitor', value: 'allow' }], 'visitor').error.code, 'CONSENT_REQUIRED');
});

test('legacy import explicitly preserves unknown memory provenance as null', () => {
  const snapshot = { origin: { type: 'legacy-v3', version: '0.5.4', milestones: [] }, world: { objects: [], annotations: {}, weather: { kind: 'rain', name: '旧雨', intensity: 1, paused: false, source: null } }, memories: [{ id: 'note_legacy_visitor', title: '来访者', body: '旧引用', source: null, latestSource: null }], transcript: [], facts: {} };
  const imported = R.importLegacy(snapshot, PACKS.get('rain-lab'));
  assert.equal(imported.ok, true, JSON.stringify(imported.error));
  assert.equal(imported.state.memories[0].source, null);
  assert.equal(imported.state.memories[0].currentRevision.text, null);
  assert.equal(R.restore(R.serialize(imported.state), PACKS.get('rain-lab')).ok, true);
});

test('the actual active operation invitation completes without a redundant topic token', () => {
  const initial = answer(workshop(), 'q_purpose', '读书', 'purpose');
  assert.equal(R.view(initial).activeQuestionId, 'q_make');
  assert.equal(R.context(initial).activeQuestionId, 'q_make');
  const active = turn(initial, '添个灯', [{ type: 'world.create', object: object() }]);
  assert.equal(active.facts.object_made, true);
  const unrelated = turn(initial, '另一个话题的图案', [{ type: 'world.create', object: object() }], 'explore');
  assert.equal(unrelated.facts.object_made, true);
});

test('oversized graph metadata is rejected before a usable state is created', () => {
  const pack = PACKS.get('rain-lab');
  pack.nodes = Array.from({ length: 64 }, (_, index) => ({ id: 'node_' + index, topic: 'rain', requires: {}, question: { id: 'question_' + index, text: '字'.repeat(500), kind: 'open' }, completion: { type: 'answer' }, sets: {} }));
  assert.equal(R.validatePack(pack).error.code, 'PACK_CAPACITY');
  assert.throws(() => R.create(pack), /PACK_CAPACITY/);
});

test('a compound answer and real operation satisfy sequential declarative conditions in one turn', () => {
  const state = workshop();
  const committed = result(state, '我想在窗边读书，先放一张长椅', [{ type: 'story.answer', questionId: 'q_purpose', value: '在窗边读书' }, { type: 'world.create', object: object('长椅') }], 'purpose');
  assert.equal(committed.ok, true, JSON.stringify(committed.error));
  assert.equal(committed.state.facts.purpose_known, true);
  assert.equal(committed.state.facts.object_made, true);
  assert.deepEqual(committed.state.story.completed, ['purpose', 'make']);
  assert.equal(R.view(committed.state).activeQuestionId, 'q_inspect');
  assert.equal(committed.state.facts.world_seen, undefined);
});

test('context capacity rejects expansions atomically and current removals remain available', () => {
  const pack = PACKS.get('rain-lab');
  pack.initialFacts = Object.fromEntries(Array.from({ length: 20 }, (_, index) => ['fact_' + index, '界'.repeat(250)]));
  let state = R.create(pack), input = '界'.repeat(200), rejected = false;
  const attempt = operation => {
    const before = JSON.stringify(R.serialize(state));
    const next = result(state, input, [operation]);
    if (next.ok) state = next.state;
    else { assert.equal(next.error.code, 'CONTEXT_CAPACITY'); assert.equal(JSON.stringify(R.serialize(state)), before); rejected = true; }
    assert.ok(CAPS.requestContextBytes(R.context(state)) <= R.constants.MAX_CONTEXT_BYTES);
  };
  for (let i = 0; i < 14; i++) attempt({ type: 'memory.upsert', id: 'note_' + i, title: '界'.repeat(60), body: '界'.repeat(240) });
  for (let i = 0; i < 8; i++) attempt({ type: 'world.create', object: object('界'.repeat(40)) });
  for (const target of [...state.world.objects.map(item => item.id), ...pack.entities.map(entity => entity.id)]) for (const field of ['meaning', 'interpretation']) attempt({ type: 'world.annotate', target, field, value: '界'.repeat(120) });
  assert.equal(rejected, true);
  const restored = R.restore(R.serialize(state), pack); assert.equal(restored.ok, true);
  const removed = turn(state, '移除一条笔记腾出空间', [{ type: 'memory.remove', id: 'note_0' }]);
  assert.equal(removed.memories.length, state.memories.length - 1);
  assert.ok(CAPS.requestContextBytes(R.context(removed)) <= R.constants.MAX_CONTEXT_BYTES);
});

test('removing and relearning a memory ID starts a new source and generation', () => {
  let state = turn(rain(), '第一次写下', [{ type: 'memory.upsert', id: 'note_return', title: '开始', body: '第一版' }]);
  state = turn(state, '先移除', [{ type: 'memory.remove', id: 'note_return' }]);
  state = turn(state, '再记下来', [{ type: 'memory.upsert', id: 'note_return', title: '回来', body: '第二版' }]);
  assert.equal(state.memories[0].source.text, '再记下来');
  assert.equal(state.memories[0].currentRevision.number, 1);
  assert.equal(state.memories[0].generation, 2);
  state = turn(state, '重新整理同一条', [{ type: 'memory.remove', id: 'note_return' }, { type: 'memory.upsert', id: 'note_return', title: '现在', body: '第三版' }]);
  assert.equal(state.memories[0].source.text, '重新整理同一条');
  assert.equal(state.memories[0].currentRevision.number, 1);
  assert.equal(state.memories[0].generation, 3);
  const restored = R.restore(R.serialize(state), PACKS.get('rain-lab'));
  assert.equal(restored.ok, true); assert.deepEqual(restored.state.memories, state.memories);
});

test('consent recognizes a current direct answer but rejects quoted or historical permission', () => {
  for (const text of ['同意留下引用', '/回答 同意留下引用', '你可以记住我', '我愿意', 'Yes, you can remember me']) assert.equal(R.explicitConsent(text), true, text);
  for (const text of ['他同意留下引用', '我同意过保存我的引用', 'he says please remember me', '如果我同意留下引用呢', '我不同意留下引用']) assert.equal(R.explicitConsent(text), false, text);
});

const oldBinding = packId => ({ id: packId, version: '1.0.0', rulesVersion: '1', digest: { 'rain-lab': '402db16c', 'lantern-lab': '8dd7d018' }[packId] });
const asOldSave = state => {
  const saved = { ...clone(R.serialize(state)), pack: oldBinding(state.pack.id) };
  for (const event of saved.events) if (event.type === 'turn') {
    delete event.rulesVersion;
    for (const beat of event.plan.beats) for (const op of beat.operations) { delete op.placementPolicy; delete op.allowOverlap; }
  }
  return saved;
};
const weatherEvent = (number, changes) => ({ id: 'event_' + number, type: 'turn', input: '旧天气请求' + number, plan: plan([{ type: 'weather.set', changes }]) });
const minimalImport = weather => ({ origin: { type: 'legacy-v3', version: '0.5.4', milestones: [] }, world: { objects: [], annotations: {}, weather: { ...weather, source: null } }, memories: [], transcript: [], facts: {} });

test('weather capability names exactly the renderer-supported kinds', () => {
  const descriptor = CAPS.descriptors(['weather.set'])[0];
  assert.deepEqual(descriptor.schema.properties.changes.properties.kind.enum, ['rain', 'snow', 'mist', 'clear']);
  for (const kind of ['rain', 'snow', 'mist', 'clear']) {
    const state = turn(rain(), '设置实际天气' + kind, [{ type: 'weather.set', changes: { kind, intensity: kind === 'clear' ? 0 : 2, paused: false } }]);
    assert.equal(state.world.weather.kind, kind);
    assert.equal(state.world.weather.intensity, kind === 'clear' ? 0 : 2);
    assert.equal(R.restore(R.serialize(state), PACKS.get('rain-lab')).ok, true);
  }
});

test('unsupported weather rejects the entire turn before any object or dialogue commits', () => {
  const initial = rain(), before = JSON.stringify(R.serialize(initial));
  const rejected = result(initial, '风吹起来，再添一盏灯', [{ type: 'world.create', object: object() }, { type: 'weather.set', changes: { kind: 'wind' } }]);
  assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'OPERATION_INVALID');
  assert.equal(rejected.frames, undefined); assert.equal(JSON.stringify(R.serialize(initial)), before);
  for (const kind of ['storm', 'Snow', '', 'rain<script>']) assert.equal(result(initial, '改天气', [{ type: 'weather.set', changes: { kind } }]).ok, false);
});

test('clear without intensity clears inherited particles and rejects explicit positive intensity', () => {
  const rainy = turn(rain(), '下大雨', [{ type: 'weather.set', changes: { kind: 'rain', intensity: 3, paused: false } }]);
  const cleared = turn(rainy, '放晴吧', [{ type: 'weather.set', changes: { kind: 'clear' } }]);
  assert.equal(cleared.world.weather.intensity, 0);
  assert.equal(cleared.world.weather.kind, 'clear');
  assert.equal(cleared.world.weather.source.text, '放晴吧');
  assert.deepEqual(cleared.events.at(-1).plan.beats[0].operations[0].changes, { kind: 'clear' });
  for (const [state, changes] of [[rainy, { kind: 'clear', intensity: 1 }], [cleared, { intensity: 2 }]]) {
    const before = JSON.stringify(R.serialize(state));
    assert.equal(result(state, '矛盾的天气', [{ type: 'weather.set', changes }]).error.code, 'WEATHER_CONFLICT');
    assert.equal(JSON.stringify(R.serialize(state)), before);
  }
  assert.deepEqual(R.view(R.restore(R.serialize(cleared), PACKS.get('rain-lab')).state), R.view(cleared));
});

test('initial, imported and replayed weather obey the same supported kind and clear rules', () => {
  for (const weather of [{ kind: 'wind', name: '风', intensity: 1, paused: false }, { kind: 'clear', name: '晴', intensity: 2, paused: false }]) {
    const pack = PACKS.get('rain-lab'); pack.world.weather = weather;
    assert.equal(R.validatePack(pack).ok, false);
    assert.throws(() => R.create(pack), /PACK_INVALID/);
    assert.equal(R.importLegacy(minimalImport(weather), PACKS.get('rain-lab')).error.code, 'IMPORT_WEATHER');
    const saved = clone(R.serialize(rain())); saved.events.push(weatherEvent(1, weather));
    assert.equal(R.restore(saved, PACKS.get('rain-lab')).ok, false);
  }
  const imported = R.importLegacy(minimalImport({ kind: 'clear', name: '晴', intensity: 0, paused: false }), PACKS.get('rain-lab'));
  assert.equal(imported.ok, true); assert.equal(R.restore(R.serialize(imported.state), PACKS.get('rain-lab')).ok, true);
});

test('known rules1 saves migrate explicitly to rules4 with all state, sources and original plans preserved', () => {
  for (const packId of ['rain-lab', 'lantern-lab']) {
    let state = R.create(PACKS.get(packId));
    state = turn(state, '原来的造物请求', [{ type: 'world.create', object: object('旧灯') }, { type: 'memory.upsert', id: 'note_weather', title: '原来的记忆', body: '保留原文' }]);
    for (const kind of ['rain', 'snow', 'mist', 'clear']) state = turn(state, '原来的天气请求' + kind, [{ type: 'weather.set', changes: { kind, intensity: kind === 'clear' ? 0 : 2, paused: false } }]);
    const saved = asOldSave(state), original = JSON.stringify(saved);
    const restored = R.restore(saved, PACKS.get(packId));
    assert.equal(restored.ok, true, JSON.stringify(restored.error));
    assert.deepEqual(restored.migration, { type: 'memory-provenance-v4', fromRulesVersion: '1', toRulesVersion: '4', fromPackDigest: oldBinding(packId).digest, toPackDigest: R.serialize(state).pack.digest });
    const historical = clone(R.view(state));
    historical.memories = historical.memories.map(({ id, title, body, source, currentRevision, recallStatus, recallHandle }) => ({ id, title, body, recallStatus, recallHandle, source: { eventId: source.eventId, text: source.text }, currentRevision: { eventId: currentRevision.eventId, text: currentRevision.text, number: currentRevision.number } }));
    assert.deepEqual(R.view(restored.state), historical);
    assert.deepEqual(restored.state.events, saved.events.map(event => event.type === 'turn' ? { ...event, rulesVersion: '2' } : event));
    assert.equal(JSON.stringify(saved), original);
    const currentSave = R.serialize(restored.state);
    assert.equal(currentSave.pack.rulesVersion, '4');
    assert.equal(R.restore(currentSave, PACKS.get(packId)).migration, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(R.context(restored.state))) <= R.constants.MAX_CONTEXT_BYTES);
  }
});

test('rules1 migration preserves a compatible imported snapshot without inventing sources', () => {
  const snapshot = minimalImport({ kind: 'mist', name: '旧雾', intensity: 1, paused: false });
  snapshot.memories.push({ id: 'note_unknown', title: '旧记忆', body: '来源没有保存', source: null, latestSource: null });
  const imported = R.importLegacy(snapshot, PACKS.get('rain-lab'));
  const saved = asOldSave(imported.state);
  const restored = R.restore(saved, PACKS.get('rain-lab'));
  assert.equal(restored.ok, true); assert.ok(restored.migration);
  assert.deepEqual(restored.state.importedSnapshot, snapshot);
  assert.equal(restored.state.memories[0].source, null);
  assert.equal(restored.state.memories[0].currentRevision.text, null);
});

test('rules1 incompatible weather remains rejected even when a later event would repair it', () => {
  const cases = [
    [weatherEvent(1, { kind: 'wind', intensity: 2 }), weatherEvent(2, { kind: 'rain' })],
    [weatherEvent(1, { kind: 'rain', intensity: 3 }), weatherEvent(2, { kind: 'clear' })],
    [weatherEvent(1, { kind: 'clear', intensity: 2 })],
    [weatherEvent(1, { kind: 'clear', intensity: 0 }), weatherEvent(2, { intensity: 1 })]
  ];
  for (const events of cases) {
    const saved = asOldSave(rain()); saved.events = events;
    const original = JSON.stringify(saved), restored = R.restore(saved, PACKS.get('rain-lab'));
    assert.deepEqual(restored, { ok: false, error: { code: 'MIGRATION_WEATHER_INCOMPATIBLE', path: 'world.weather' } });
    assert.equal(JSON.stringify(saved), original); assert.equal(restored.state, undefined);
  }
  for (const weather of [{ kind: 'wind', name: '旧风', intensity: 1, paused: false }, { kind: 'clear', name: '旧晴', intensity: 1, paused: true }]) {
    const saved = asOldSave(rain()); saved.importedSnapshot = minimalImport(weather);
    assert.equal(R.restore(saved, PACKS.get('rain-lab')).error.code, 'MIGRATION_WEATHER_INCOMPATIBLE');
  }
});

test('migration is limited to pinned predecessor definitions and cannot run an old pack silently', () => {
  const pack = PACKS.get('rain-lab'), saved = asOldSave(rain());
  for (const change of [value => value.pack.digest = '00000000', value => value.pack.rulesVersion = '0', value => value.pack.version = '0.9.0']) {
    const bad = clone(saved); change(bad); assert.equal(R.restore(bad, pack).error.code, 'PACK_MISMATCH');
  }
  const changed = clone(pack); changed.title += '改';
  assert.equal(R.restore(saved, changed).error.code, 'PACK_MISMATCH');
  const old = clone(pack); old.rulesVersion = '1';
  assert.equal(R.validatePack(old).error.code, 'RULES_VERSION_UNSUPPORTED');
  assert.throws(() => R.create(old), /RULES_VERSION_UNSUPPORTED/);
  assert.equal(R.restore(saved, old).error.code, 'RULES_VERSION_UNSUPPORTED');
});

test('fresh model window_below gap1 placement follows its declared schema and actual geometry', () => {
  const initial = workshop();
  const create = { type: 'world.create', object: { label: '阅读长椅', glyphs: '|---------------|\n|_______________|\n|===============|\n  |           |', scale: 1 }, placement: { anchor: 'window_below', gap: 1 } };
  assert.equal(CAPS.validate(create), true);
  const committed = result(initial, '我想在窗边读书，先放一张长椅', [{ type: 'story.answer', questionId: 'q_purpose', value: '把窗边变成一个能并排读书的小角落' }, create], 'purpose');
  assert.equal(committed.ok, true, JSON.stringify(committed.error));
  assert.equal(committed.state.world.objects[0].x, 28);
  assert.equal(committed.state.world.objects[0].y, 42);
  assert.deepEqual(committed.state.story.completed, ['purpose', 'make']);
  assert.equal(R.restore(R.serialize(committed.state), PACKS.get('lantern-lab')).ok, true);
});

test('fixed window placements honor optional bounded gaps without accepting a target', () => {
  for (const anchor of ['window_left', 'window_right', 'window_below']) for (const gap of [undefined, 0, 1, 10]) {
    const placement = { anchor, ...(gap === undefined ? {} : { gap }) };
    const state = turn(rain(), '放到窗边', [{ type: 'world.create', object: { label: '灯', glyphs: 'x', scale: 1 }, placement }]);
    const item = state.world.objects[0], amount = gap ?? 2;
    if (anchor === 'window_left') assert.equal(item.x, 30 - amount - 1);
    if (anchor === 'window_right') assert.equal(item.x, 43 + amount);
    if (anchor === 'window_below') assert.equal(item.y, 41 + amount);
    const moved = turn(state, '贴近窗', [{ type: 'world.update', target: 'obj_1', changes: {}, placement: { anchor, gap: 0 } }]);
    assert.equal(CAPS.validate({ type: 'world.update', target: 'obj_1', changes: {}, placement: { anchor, gap: 0 } }), true);
    assert.equal(moved.world.objects.length, 1);
  }
});

test('placement variants reject fields that contradict their actual anchor rules', () => {
  const visual = { label: '灯', glyphs: 'x', scale: 1 };
  for (const placement of [
    { anchor: 'window_below', target: 'window' }, { anchor: 'window_left', gap: -1 }, { anchor: 'window_right', gap: 11 },
    { anchor: 'above' }, { anchor: 'below', gap: 1 }, { anchor: 'sky', gap: 1 }, { anchor: 'ground', target: 'window' },
    { anchor: 'keep_center' }, { anchor: 'keep_base', gap: 1 }
  ]) {
    const operation = { type: 'world.create', object: visual, placement };
    assert.equal(CAPS.validate(operation), false, JSON.stringify(placement));
    assert.equal(result(rain(), '不明确的位置', [operation]).ok, false);
  }
  const before = turn(rain(), '加灯', [{ type: 'world.create', object: object() }]);
  for (const placement of [{ anchor: 'keep_center', gap: 1 }, { anchor: 'keep_base', target: 'obj_1' }]) assert.equal(result(before, '保持锚点', [{ type: 'world.update', target: 'obj_1', changes: { scale: 2 }, placement }]).ok, false);
});

test('create coordinate and placement alternatives are represented in the registry, with update conflicts rejected', () => {
  const visual = { label: '灯', glyphs: 'x', scale: 1 };
  const accepted = [
    { type: 'world.create', object: { ...visual, x: 20, y: 30 } },
    { type: 'world.create', object: visual, placement: { anchor: 'ground' } },
    { type: 'world.create', object: visual, placement: { anchor: 'above', target: 'window', gap: 1 } }
  ];
  for (const operation of accepted) assert.equal(CAPS.validate(operation), true);
  const rejected = [
    { type: 'world.create', object: visual },
    { type: 'world.create', object: { ...visual, x: 20 } },
    { type: 'world.create', object: { ...visual, y: 30 } },
    { type: 'world.create', object: { ...visual, x: 20, y: 30 }, placement: { anchor: 'ground' } },
    { type: 'world.create', object: { ...visual, x: 20 }, placement: { anchor: 'ground' } },
    { type: 'world.update', target: 'obj_1', changes: {} },
    { type: 'world.update', target: 'obj_1', changes: { x: 20 }, placement: { anchor: 'window_below', gap: 1 } }
  ];
  for (const operation of rejected) assert.equal(CAPS.validate(operation), false, JSON.stringify(operation));
  for (const id of ['world.create', 'world.update']) assert.equal(CAPS.descriptors([id])[0].schema.anyOf.length, 2);
});

test('relative and window placement geometry rejects missing targets and off-grid results atomically', () => {
  const initial = turn(rain(), '靠左放灯', [{ type: 'world.create', object: { ...object(), x: 0 } }]);
  const visual = { label: '另一盏灯', glyphs: 'x', scale: 1 };
  for (const [operation, code] of [
    [{ type: 'world.create', object: visual, placement: { anchor: 'left_of', target: 'obj_1', gap: 1 } }, 'GEOMETRY_INVALID'],
    [{ type: 'world.create', object: visual, placement: { anchor: 'above', target: 'obj_999', gap: 1 } }, 'PLACEMENT_TARGET'],
    [{ type: 'world.create', object: { ...visual, glyphs: 'x'.repeat(24), scale: 3 }, placement: { anchor: 'window_left', gap: 1 } }, 'GEOMETRY_INVALID']
  ]) {
    const before = JSON.stringify(R.serialize(initial)), rejected = result(initial, '换个位置', [operation]);
    assert.equal(rejected.error.code, code); assert.equal(JSON.stringify(R.serialize(initial)), before);
  }
});

test('shared budget counts escaped context and duplicated definitions exactly', () => {
  for (const text of ['\\', '"', '\ud800', '🌟']) {
    const state = turn(rain(), text.repeat(200), [{ type: 'memory.upsert', id: 'note_escaping', title: text.repeat(60), body: text.repeat(240) }]);
    const context = R.context(state), definition = CAPS.modelDefinition(context);
    assert.deepEqual(Object.keys(definition), ['pack', 'persona', 'guidance', 'topics', 'capabilities']);
    assert.equal(CAPS.requestContextBytes(context), Buffer.byteLength(JSON.stringify({ context: JSON.stringify(context), definition: JSON.stringify(definition) })));
    assert.ok(CAPS.requestContextBytes(context) > Buffer.byteLength(JSON.stringify(context)));
    assert.equal(context.memories[0].body, text.repeat(240));
  }
});

test('backslash-rich legal state cannot commit an unsendable nested JSON context', () => {
  const Model = require('../framework/model.js'), pack = PACKS.get('rain-lab'), slash = '\\';
  pack.initialFacts = Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['f' + i, slash.repeat(800)]));
  let state = R.create(pack), rejected = 0;
  const input = slash.repeat(200), lines = Array(4).fill(slash.repeat(500));
  const apply = operations => {
    const before = JSON.stringify(R.serialize(state));
    const next = R.commit(state, R.propose(state, { text: input }), plan(operations, null, lines));
    if (next.ok) state = next.state;
    else { assert.equal(next.error.code, 'CONTEXT_CAPACITY'); assert.equal(JSON.stringify(R.serialize(state)), before); rejected++; }
    const context = R.context(state);
    assert.ok(CAPS.requestContextBytes(context) <= R.constants.MAX_CONTEXT_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify(Model.buildRequest(context, input))) <= 128 * 1024);
    assert.deepEqual(context.world.objects.map(({ source, ...geometry }) => geometry), state.world.objects.map(({ source, ...geometry }) => geometry));
    if (!state.recall.tombstones.length) assert.deepEqual(context.memories.map((note, index) => ({ ...note, id: state.memories[index].id })), state.memories);
    assert.deepEqual(context.facts, state.facts);
  };
  apply(Array.from({ length: 12 }, (_, i) => ({ type: 'memory.upsert', id: 'note_' + i, title: slash.repeat(60), body: slash.repeat(240) })));
  apply(Array.from({ length: 2 }, (_, i) => ({ type: 'memory.upsert', id: 'note_' + (i + 12), title: slash.repeat(60), body: slash.repeat(240) })));
  apply(Array.from({ length: 8 }, () => ({ type: 'world.create', object: { label: slash.repeat(40), glyphs: Array(10).fill(slash.repeat(24)).join('\n'), x: 0, y: 0, scale: 1 } })));
  for (const target of [...state.world.objects.map(item => item.id), ...pack.entities.map(item => item.id)]) apply(['meaning', 'interpretation'].map(field => ({ type: 'world.annotate', target, field, value: slash.repeat(120) })));
  assert.ok(rejected > 0);
  assert.ok(state.memories.length > 0);
  assert.equal(state.memories[0].source.text, input);
  const count = state.memories.length;
  apply([{ type: 'memory.remove', id: state.memories[0].id }]);
  assert.equal(state.memories.length, count - 1);
  assert.equal(R.restore(R.serialize(state), pack).ok, true);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../framework/runtime.js');
const packs = require('../framework/packs.js');
const offline = require('../framework/offline.js');
const legacy = require('../framework/legacy-adapter.js');
const old = require('../framework/legacy/v0.5.4/engine.js');
const turn = (state, text) => { const result = E.commit(state, E.propose(state, { text }), offline.respond(E.context(state), text)); assert.equal(result.ok, true, JSON.stringify(result.error)); return result; };

test('offline adapters use the real registry through two unrelated content packs', () => {
  for (const id of ['rain-lab', 'lantern-lab']) {
    let state = E.create(packs.get(id));
    state = turn(state, '现在几点了？').state;
    assert.equal(state.story.completed.length, 0);
    state = turn(state, '/新建 长椅').state;
    assert.equal(state.world.objects[0].label, '长椅');
    assert.equal(state.story.completed.length, 0);
    state = turn(state, '/移动 obj_1 20 40').state;
    state = turn(state, '/含义 obj_1 一起看天亮').state;
    state = turn(state, '/理解 obj_1 一个可以停留的地方').state;
    state = turn(state, '/清除理解 obj_1').state;
    assert(state.world.annotations.obj_1.meaning);
    assert.equal(state.world.annotations.obj_1.interpretation, null);
    state = turn(state, '/记住 note_place 窗边 | 这里可以一起看天亮').state;
    const original = JSON.stringify(state.memories[0].source);
    state = turn(state, '/记住 note_place 窗边 | 改成一起等灯亮').state;
    assert.equal(JSON.stringify(state.memories[0].source), original);
    state = turn(state, '/忘记 note_place').state;
    assert.equal(state.memories.length, 0);
    assert(state.transcript.some(item => item.text.includes('一起看天亮')));
    state = turn(state, '/天气 恢复').state;
    state = turn(state, '停雨').state;
    assert.equal(state.world.weather.paused, true);
    state = turn(state, '恢复下雨').state;
    assert.equal(state.world.weather.paused, false);
    const before = state.world.weather.intensity;
    state = turn(state, '如果雨停下会怎么样？').state;
    assert.equal(state.world.weather.intensity, before);
    state = turn(state, '/回答 我想坐在这里，听雨滴轻轻敲在玻璃上').state;
    assert.equal(state.story.completed.length, 1);
    const restored = E.restore(E.serialize(state), packs.get(id));
    assert.equal(restored.ok, true);
    assert.deepEqual(E.view(restored.state), E.view(state));
  }
});

test('offline choice branches and actual viewing work without engine-specific topic names', () => {
  let state = E.create(packs.get('lantern-lab'));
  state = turn(state, '/回答 我想在这里读书').state;
  state = turn(state, '/新建 阅读灯').state;
  state = turn(state, '/打开 世界').state;
  assert.equal(state.story.completed.includes('inspect'), false);
  state = E.observe(state, { type: 'panel.viewed', panel: 'world' });
  state = turn(state, '/回答 explore').state;
  const pending = E.context(state).pendingQuestions;
  assert(pending.some(item => item.id === 'q_explore'));
  assert(!pending.some(item => item.id === 'q_stay'));
  state = turn(state, '/回答 我想象远方还有一座小屋').state;
  assert(state.facts.route_expressed);
});

test('complete offline rain routes accept displayed explicit consent and decline choices', () => {
  for (const choice of ['我同意留下引用', '只保留场景']) {
    let state = E.create(packs.get('rain-lab'));
    state = turn(state, '/回答 雨滴像敲在叶子上的细碎手指').state;
    state = turn(state, '/回答 叶信').state;
    state = E.observe(state, { type: 'panel.viewed', panel: 'logs' });
    assert.equal(E.context(state).activeQuestionId, 'q_visitor');
    state = turn(state, '/回答 ' + choice).state;
    assert.equal(state.facts['answer.q_visitor'], choice.startsWith('我同意') ? 'allow' : 'decline');
    assert(state.story.completed.includes('visitor'));
  }
});

test('frozen legacy files remain byte identical to original runtime', () => {
  for (const file of ['engine.js', 'story.js', 'world-state.js', 'turn-protocol.js']) assert.equal(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), fs.readFileSync(path.join(__dirname, '../framework/legacy/v0.5.4', file), 'utf8'));
});

test('legacy conversion preserves coordinates and sources without writing original storage', () => {
  let state = old.start(old.create(), ['这是原来的开场。']);
  const input = '在地上放一张长椅';
  state = old.commit(state, old.plan(state, { text: input }), { schema: 'her-world-turn-v1', lines: ['长椅放在这里了。'], sceneEdits: [{ type: 'create', object: { label: '长椅', glyphs: '=====\n|   |', x: 20, y: 44, scale: 1 } }], mode: 'ai' });
  assert(state);
  const raw = JSON.stringify(state);
  const seen = [];
  const storage = { getItem(key) { seen.push(key); return key.endsWith('v3') ? raw : null; }, setItem() { throw new Error('unexpected write'); }, removeItem() { throw new Error('unexpected removal'); } };
  const read = legacy.read(storage);
  assert(read.ok);
  assert.deepEqual(seen, ['her-world.prologue.v3']);
  assert.equal(read.projection.world.objects[0].x, 20);
  assert.equal(read.projection.world.objects[0].source.createdBy, input);
  const imported = E.importLegacy(read.projection, packs.get('rain-lab'));
  assert.equal(imported.ok, true, JSON.stringify(imported.error));
  assert.equal(imported.state.world.objects[0].x, 20);
  assert(imported.state.transcript.some(item => item.text === '这是原来的开场。'));
  assert.equal(E.restore(E.serialize(imported.state), packs.get('rain-lab')).ok, true);
  assert.equal(JSON.stringify(state), raw);
});

test('legacy unavailable, malformed and missing storage are distinct safe results', () => {
  assert.equal(legacy.read({ getItem() { throw new Error('private storage detail'); } }).error, 'LEGACY_STORAGE_UNAVAILABLE');
  assert.equal(legacy.read({ getItem() { return null; } }).error, 'LEGACY_MISSING');
  assert.equal(legacy.inspect('{bad').error, 'LEGACY_INVALID');
});

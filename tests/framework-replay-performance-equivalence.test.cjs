'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const C = require('../framework/capabilities.js');
const Budget = require('../framework/recall-budget.js');
const clone = value => JSON.parse(JSON.stringify(value));
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plan = (operations = [], lines = ['先看看。', '变化已经发生。', '我们继续。'], afterLine = 1) => ({ schema: 'her-world-turn-v2', topic: null, lines, beats: operations.length ? [{ afterLine, operations }] : [] });
const report = (id, body) => ({ type: 'memory.upsert', id, title: '记录', body, perspective: 'player_report', support: { quote: body } });
const shape = { label: '小灯', glyphs: '[]', x: 5, y: 20, scale: 1 };
function turn(state, input, value = plan()) {
  const result = R.commit(state, R.propose(state, { text: input }), value);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result;
}
function replay(state) {
  const restored = R.restore(R.serialize(state), state.pack);
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  assert.deepEqual(restored.state, state, 'all reconstructed fields and provenance must remain exact');
  assert.deepEqual(R.context(restored.state), R.context(state));
  assert.deepEqual(R.view(restored.state), R.view(state));
  return restored.state;
}
// Independent golden hashes captured from the pre-optimization v019 runtime
// SHA-256 fb8e4ccbb00e46c60a72d73d397ddb78f3217325c531df76240c4f5ee8e75a4e.
// That snapshot predates the performance hunks, newer consent refinements and
// model-only answer-route/memory attribution prose and horizontal-alignment descriptors.
// These fixtures make no consent decisions. Normalize only those declared
// contract changes; state/provenance/frame goldens are never regenerated.
function historicalContext(state) {
  const context = clone(R.context(state));
  const enabled = context.capabilities.map(item => item.id);
  const live = C.descriptors(enabled, '4', context.world, context.entities);
  const priorGeometry = C.descriptors(enabled, '3', context.world, context.entities);
  context.capabilities = context.capabilities.map(item => {
    if (!['world.create', 'world.update'].includes(item.id)) return item;
    assert.deepEqual(item, live.find(current => current.id === item.id));
    return priorGeometry.find(prior => prior.id === item.id);
  });
  const answer = context.capabilities.find(item => item.id === 'story.answer');
  if (answer) {
    assert.equal(answer.description, C.descriptors(['story.answer'], '4')[0].description);
    const prior = C.descriptors(['story.answer'], '3')[0].description;
    assert.notEqual(answer.description, prior);
    answer.description = prior;
  }
  const memory = context.capabilities.find(item => item.id === 'memory.upsert');
  if (memory) {
    assert.equal(memory.description, C.descriptors(['memory.upsert'], '4')[0].description);
    assert(memory.description.includes('quote fidelity does not certify them'));
    memory.description = Budget.PROFILE.baseDescriptions['memory.upsert'];
  }
  return context;
}
const expected = {
  "mixed": {
    "state": "ddc30fab0fda931dbeeb137180429be45d5abd197453439aab8a34fe98a9bc24",
    "recall": "91504da703a6878b63b4ef23054c951161d659b15e61aeb74970c0eb76372502",
    "context": "eff45ffd7e1f537be8ad6338e5545e2bb4e4f3e30144f7c576349f93f3edd18c",
    "save": "9fe5fca387bad2a2be298c2281f93a722c8df070b7845f4ac0c7a81373665b7c",
    "view": "4ff77f61be98b7147c094af65e3566fb4b5d3efe0b4230419ec21015739d3697",
    "frames": "81bcc1a6f2b86a391b916c77f748ac68737188f60cb47be3a9de8f51686ac40f",
    "cursors": "6336dc6ccefebd86efe0891bfe0ea3491cc280910906ad7981e828cbfd245a4b"
  },
  "trimmed": {
    "state": "21f64470eaa48b5072cbb5319df4262112203bb26301726900e8fe72fe24edb4",
    "recall": "78d2a19541e44970ce08476d13d1a637df8556a5f1d4844b919b4452ce305922",
    "context": "ed0191f1dda58a27b2bf9875448ebc91520c9382cdd9ceec9c6e81d20dbfc972",
    "save": "9a1af1966c285fbfc106f7a8d4f5656d4b9f6d11545125987ad6ad01a4c9c111",
    "view": "3a050c76efc753c929212f98cf0fe45f7899622e6e1dd6965f5ad71aaf628363",
    "frames": "36489c942fbc048fd6888eb9458f42948c5e2c9c0840e14a03c8d8f1b461e544",
    "cursors": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  },
  "legacy": {
    "state": "48fea07813f30ab7a8b715c480a7d21284e30f2ef1aa89ecaa1ecb9d2709bcde",
    "recall": "cdb3ae4073b8b9fd110c61684e074dfb96bbac18c96189648a9c009bdd7d722d",
    "context": "3b536122316a70eae5568a06e01031d161cb2ff96b0ccbffefb31f87e1cdce64",
    "save": "412d732066af6e98bf16145211bc8de11dec9cbd5ec2e4f4b4834cf76d2d020a",
    "view": "28800ffb9faf71b2f79f328c7ca3ddf752d632adf56d4cb06af861289ac38d08",
    "frames": "9085c7008a86125165345c2d17b1e400d0e14531e68e3258af79aecb8c57f178",
    "cursors": "0e6b54e7199536c78dd797da0df93133b32278d00bc52b8ac1dbaa0162a11530"
  },
  "migrations": {
    "state": "eb3c18f925195011a33169e41f171a18db3687781a5fbb2438494de92efbbe83",
    "recall": "a1a02427b829f780ee96258e13f278b93f007710d8c0cfdfa0daecb9dda4268d",
    "context": "1633751b8ac96d6f5dc440d7c5b3d884bc331f8d7b82c927f4d4a0d7119f5073",
    "save": "c0ef4cf8cd5e404c0b11e058fe341f0063985337aed6494bea9025abf7315340",
    "view": "f7cafd7d02cf1cc70fde1eafda4ed89d878574fc9672a94ec72cc103a67cb6fe",
    "frames": "894802447cfe82eb40d3d18b326064ff9fb80de2601fe4e7005695efe6a8a750",
    "cursors": "db37c9f8d192a534fea8d137ea01949b2ac55de0ccd143ebf687340a9b5c2bd0"
  }
};
function checkGolden(name, states, frames = [], cursors = []) {
  const actual = {
    state: sha(states), recall: sha(states.map(state => state.recall)),
    context: sha(states.map(historicalContext)),
    save: sha(states.map(state => R.serialize(state))),
    view: sha(states.map(state => R.view(state))), frames: sha(frames), cursors: sha(cursors)
  };
  assert.deepEqual(actual, expected[name]);
}

test('restore optimization preserves exact live frames, historical cursors, deletion exposure and atomic failures', () => {
  let state = R.create(P.get('rain-lab'));
  const frames = [];
  for (const [input, value] of [
    ['我喜欢雨', plan([report('note_root', '我喜欢雨'), { type: 'world.create', object: shape }])],
    ['雨让我想到安静', plan([{ type: 'memory.upsert', id: 'note_derived', title: '联想', body: '雨的安静' }, { type: 'character.update', changes: { mood: '安静' } }])],
    ['忘掉雨，同时我喜欢绿茶', { schema: 'her-world-turn-v2', topic: null, lines: ['先保留眼前。', '移开原来的记忆。', '这条新事实独立留下。'], beats: [
      { afterLine: 1, operations: [{ type: 'memory.remove', id: 'note_root', support: { quote: '忘掉雨' } }] },
      { afterLine: 2, operations: [report('note_tea', '我喜欢绿茶')] }
    ] }]
  ]) { const result = turn(state, input, value); state = result.state; frames.push(result.frames); }
  assert.equal(frames[2][0].memories.find(note => note.id === 'note_derived').recallStatus, 'available');
  assert.equal(frames[2][1].memories.find(note => note.id === 'note_derived').recallStatus, 'withheld');
  const cursors = state.events.flatMap((event, index) => event.plan.lines.map((_, line) => R.view(state, { event: index, line })));
  assert.deepEqual(cursors, frames.flat());
  const before = clone(state), candidate = R.propose(state, { text: '我现在喜欢海' });
  const bad = { schema: 'her-world-turn-v2', topic: null, lines: ['先记下。', '再修改。'], beats: [
    { afterLine: 0, operations: [report('note_sea', '我现在喜欢海')] },
    { afterLine: 1, operations: [{ type: 'world.remove', target: 'obj_missing' }] }
  ] };
  const rejected = R.commit(state, candidate, bad);
  assert.equal(rejected.error.code, 'TARGET_MISSING'); assert.equal(rejected.frames, undefined); assert.deepEqual(state, before);
  const accepted = R.commit(state, candidate, plan([report('note_sea', '我现在喜欢海')]));
  assert(accepted.ok); assert.deepEqual(state, before);
  checkGolden('mixed', [state, accepted.state, replay(accepted.state)], frames, cursors);
  const save = R.serialize(state);
  for (const mutate of [
    value => ({ ...value, extra: true }),
    value => { value.events[0].source = 'forged'; return value; },
    value => { Object.defineProperty(value, '__proto__', { value: { polluted: true }, enumerable: true }); return value; },
    value => Object.assign(Object.create({ polluted: true }), value)
  ]) assert.equal(R.restore(mutate(clone(save)), state.pack).ok, false);
  assert.equal({}.polluted, undefined);
});

test('restore optimization retains dense transcript trimming, exact dependency membership and capacity rollback', () => {
  const pack = P.get('rain-lab');
  pack.initialFacts = Object.fromEntries(Array.from({ length: 10 }, (_, index) => ['fixed_' + index, '\\'.repeat(800)]));
  pack.guidance = '\\'.repeat(3000);
  let state = R.create(pack);
  const frames = [];
  for (let index = 0; index < 4; index++) {
    const result = turn(state, '很长的对话' + index, plan([], Array(4).fill('\\'.repeat(500))));
    state = result.state; frames.push(result.frames);
  }
  assert(R.context(state).recentTranscript.length < state.transcript.slice(-12).length, 'must actually trim');
  const result = turn(state, '现在换个心情', plan([{ type: 'character.update', changes: { mood: '平静' } }]));
  state = result.state; frames.push(result.frames);
  const before = clone(state), oversized = plan(Array.from({ length: 12 }, (_, index) => ({ type: 'memory.upsert', id: 'note_' + index, title: '\\'.repeat(60), body: '\\'.repeat(240) })));
  const rejected = R.commit(state, R.propose(state, { text: '添很长的记录' }), oversized);
  assert.equal(rejected.error.code, 'CONTEXT_CAPACITY'); assert.equal(rejected.frames, undefined); assert.deepEqual(state, before);
  checkGolden('trimmed', [state, replay(state)], frames);
});

test('restore optimization preserves legacy null origins through revision, forgetting and independent relearning', () => {
  const legacy = { origin: { type: 'legacy-v3', version: '0.5.4', milestones: [] }, world: { objects: [{ id: 'obj_1', ...shape, source: { createdBy: '旧秘密', lastChangedBy: '旧秘密' } }], annotations: {}, weather: { kind: 'rain', name: '雨', intensity: 1, paused: false, source: null } }, memories: [{ id: 'note_old', title: '旧记忆', body: '旧秘密', source: null, latestSource: null }], transcript: [{ role: 'user', text: '旧秘密' }], facts: { rain_described: true } };
  const imported = R.importLegacy(legacy, P.get('rain-lab')); assert(imported.ok);
  let state = imported.state;
  const states = [state], frames = [];
  assert.equal(state.memories[0].source, null);
  for (const [input, operation] of [
    ['修正这条记录', { type: 'memory.upsert', id: 'note_old', title: '修正记录', body: '修正后的想法' }],
    ['忘记旧记忆', { type: 'memory.remove', id: 'note_old' }],
    ['新记得一朵云', report('note_old', '一朵云')]
  ]) { const result = turn(state, input, plan([operation])); state = result.state; states.push(replay(state)); frames.push(result.frames); }
  assert.equal(states[1].memories[0].source, null);
  assert.equal(JSON.stringify(R.context(states[2])).includes('旧秘密'), false);
  assert.equal(state.memories[0].generation, 2); assert.equal(state.memories[0].source.eventId, 'event_3');
  checkGolden('legacy', states, frames, [R.view(state, { event: 2, line: 1 })]);
});

test('restore optimization preserves all pinned predecessor migrations and complete historical frame output', () => {
  const predecessors = { 'rain-lab': { '1': '402db16c', '2': '362c6f2f', '3': 'd63194b2' }, 'lantern-lab': { '1': '8dd7d018', '2': '36792093', '3': 'ce388026' } };
  const states = [], migrations = [], cursors = [];
  for (const id of Object.keys(predecessors)) for (const version of ['1', '2', '3']) {
    const operations = [[{ type: 'world.create', object: shape, ...(version === '3' ? { placementPolicy: 'exact' } : {}) }, { type: 'memory.upsert', id: 'note_old', title: '旧记录', body: '旧内容' }], [{ type: 'memory.remove', id: 'note_old' }], [{ type: 'memory.upsert', id: 'note_old', title: '旧记录', body: '新内容' }]];
    const save = { schema: 'her-world-save-v4', pack: { id, version: '1.0.0', rulesVersion: version, digest: predecessors[id][version] }, importedSnapshot: null, events: operations.map((ops, index) => ({ id: 'event_' + (index + 1), type: 'turn', ...(version === '3' ? { rulesVersion: '3' } : {}), input: '旧时第' + index + '次请求', plan: plan(ops) })) };
    // These independent hashes pin the released pre-feature pack as well as
    // the replay implementation. Keep that authored contract for this golden;
    // the exact current-object content migration is checked separately.
    const historicalPack = P.get(id);
    if (id === 'lantern-lab') delete historicalPack.nodes.find(node => node.id === 'make').completion.existing;
    const before = clone(save), restored = R.restore(save, historicalPack); assert(restored.ok, JSON.stringify(restored.error));
    assert.deepEqual(save, before); assert.equal(restored.state.memories[0].source.text, '旧时第0次请求');
    states.push(restored.state); migrations.push(restored.migration);
    cursors.push([0, 1, 2].map(line => R.view(restored.state, { event: 2, line })));
    replay(restored.state);
  }
  checkGolden('migrations', states, migrations, cursors);
});

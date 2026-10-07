'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../framework/runtime.js');
const packs = require('../framework/packs.js');
test('200 repeated mixed edits preserve atomicity, sentence boundaries, sources and replay', () => {
  const pack = packs.get('lantern-lab');
  let state = E.create(pack);
  let random = 41721;
  const next = maximum => { random = (random * 16807) % 2147483647; return random % maximum; };
  const noteSources = new Map();
  for (let n = 0; n < 200; n++) {
    const before = E.serialize(state), beforeJSON = JSON.stringify(before), input = `第${n}轮，调整当前的小世界。`;
    let op;
    const choice = next(7), objects = state.world.objects;
    if (!objects.length || choice === 0 && objects.length < 8) op = { type: 'world.create', object: { label: '物件' + n, glyphs: '/\\\n||\n\\/', x: next(90), y: next(50), scale: 1 } };
    else if (choice === 1) op = { type: 'world.remove', target: objects[next(objects.length)].id };
    else if (choice === 2) op = { type: 'world.update', target: objects[next(objects.length)].id, changes: { x: next(90), y: next(50), scale: next(3) + 1 } };
    else if (choice === 3) op = { type: 'world.annotate', target: objects[next(objects.length)].id, field: next(2) ? 'meaning' : 'interpretation', value: n % 2 ? '第' + n + '轮的含义' : null };
    else if (choice === 4) { const id = 'note_' + next(4); op = { type: 'memory.upsert', id, title: '记录' + n, body: '这次记录的第' + n + '个细节' }; if (!noteSources.has(id)) noteSources.set(id, input); }
    else if (choice === 5) op = { type: 'character.update', changes: { trustDelta: next(11) - 5, familiarityDelta: next(11) - 5, stance: '按当前对话理解' } };
    else { const kind = ['rain', 'snow', 'mist', 'clear'][next(4)]; op = { type: 'weather.set', changes: { kind, intensity: kind === 'clear' ? 0 : next(3) + 1, paused: !!next(2) } }; }
    const plan = { schema: 'her-world-turn-v2', lines: ['让我看看这个变化。', '这次修改已经记录。'], beats: [{ afterLine: 1, operations: [op] }], topic: null };
    if (n % 7 === 0) {
      const invalid = E.commit(state, E.propose(state, { text: input }), { ...plan, beats: [{ afterLine: 1, operations: [op, { type: 'world.remove', target: 'obj_missing' }] }] });
      assert.equal(invalid.ok, false);
      assert.equal(JSON.stringify(E.serialize(state)), beforeJSON, 'invalid suffix must roll back the whole batch');
    }
    const candidate = E.propose(state, { text: input });
    const result = E.commit(state, candidate, plan);
    assert.equal(result.ok, true, `${n}: ${JSON.stringify(result.error)}`);
    assert.deepEqual(result.frames[0].world, E.view(state).world);
    assert.deepEqual(result.frames[0].memories, E.view(state).memories);
    assert.equal(JSON.stringify(E.serialize(state)), beforeJSON);
    state = result.state;
    assert.equal(E.commit(state, candidate, plan).error.code, 'STALE_PROPOSAL');
    assert.equal(state.story.completed.length, 0, 'independent edits cannot answer the purpose question');
    assert(state.character.trust >= 0 && state.character.trust <= 100);
    for (const item of state.world.objects) {
      assert(item.x >= 0 && item.y >= 0);
      assert(item.x + Math.max(...item.glyphs.split('\n').map(row => row.length)) * item.scale <= 100);
      assert(item.y + item.glyphs.split('\n').length * item.scale <= 60);
    }
    for (const note of state.memories) assert.equal(note.source.text, noteSources.get(note.id));
    if (n % 50 === 49) {
      const restored = E.restore(E.serialize(state), pack);
      assert.equal(restored.ok, true);
      assert.deepEqual(E.view(restored.state), E.view(state));
      state = restored.state;
    }
  }
});

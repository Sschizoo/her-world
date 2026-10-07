'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const { historicalCanonicalTurn, assertCurrentModelBoundary } = require('./fixtures/historical-turn.cjs');
const fixture = require('./fixtures/framework-placement-surrogate.json');
const size = object => ({ w: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale, h: object.glyphs.split('\n').length * object.scale });
function disjoint(objects) {
  for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
    const a = objects[i], b = objects[j], x = size(a), y = size(b);
    assert.equal(a.x < b.x + y.w && a.x + x.w > b.x && a.y < b.y + y.h && a.y + x.h > b.y, false, `${a.id} overlaps ${b.id}`);
  }
}
test('historical rules3 canonical plans remain collision-free in runtime/replay; current model physical proposals fail closed', async () => {
  let state = E.create(P.get(fixture.pack));
  assert.equal(fixture.rulesVersion, '3');
  for (const record of fixture.records) {
    const plan = historicalCanonicalTurn(record, fixture.rulesVersion);
    await assertCurrentModelBoundary(record, E.context(state), plan);
    const result = E.commit(state, E.propose(state, {text: record.input}), plan);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    result.frames.forEach(frame => disjoint(frame.world.objects));
    state = result.state;
    const restored = E.restore(E.serialize(state), P.get(fixture.pack));
    assert.equal(restored.ok, true, JSON.stringify(restored.error));
    assert.deepEqual(restored.state, state);
    assert.deepEqual(state.story.completed, [], 'world tinkering cannot answer the pending rain question');
  }
  assert.equal(state.world.objects.length, 5);
  assert.equal(fixture.records.length, 3);
});

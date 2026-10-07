'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const { historicalCanonicalTurn, assertCurrentModelBoundary } = require('./fixtures/historical-turn.cjs');
const fixture = require('./fixtures/framework-surrogate.json');
const placementRegression = require('./fixtures/framework-placement-regression.json');

test('three historical rules2 canonical plans preserve runtime and replay behavior; current model physical proposals fail closed', async () => {
  let state = E.create(P.get(fixture.pack));
  for (let index = 0; index < fixture.records.length; index++) {
    const record = fixture.records[index];
    assert.equal(fixture.rulesVersion, '2', 'request hashes belong to the historical rules2 prompt');
    const plan = historicalCanonicalTurn(record, fixture.rulesVersion);
    await assertCurrentModelBoundary(record, E.context(state), plan);
    const result = E.commit(state, E.propose(state, { text: record.input }), plan);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    state = result.state;
    if (index === 0) {
      assert.deepEqual(state.story.completed, ['purpose', 'make']);
      const at = plan.beats.find(beat => beat.operations.some(op => op.type === 'world.create')).afterLine;
      result.frames.forEach((frame, line) => assert.equal(frame.world.objects.length, line < at ? 0 : 1));
    }
    assert.equal(E.restore(E.serialize(state), P.get(fixture.pack)).ok, true);
  }
  assert.equal(state.world.objects.length, 1, 'hypothetical removal must not remove the bench');
  assert.match(state.world.annotations.obj_1.meaning, /听风/);
  assert.match(state.memories[0].body, /听风/);
  assert.equal(state.memories[0].source.text, fixture.records[1].input);
  assert.equal(state.memories[0].currentRevision.text, fixture.records[2].input);
  assert.equal(state.memories[0].currentRevision.number, 2);
  assert.deepEqual(state.story.completed, ['purpose', 'make'], 'side edits must not fabricate actual panel viewing');
});

test('untouched historical placement canonical plan follows the corrected gap contract while current model output fails closed', async () => {
  const state = E.create(P.get('lantern-lab'));
  const plan = historicalCanonicalTurn(placementRegression, '2');
  await assertCurrentModelBoundary(placementRegression, E.context(state), plan);
  const result = E.commit(state, E.propose(state, { text: placementRegression.input }), plan);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(result.state.story.completed, ['purpose', 'make']);
  assert.equal(result.state.world.objects[0].y, state.world.landmarks.window.y + state.world.landmarks.window.height + 1);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const { historicalCanonicalTurn, assertCurrentModelBoundary } = require('./fixtures/historical-turn.cjs');
const fixture = require('./fixtures/framework-memory-surrogate.json');
test('five historical v0.1.4 canonical plans preserve memory creation, revision, forgetting and replay', async () => {
  let state = E.create(P.get(fixture.pack));
  assert.equal(fixture.rulesVersion, '4');assert.equal(fixture.records.length, 5);
  for (const [index, record] of fixture.records.entries()) {
    const request = M.buildRequest(E.context(state), record.input);
    if (index === 4) {
      // The current static prompt has its own wind-preference example. Check
      // actual recall data and the forgotten reports, not coincidental words
      // in protocol instructions that were never sourced from this history.
      const recall = JSON.parse(request.messages.find(message => message.role === 'user').content);
      assert.doesNotMatch(JSON.stringify(recall), /风声|细雨/);
      for (const previous of [fixture.records[0], fixture.records[2]]) {
        const report = JSON.parse(previous.raw).beats.flatMap(beat => beat.operations).find(operation => operation.type === 'memory.upsert');
        assert.equal(JSON.stringify(request).includes(report.body), false, 'forgotten exact report must not enter either model message');
      }
      assert.match(JSON.stringify(E.serialize(state)), /风声/);assert.match(JSON.stringify(E.serialize(state)), /细雨/);
    }
    const plan = historicalCanonicalTurn(record, fixture.rulesVersion);
    await assertCurrentModelBoundary(record, E.context(state), plan);
    const result = E.commit(state, E.propose(state, {text: record.input}), plan);
    assert.equal(result.ok, true, JSON.stringify(result.error));state = result.state;
    assert.deepEqual(state.story.completed, [], 'remembering and forgetting cannot force a plot answer');
    const restored = E.restore(E.serialize(state), P.get(fixture.pack));assert.equal(restored.ok, true, JSON.stringify(restored.error));assert.deepEqual(restored.state, state);
    if (index === 0) {
      assert.equal(state.memories.length, 1);assert.equal(state.memories[0].kind, 'preference');assert.equal(state.memories[0].perspective, 'player_report');
      const at = plan.beats.find(beat => beat.operations.some(op => op.type === 'memory.upsert')).afterLine;
      result.frames.forEach((frame, line) => assert.equal(frame.memories.length, line < at ? 0 : 1));
      assert.match(E.context(state).memories[0].id, /^memory_[1-9][0-9]*$/);
    } else if (index === 1) { assert.equal(state.memories.length, 1);assert.equal(state.memories[0].currentRevision.number, 1); }
    else if (index === 2) {
      assert.equal(state.memories.length, 1);assert.equal(state.memories[0].source.text, fixture.records[0].input);
      assert.equal(state.memories[0].currentRevision.text, record.input);assert.equal(state.memories[0].currentRevision.number, 2);assert.match(state.memories[0].body, /细雨/);
    } else { assert.equal(state.memories.length, 0);assert.equal(E.context(state).memories.length, 0); }
    if (index === 4) { assert.doesNotMatch(plan.lines.join('\n'), /风声|细雨/);assert(!plan.beats.some(beat => beat.operations.some(op => op.type === 'memory.upsert'))); }
  }
});

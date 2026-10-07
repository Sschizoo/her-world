'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const fixture = require('./fixtures/framework-memory-surrogate.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
test('five historical v0.1.4 model responses still form, revise and forget memory under current canonical runtime', async () => {
  let state = E.create(P.get(fixture.pack));
  assert.equal(fixture.rulesVersion, '4');assert.equal(fixture.records.length, 5);
  for (const [index, record] of fixture.records.entries()) {
    assert.equal(sha(record.raw), record.sha256);
    const request = M.buildRequest(E.context(state), record.input);
    assert.match(record.requestSha256, /^[a-f0-9]{64}$/, 'historical v0.1.4 request hash remains recorded');
    if (index === 4) {
      assert.doesNotMatch(JSON.stringify(request), /风声|细雨/);
      assert.match(JSON.stringify(E.serialize(state)), /风声/);assert.match(JSON.stringify(E.serialize(state)), /细雨/);
    }
    const adapter = M.create({fetch: async () => new Response(JSON.stringify({choices: [{message: {content: record.raw}, finish_reason: 'stop'}]}), {status: 200})});
    adapter.connect('DUMMY_FRAMEWORK_TEST_ONLY');
    const plan = await adapter.request({context: E.context(state), input: record.input});
    const result = E.commit(state, E.propose(state, {text: record.input}), plan);adapter.disconnect();
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

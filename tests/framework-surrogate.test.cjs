'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const fixture = require('./fixtures/framework-surrogate.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

test('three independent raw model responses execute unchanged through current prompt/parser/runtime', async () => {
  let state = E.create(P.get(fixture.pack));
  for (let index = 0; index < fixture.records.length; index++) {
    const record = fixture.records[index];
    assert.equal(sha(record.raw), record.sha256);
    assert.equal(sha(JSON.stringify(M.buildRequest(E.context(state), record.input))), record.requestSha256, 'production request differs from independent model input');
    const adapter = M.create({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: record.raw }, finish_reason: 'stop' }] }), { status: 200 }) });
    adapter.connect('DUMMY_FRAMEWORK_TEST_ONLY');
    const plan = await adapter.request({ context: E.context(state), input: record.input });
    const result = E.commit(state, E.propose(state, { text: record.input }), plan);
    adapter.disconnect();
    assert.equal(result.ok, true, JSON.stringify(result.error));
    state = result.state;
    if (index === 0) {
      assert.deepEqual(state.story.completed, ['purpose', 'make']);
      assert.equal(result.frames[0].world.objects.length, 0);
      assert.equal(result.frames[1].world.objects.length, 1);
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

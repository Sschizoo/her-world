'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const E = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const fixture = require('./fixtures/framework-placement-surrogate.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const size = object => ({ w: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale, h: object.glyphs.split('\n').length * object.scale });
function disjoint(objects) {
  for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
    const a = objects[i], b = objects[j], x = size(a), y = size(b);
    assert.equal(a.x < b.x + y.w && a.x + x.w > b.x && a.y < b.y + y.h && a.y + x.h > b.y, false, `${a.id} overlaps ${b.id}`);
  }
}
test('historical rules3 model outputs remain collision-free under current parser/runtime', async () => {
  let state = E.create(P.get(fixture.pack));
  assert.equal(fixture.rulesVersion, '3');
  for (const record of fixture.records) {
    assert.equal(sha(record.raw), record.sha256);
    assert.match(record.requestSha256, /^[a-f0-9]{64}$/, 'historical rules3 request hash remains recorded');
    const adapter = M.create({fetch: async () => new Response(JSON.stringify({choices: [{message: {content: record.raw}, finish_reason: 'stop'}]}), {status: 200})});
    adapter.connect('DUMMY_FRAMEWORK_TEST_ONLY');
    const plan = await adapter.request({context: E.context(state), input: record.input});
    const result = E.commit(state, E.propose(state, {text: record.input}), plan);
    adapter.disconnect();
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

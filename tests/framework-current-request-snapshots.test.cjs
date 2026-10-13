'use strict';

// Offline-only snapshots of current buildRequest bytes, not model generations.
// Historical responses reconstruct known contexts; no old response is claimed
// to have been generated from these newly snapshotted current requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Runtime = require('../framework/runtime.js');
const Packs = require('../framework/packs.js');
const Model = require('../framework/model.js');
const golden = require('./fixtures/framework-current-request-snapshots.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fixtureHashes = {
  'framework-final-v019e-lantern-surrogate.json': 'd316a9b745e5178195df33a8667ec5f58304f0b66314191aa4a65bae322988e0',
  'framework-final-v019e-rain-surrogate.json': '2ae2e29558adc65f62aacb97c6517a1dc0e567985ff99f2125eaf8a99f50a674'
};

test('current request golden metadata explicitly describes offline snapshots without new model responses', () => {
  assert.equal(golden.schema, 'her-world-offline-request-snapshots-v1');
  assert.equal(golden.modelResponsesGenerated, false);
  assert.equal(golden.purpose, 'Current request-byte snapshots only; historical responses reconstruct contexts and were not generated against this prompt.');
  assert.equal(golden.records.length, 12);
  assert.deepEqual([...new Set(golden.records.map(item => item.pack))], ['lantern-lab', 'rain-lab']);
  assert(golden.records.some(item => item.activeQuestionId === 'q_visitor'));
  assert(golden.records.some(item => item.memoryCount > 0 && item.objectCount > 0));
  assert(golden.records.some(item => item.visitorChoice === 'decline'));
  for (const record of golden.records) {
    assert.equal(record.bytes <= 131072, true);
    assert.equal(Object.hasOwn(record, 'raw'), false);
    assert.equal(Object.hasOwn(record, 'response'), false);
  }
});

for (const [filename, historicalDigest] of Object.entries(fixtureHashes)) {
  test(`current request bytes and actual mock transport match fixed goldens for ${filename}`, async () => {
    const historicalBytes = fs.readFileSync(path.join(__dirname, 'fixtures', filename));
    assert.equal(sha(historicalBytes), historicalDigest, 'historical fixture remains unchanged');
    const historical = JSON.parse(historicalBytes), expected = golden.records.filter(item => item.sourceFixture === filename);
    assert.equal(expected.length, historical.records.length);
    let state = Runtime.create(Packs.get(historical.pack)), nextRecord = 0;
    const wireBodies = [];
    const model = Model.create({ fetch: async (_url, options) => {
      const record = historical.records[nextRecord++];
      assert(record, 'no additional request');
      wireBodies.push(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: record.raw }, finish_reason: 'stop' }] }));
    } });
    assert(model.connect('MOCK_ONLY_REQUEST_SNAPSHOTS'));
    try {
      for (const [index, record] of historical.records.entries()) {
        const context = Runtime.context(state), request = Model.buildRequest(context, record.input), body = JSON.stringify(request);
        const snapshot = expected[index];
        assert.equal(snapshot.sourceRecord, index);
        assert.equal(snapshot.pack, historical.pack);
        assert.equal(snapshot.input, record.input);
        assert.equal(snapshot.revision, context.revision);
        assert.equal(snapshot.contextSha256, sha(JSON.stringify(context)));
        assert.equal(snapshot.activeQuestionId, context.activeQuestionId);
        assert.equal(snapshot.memoryCount, context.memories.length);
        assert.equal(snapshot.objectCount, context.world.objects.length);
        assert.equal(snapshot.visitorChoice, context.story.answers.q_visitor?.value || null);
        assert.equal(snapshot.bytes, Buffer.byteLength(body), `current request ${index} byte count`);
        assert.equal(snapshot.requestSha256, sha(body), `current request ${index} body hash`);
        assert.equal(snapshot.requestFileSha256, sha(JSON.stringify(request, null, 2)), `current request ${index} formatted-file hash`);
        assert.notEqual(snapshot.requestSha256, record.requestSha256, 'new request snapshot is distinct from the historical generation request');
        const adapted = await model.request({ context, input: record.input });
        assert.equal(wireBodies[index], body, 'actual mock transport equals the current snapshotted builder');
        assert.equal(sha(wireBodies[index]), snapshot.requestSha256, 'actual mock wire body matches the fixed current golden');
        const committed = Runtime.commitModel(state, Runtime.propose(state, { text: record.input }), adapted);
        assert.equal(committed.ok, true, JSON.stringify(committed.error));
        state = record.afterPanelObservation ? Runtime.observe(committed.state, record.afterPanelObservation) : committed.state;
      }
      assert.equal(wireBodies.length, expected.length);
    } finally { model.disconnect(); }
  });
}

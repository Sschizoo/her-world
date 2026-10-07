'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const capabilities = require('../../framework/capabilities.js');
const memoryPolicy = require('../../framework/memory-policy.js');
const Model = require('../../framework/model.js');

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const physical = operation => ['world.create', 'world.update', 'world.remove', 'weather.set'].includes(operation.type);

// Test-only reconstruction of already captured historical canonical plans.
// These fixtures prove runtime/replay regressions, not current prompt quality
// or permission for a current model response to bypass the intent contract.
function historicalCanonicalTurn(record, rulesVersion) {
  assert.equal(sha(record.raw), record.sha256, 'historical raw response must remain byte-for-byte unchanged');
  assert.match(record.requestSha256 || record.capturedRequestSha256, /^[a-f0-9]{64}$/, 'request hash records the historical prompt, not the current prompt');
  const original = JSON.parse(record.raw);
  if (original.schema === 'her-world-turn-v2') return original;
  assert.equal(original.schema, 'her-world-turn-v3', 'only captured v2/v3 turns belong in this historical helper');
  assert.deepEqual(Object.keys(original).sort(), ['lines', 'schema', 'topic']);
  const canonical = { schema: 'her-world-turn-v2', lines: [], beats: [], topic: original.topic };
  for (const [afterLine, row] of original.lines.entries()) {
    assert.deepEqual(Object.keys(row).sort(), ['operations', 'text']);
    canonical.lines.push(row.text);
    if (!row.operations.length) continue;
    const operations = row.operations.map(operation => {
      if (rulesVersion !== '4' || operation.type !== 'memory.upsert' || operation.perspective !== 'player_report' || Object.hasOwn(operation, 'body')) return operation;
      assert(Object.hasOwn(operation, 'support'), 'historical bodyless reports require an explicit source');
      assert(capabilities.validate({ ...operation, body: operation.support?.quote }, rulesVersion), 'historical bodyless report must satisfy the canonical capability schema');
      const support = memoryPolicy.currentSupport('historical-fixture-input', record.input, operation.support);
      return { ...operation, body: support.quote };
    });
    canonical.beats.push({ afterLine, operations });
  }
  return canonical;
}

// Exercise the current adapter separately from historical canonical replay.
// Physical legacy proposals must fail closed even when their old plans remain
// valid saved/local runtime data. Nonphysical compatibility is still checked.
async function assertCurrentModelBoundary(record, context, canonical) {
  const adapter = Model.create({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: record.raw }, finish_reason: 'stop' }] }), { status: 200 }) });
  adapter.connect('DUMMY_HISTORICAL_FIXTURE_TEST_ONLY');
  try {
    if (canonical.beats.some(beat => beat.operations.some(physical))) {
      await assert.rejects(adapter.request({ context, input: record.input }), error => {
        assert.equal(error.code, 'format');
        assert.equal(error.diagnostic?.stage, 'JSON');
        assert.equal(error.diagnostic?.code, 'WORLD_INTENT_REQUIRED');
        return true;
      });
    } else {
      assert.deepEqual(await adapter.request({ context, input: record.input }), canonical);
    }
  } finally {
    adapter.disconnect();
  }
}

module.exports = { historicalCanonicalTurn, assertCurrentModelBoundary };

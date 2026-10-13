'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Budget = require('../framework/recall-budget.js');
const C = require('../framework/capabilities.js');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const Memory = require('../framework/memory-policy.js');

const clone = value => JSON.parse(JSON.stringify(value));
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const slash = '\\';
const sansCapabilities = context => { const { capabilities, ...data } = context; return data; };
const plan = operations => ({ schema: 'her-world-turn-v2', topic: null, lines: ['ok'], beats: operations.length ? [{ afterLine: 0, operations }] : [] });
function turn(state, input, operations = []) {
  const result = R.commit(state, R.propose(state, { text: input }), plan(operations));
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.state;
}

// Both archives were accepted and round-tripped by the frozen published
// v0.1.8 runtime (SHA-256 c784f0e7ea5c8dcc2f8f0f85705a36cb4543f4258cb902eecfc344bac35e5f97)
// and capabilities (SHA-256 recorded by PROFILE.sourceCapabilitiesSha256).
// Captured full-state/recall/projection hashes below are independent historical
// oracles; these tests do not generate their expected values with current code.
function archive(weatherNameLength, sixthTurn = false) {
  const pack = P.get('rain-lab');
  pack.guidance = slash.repeat(3000);
  pack.initialFacts = Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['f_' + i, slash.repeat(800)]));
  const events = Array.from({ length: 4 }, (_, i) => ({
    id: 'event_' + (i + 1), type: 'turn', rulesVersion: '4', input: slash.repeat(200),
    plan: plan([{ type: 'memory.upsert', id: 'note_' + i, title: slash.repeat(60), body: slash.repeat(240) }])
  }));
  events.push({ id: 'event_5', type: 'turn', rulesVersion: '4', input: slash.repeat(200), plan: plan([{ type: 'weather.set', changes: { name: slash.repeat(weatherNameLength) } }]) });
  if (sixthTurn) events.push({ id: 'event_6', type: 'turn', rulesVersion: '4', input: 'continue', plan: plan([]) });
  return { pack, save: { schema: 'her-world-save-v4', pack: { id: 'rain-lab', version: '1.0.0', rulesVersion: '4', digest: 'c58c3f1d' }, importedSnapshot: null, events } };
}
const historical = [
  {
    name: 'formerly rejected fixed context', weather: 40, sixth: false, bytes: 113925,
    state: '854b88dd4a58607a5fd2e136cf06e7fdc5e7605c732ede10bdb96744266ccbec',
    recall: '85fbfc0e900b6397f70a0b42f4ca35fa349ad25f10d6dc532c9c432aebcbc20f',
    context: 'e40d28b34f603e6c9f6a7b50267fcc9a8fdaa92b350785063f4d10fac6ad50e1',
    removed: ['9db2a0474fe1634b9159118d68620a3d4e57c573b6b91e488522e632ec85c60d', '32c61a14b349cdfffb8444a1d2a8e86f43b86fdd320e657c3ad1bf5953f70300', '2ad22d8fae4540c6e5bab05ba9bab55c930ee12f6cf27ca0c9af1ec0690f527b', '3b3dd3ed29c3c0c9399215521d2ebf371c49ccb687afdd78037fcfa92a2ac24b']
  },
  {
    name: 'formerly changed transcript dependency', weather: 1, sixth: true, bytes: 113911,
    state: '5f8a67e1aa575442f1f08cbd908d47839d4c8de86ac566d9b2af66406c591d30',
    recall: '3ea52a37c967a79a608ad5b790853a02c2862604a2a425418d7e18ce3d2ac564',
    context: 'abf6ffd86936ca424f036a0438b7caf6c0b637b410bab831ea48d63607074c09',
    removed: ['e47386f594b4c76b52a252f0eca049243ce21d7dd7c88fded6b6696969a11d7f', '066e218fd6b0ec903572e586e8ebcc59ddf5de06599d3d4b509b7d835b71ce08', 'ff04651e11eef4b8bb6dd90174212895bea3d24dd5d9c20fb8b7d093b48ebdb1', 'e92fd98b65bdbf7591b938df2a9ff26ad91d94d782a5250eb708d3339a615786']
  }
];

test('recall budget freezes all twelve published base descriptions with an immutable versioned profile', () => {
  assert.equal(Budget.PROFILE.version, 'her-world-recall-budget-v1');
  assert.equal(Budget.PROFILE.sourceRelease, '0.1.8');
  assert.equal(Budget.PROFILE.sourceCapabilitiesSha256, '21afe73a3091d7ad80fc9a63f22a642e583163ddf2f4f9bf55c2147790453836');
  assert.equal(sha(Budget.PROFILE.baseDescriptions), '17c2b1cd69c7fecaf42992dc9cf7477ba48b7e3af49dc99ed44d748c59fbe926');
  assert.equal(sha(Budget.PROFILE.baseDescriptions), Budget.PROFILE.descriptionsSha256);
  assert.deepEqual(Object.keys(Budget.PROFILE.baseDescriptions), C.ids);
  assert.equal(Object.keys(Budget.PROFILE.baseDescriptions).length, 12);
  assert(Object.isFrozen(Budget.PROFILE));
  assert(Object.isFrozen(Budget.PROFILE.baseDescriptions));
  assert(Object.isFrozen(Budget.createProfile(C)));
});

test('changing every base description preserves logical cost, frozen placement cost, suffixes and source data', () => {
  const context = R.context(R.create(P.get('rain-lab'))), before = clone(context);
  const currentBases = Object.fromEntries(C.descriptors(C.ids, '4').map(d => [d.id, d.description]));
  const edited = description => 'A future wording edit "\\🌧" '.repeat(30) + description;
  let measured;
  const future = {
    ...C,
    descriptors: (...args) => C.descriptors(...args).map(d => ({ ...d, description: edited(d.description) })),
    requestContextBytes: value => { measured = value; return C.requestContextBytes(value); }
  };
  const futureContext = { ...context, capabilities: context.capabilities.map(d => ({ ...d, description: edited(currentBases[d.id]) + d.description.slice(currentBases[d.id].length) })) };
  const changedBefore = clone(futureContext);
  assert.equal(Budget.createProfile(future).contextBytes(futureContext), R.contextBudgetBytes(context));
  assert(C.requestContextBytes(futureContext) > C.requestContextBytes(context));
  assert.deepEqual(sansCapabilities(measured), sansCapabilities(context));
  for (const d of measured.capabilities) {
    const original = context.capabilities.find(item => item.id === d.id);
    assert.equal(d.description, Budget.PROFILE.baseDescriptions[d.id] + original.description.slice(currentBases[d.id].length));
    const expectedSchema = ['world.create', 'world.update'].includes(d.id)
      ? C.descriptors(context.capabilities.map(item => item.id), '3', context.world, context.entities).find(item => item.id === d.id).schema
      : original.schema;
    assert.deepEqual(d.schema, expectedSchema);
  }
  assert.deepEqual(context, before);
  assert.deepEqual(futureContext, changedBefore);
  const unchangedDescriptions = context.capabilities.filter(d => currentBases[d.id] === Budget.PROFILE.baseDescriptions[d.id]);
  assert(unchangedDescriptions.length > 0);
  assert.deepEqual(context.capabilities.filter(d => currentBases[d.id] !== Budget.PROFILE.baseDescriptions[d.id]).map(d => d.id).sort(), ['memory.upsert', 'story.answer', 'world.create', 'world.update']);
  for (const capabilities of [[], unchangedDescriptions]) {
    const subset = { ...context, capabilities };
    assert.equal(R.contextBudgetBytes(subset), C.requestContextBytes(subset));
  }
});

test('logical cost retains current dynamic reference/schema changes and fails closed on unknown or mismatched profiles', () => {
  const context = clone(R.context(R.create(P.get('rain-lab'))));
  const original = R.contextBudgetBytes(context);
  context.capabilities[0].description += ' Extra current reference suffix.';
  context.capabilities[0].schema.properties.extra = { type: 'string', description: 'Current schema data' };
  assert(R.contextBudgetBytes(context) > original);
  const invalid = [
    { ...context, capabilities: [{ ...context.capabilities[0], id: 'unknown.operation' }] },
    { ...context, capabilities: [{ ...context.capabilities[0], description: 'unrecognized prefix' }] },
    { ...context, capabilities: [context.capabilities[0], context.capabilities[0]] },
    { ...context, capabilities: null }
  ];
  for (const value of invalid) assert.throws(() => R.contextBudgetBytes(value), { code: 'RECALL_BUDGET_PROFILE_INVALID' });
  for (const changes of [{ RULES_VERSION: '5' }, { ids: [...C.ids, 'unknown.operation'] }, { ids: C.ids.slice(1) }, { descriptors: () => [] }]) {
    assert.throws(() => Budget.createProfile({ ...C, ...changes }), { code: 'RECALL_BUDGET_PROFILE_INVALID' });
  }
});

for (const expected of historical) test('published near-limit archive restores exact state and recall: ' + expected.name, () => {
  const fixture = archive(expected.weather, expected.sixth), before = clone(fixture);
  const restored = R.restore(fixture.save, fixture.pack);
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  const state = restored.state, context = R.context(state), contextBefore = clone(context);
  assert.equal(sha(state), expected.state, 'every reconstructed state field must match the frozen release');
  assert.equal(sha(state.recall), expected.recall, 'historical provenance graph must match exactly');
  assert.equal(sha(sansCapabilities(context)), expected.context, 'all recall data and source channels must match');
  assert.deepEqual(state.events, fixture.save.events);
  assert.deepEqual(fixture, before);
  assert.equal(R.contextBudgetBytes(context), expected.bytes);
  assert(R.contextBudgetBytes(context) <= R.constants.MAX_CONTEXT_BYTES);
  assert(C.requestContextBytes(context) > R.constants.MAX_CONTEXT_BYTES, 'fixture must still exercise the prose-size boundary');
  assert.equal(state.memories.length, 4);
  assert(state.memories.every(note => note.body === slash.repeat(240) && note.source.text === slash.repeat(200) && note.currentRevision.text === slash.repeat(200)));
  assert.equal(context.world.weather.source.text, slash.repeat(200));
  assert.deepEqual(context.capabilities, C.descriptors(fixture.pack.capabilities, '4', state.world, fixture.pack.entities));
  const marker = '\n本轮内容与能力定义：\n';
  for (const character of ['a', '界', '🌧', slash, '"', '\ud800']) {
    const input = character.repeat(200), request = M.buildRequest(context, input);
    assert(Buffer.byteLength(JSON.stringify(request)) <= 128 * 1024);
    const system = request.messages[0].content;
    const definition = JSON.parse(system.slice(system.indexOf(marker) + marker.length));
    const user = JSON.parse(request.messages[1].content);
    assert.deepEqual(definition, C.modelDefinition(context), 'the actual model sees current definitions');
    assert.deepEqual({ ...user.context, capabilities: definition.capabilities }, context, 'transport preserves every selected field and source');
    assert.equal(user.playerSaid, input);
  }
  assert.deepEqual(context, contextBefore);
  assert.deepEqual(R.restore(R.serialize(state), fixture.pack).state, state);
  for (let n = 0; n < 4; n++) {
    const removed = turn(state, 'forget note ' + n, [{ type: 'memory.remove', id: 'note_' + n }]);
    assert.equal(sha(sansCapabilities(R.context(removed))), expected.removed[n], 'forgetting retains the historical projection and source suppression');
    assert.deepEqual(R.restore(R.serialize(removed), fixture.pack).state, removed);
  }
});

test('live continuation and replay use the same historical transcript exposure', () => {
  const fixture = archive(1), restored = R.restore(fixture.save, fixture.pack);
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  assert.deepEqual(R.context(restored.state).recentTranscript.map(item => [item.eventId, item.role]), [['event_5', 'user'], ['event_5', 'character']]);
  const next = turn(restored.state, 'continue');
  assert.equal(sha(next.recall), historical[1].recall);
  assert.equal(sha(sansCapabilities(R.context(next))), historical[1].context);
  const character = next.recall.records[next.recall.bindings[Memory.recordIds.transcript('event_6', 'character', 0)]];
  const previousUser = next.recall.bindings[Memory.recordIds.transcript('event_5', 'user', 0)];
  assert(character.dependencies.includes(previousUser), 'the historical direct user-transcript dependency must survive');
  assert.deepEqual(R.restore(R.serialize(next), fixture.pack).state, next);
});

test('recall-budget browser script exposes the same pure calculator', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../framework/recall-budget.js'), 'utf8'), { window });
  const context = R.context(R.create(P.get('rain-lab')));
  assert.equal(window.HerRecallBudget.PROFILE.descriptionsSha256, Budget.PROFILE.descriptionsSha256);
  assert.equal(window.HerRecallBudget.createProfile(C).contextBytes(context), R.contextBudgetBytes(context));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const C = require('../framework/capabilities.js');
const M = require('../framework/model.js');
const Budget = require('../framework/recall-budget.js');

const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dataOnly = context => { const { capabilities, ...data } = context; return data; };
const slash = '\\';
const marker = '\n本轮内容与能力定义：\n';
const inputs = ['x', '界', '🌧', slash, '"', '\ud800', '\udfff'].map(character => character.repeat(200));
inputs.push('x' + '\t'.repeat(199), 'x' + '\n'.repeat(199));
const plan = (operations, dense = false) => ({ schema: 'her-world-turn-v2', topic: null,
  lines: dense ? Array(4).fill(slash.repeat(500)) : ['ok'], beats: operations.length ? [{ afterLine: 0, operations }] : [] });

function wire(context, input) {
  const before = clone(context), request = M.buildRequest(context, input), system = request.messages[0].content;
  const definition = JSON.parse(system.slice(system.indexOf(marker) + marker.length));
  const user = JSON.parse(request.messages[1].content);
  assert.deepEqual(definition, C.modelDefinition(context));
  assert.deepEqual({ ...user.context, capabilities: definition.capabilities }, context);
  assert.equal(user.playerSaid, input);
  assert.deepEqual(context, before);
  assert(bytes(request) <= 128 * 1024);
  assert.deepEqual(Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'messages')),
    { model: 'glm-5.3-flash', reasoning_effort: 'low', max_tokens: 2048, stream: false });
  return bytes(request);
}

function measuredCost(context) {
  let measured;
  const budget = Budget.createProfile({ ...C, requestContextBytes: value => { measured = value; return C.requestContextBytes(value); } });
  const cost = budget.contextBytes(context);
  return { cost, measured };
}

test('alignment has an explicit costing projection and every actual definition and source remains current', () => {
  assert.equal(Budget.PROFILE.placementProjection, 'her-world-placement-budget-v1');
  for (const pack of P.list()) {
    const context = R.context(R.create(pack)), before = clone(context), { measured, cost } = measuredCost(context);
    const legacy = C.descriptors(pack.capabilities, '3', context.world, context.entities);
    assert.deepEqual(dataOnly(measured), dataOnly(context));
    for (const descriptor of measured.capabilities) {
      const current = context.capabilities.find(item => item.id === descriptor.id);
      const expected = ['world.create', 'world.update'].includes(descriptor.id)
        ? legacy.find(item => item.id === descriptor.id).schema : current.schema;
      assert.deepEqual(descriptor.schema, expected);
      if (['world.create', 'world.update'].includes(descriptor.id)) {
        assert(JSON.stringify(current.schema).includes('"align":{"type":"string","enum":["center","bottom"]}'));
        assert(!JSON.stringify(descriptor.schema).includes('"align"'));
      }
    }
    assert.equal(cost, R.contextBudgetBytes(context));
    for (const input of inputs) wire(context, input);
    assert.deepEqual(context, before);
  }
});

test('unrecognized alignment constraints remain charged and dynamic reference changes are preserved', () => {
  const context = clone(R.context(R.create(P.get('rain-lab'))));
  const baseline = R.contextBudgetBytes(context);
  const create = context.capabilities.find(item => item.id === 'world.create');
  const relative = schema => schema.properties.placement.anyOf.find(branch => branch.properties.align);
  for (const edit of [
    branch => branch.properties.align.enum.push('top'),
    branch => branch.required.push('align'),
    branch => { branch.additionalProperties = true; },
    branch => { branch.properties.extra = { type: 'string', maxLength: 4 }; },
    branch => { branch.description = 'An additional current constraint'; }
  ]) {
    const changed = clone(context), descriptor = changed.capabilities.find(item => item.id === create.id);
    edit(relative(descriptor.schema));
    const { measured, cost } = measuredCost(changed);
    assert.deepEqual(measured.capabilities.find(item => item.id === create.id).schema, descriptor.schema,
      'only the exact reviewed align extension can be normalized');
    assert(cost > baseline);
  }
  for (const branch of create.schema.properties.placement.anyOf) if (branch.properties.target) branch.properties.target.enum.push('new_current_landmark');
  create.schema.properties.extra = { type: 'string', description: 'Retained current schema' };
  create.description += ' Retained current suffix.';
  const { measured, cost } = measuredCost(context), projected = measured.capabilities.find(item => item.id === create.id);
  assert(cost > baseline);
  assert(projected.schema.properties.placement.anyOf.some(branch => branch.properties.target?.enum.includes('new_current_landmark')));
  assert.deepEqual(projected.schema.properties.extra, create.schema.properties.extra);
  assert(projected.description.endsWith(' Retained current suffix.'));
  wire(context, '继续');
});

function oldArchive(rules) {
  const events = [], append = operations => events.push({ id: 'event_' + (events.length + 1), type: 'turn',
    ...(['1', '2'].includes(rules) ? {} : { rulesVersion: rules }), input: slash.repeat(200), plan: plan(operations, true) });
  for (let index = 0; index < 14; index++) append([{ type: 'memory.upsert', id: 'note_' + index, title: slash.repeat(60), body: slash.repeat(240) }]);
  for (let index = 0; index < (rules === '4' ? 1 : 8); index++) append([{ type: 'world.create',
    object: { label: slash.repeat(40), glyphs: Array(10).fill(slash.repeat(24)).join('\n'), x: (index % 4) * 25, y: Math.floor(index / 4) * 10, scale: 1 },
    ...(['3', '4'].includes(rules) ? { placementPolicy: 'exact' } : {}) }]);
  append([]);
  return { schema: 'her-world-save-v4', pack: { id: 'rain-lab', version: '1.0.0', rulesVersion: rules,
    digest: { 1: '402db16c', 2: '362c6f2f', 3: 'd63194b2', 4: '7f91f3a5' }[rules] }, importedSnapshot: null, events };
}

// Independent captures from the frozen v0.1.9b runtime/recall-budget with
// capabilities SHA-256 b6594439443e7f4029da659a21494a521e80485d135cec0280bbf5f69451afb0.
// These expectations are not generated with the current costing projection.
const oldGoldens = {
  '1': { bytes: 113811, state: '77fa6407ad2a84ed9e9ab21500fa1e912aa5e27cd137c013d3d95addb563497d', recall: '2419b14357323f189623c5f7a6e74d8b5fe52bd600d1538e899e07f4e3d101f2', data: '9889921e7a93f9cd51b82328657c3b293e3cfe8ea6a23465d526e119b48862eb' },
  '2': { bytes: 113811, state: '77fa6407ad2a84ed9e9ab21500fa1e912aa5e27cd137c013d3d95addb563497d', recall: '2419b14357323f189623c5f7a6e74d8b5fe52bd600d1538e899e07f4e3d101f2', data: '9889921e7a93f9cd51b82328657c3b293e3cfe8ea6a23465d526e119b48862eb' },
  '3': { bytes: 113811, state: 'ced2bdb52d9e1c43661fce74da91b0766fa5a5b6a64a2714d2500207418201dd', recall: '2419b14357323f189623c5f7a6e74d8b5fe52bd600d1538e899e07f4e3d101f2', data: '9889921e7a93f9cd51b82328657c3b293e3cfe8ea6a23465d526e119b48862eb' },
  '4': { bytes: 114094, state: 'a35b634bfa204044150ae96acb30e9eed6ceb29077dea7a1510356576a6af9a5', recall: 'de755217936d5747ba14af6fafe90f2966529bf0bb2850e2066643833a6aa846', data: '014a0187c7a47de0bc5cdd87892bb859da2e164774c430839f0a83a1d03d2d33' }
};
for (const [rules, expected] of Object.entries(oldGoldens)) test('near-cap rules ' + rules + ' keeps the frozen state, recall dependencies and source projection', () => {
  const save = oldArchive(rules), before = clone(save), restored = R.restore(save, P.get('rain-lab'));
  assert(restored.ok, JSON.stringify(restored.error));
  const state = restored.state, context = R.context(state);
  assert.equal(hash(state), expected.state);
  assert.equal(hash(state.recall), expected.recall);
  assert.equal(hash(dataOnly(context)), expected.data);
  assert.equal(R.contextBudgetBytes(context), expected.bytes);
  assert(R.constants.MAX_CONTEXT_BYTES - expected.bytes < 1024);
  assert.equal(state.memories.length, 14);
  assert(context.recentTranscript.length < 12);
  for (const input of inputs) wire(context, input);
  assert.deepEqual(R.restore(R.serialize(state), state.pack).state, state);
  assert.deepEqual(save, before);
});

test('an admitted dense custom pack retains every fact and current align definition at the logical limit', () => {
  const pack = P.get('rain-lab');
  pack.guidance = slash.repeat(3000);
  pack.initialFacts = Object.fromEntries(Array.from({ length: 10 }, (_, index) => ['f_' + index, slash.repeat(800)]));
  assert(R.validatePack(pack).ok);
  let state = R.create(pack);
  for (let index = 0; index < 4; index++) {
    const result = R.commit(state, R.propose(state, { text: slash.repeat(200) }), plan([
      { type: 'memory.upsert', id: 'note_' + index, title: slash.repeat(60), body: slash.repeat(240) }
    ]));
    assert(result.ok, JSON.stringify(result.error)); state = result.state;
  }
  const context = R.context(state);
  assert.deepEqual(context.facts, pack.initialFacts);
  assert.equal(context.guidance, pack.guidance);
  const padded = clone(context); padded.facts.boundary = '';
  padded.facts.boundary = 'x'.repeat(R.constants.MAX_CONTEXT_BYTES - R.contextBudgetBytes(padded));
  assert.equal(R.contextBudgetBytes(padded), R.constants.MAX_CONTEXT_BYTES);
  for (const input of inputs) wire(padded, input);
  assert.deepEqual(R.restore(R.serialize(state), pack).state, state);
});

test('every capability subset fits the unchanged wire bound with maximally escaped input', () => {
  const context = clone(R.context(R.create(P.get('rain-lab'))));
  const longIds = (prefix, count) => Array.from({ length: count }, (_, index) => prefix + String(index).padStart(2, '0') + 'x'.repeat(61));
  context.entities = longIds('e', 32).map(id => ({ id, label: 'entity', kind: 'fixture' }));
  context.world.landmarks = Object.fromEntries(longIds('l', 12).map(id => [id, { x: 0, y: 0, width: 100, height: 60 }]));
  let maximum = 0, worst;
  for (const count of [0, 8]) {
    context.world.nextId = 9993;
    context.world.objects = Array.from({ length: count }, (_, index) => ({ id: 'obj_' + (9985 + index), label: 'object', glyphs: 'X', x: index * 2, y: 0, scale: 1 }));
    for (let mask = 0; mask < 1 << C.ids.length; mask++) {
      const ids = C.ids.filter((_, index) => mask & (1 << index));
      context.capabilities = C.descriptors(ids, '4', context.world, context.entities);
      const logical = R.contextBudgetBytes(context), actual = bytes(M.buildRequest(context, '\ud800'.repeat(200)));
      // Padding ordinary user-context text adds exactly the same byte count to
      // logical and actual envelopes. Exhaustively test the resulting margin.
      const atLimit = R.constants.MAX_CONTEXT_BYTES + actual - logical;
      assert(atLimit <= 128 * 1024, JSON.stringify({ count, ids, atLimit }));
      if (atLimit > maximum) { maximum = atLimit; worst = clone(context); }
    }
  }
  worst.facts.boundary = '';
  worst.facts.boundary = 'x'.repeat(R.constants.MAX_CONTEXT_BYTES - R.contextBudgetBytes(worst));
  assert.equal(R.contextBudgetBytes(worst), R.constants.MAX_CONTEXT_BYTES);
  assert.equal(wire(worst, '\ud800'.repeat(200)), maximum);
  assert.equal(maximum, 128739); // Includes the final source-classification prompt; the 128 KiB cap is unchanged.
  const over = clone(worst); over.facts.boundary += 'x'.repeat(128 * 1024 - maximum + 1);
  assert.throws(() => M.buildRequest(over, '\ud800'.repeat(200)), error => error.diagnostic?.code === 'REQUEST_TOO_LARGE');
});

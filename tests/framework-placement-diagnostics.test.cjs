'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const secret = 'sk-TEST_ONLY_NEVER_ECHO_987654321';
const clone = value => JSON.parse(JSON.stringify(value));
const plan = operations => ({ schema: 'her-world-turn-v2', lines: ['摆放物件。'], beats: [{ afterLine: 0, operations }], topic: null });
const fresh = pack => R.create(pack || P.get('rain-lab'));
const create = (label = '小云', x = 20, y = 20) => ({ type: 'world.create', object: { label, glyphs: 'XX', scale: 1, x, y }, placementPolicy: 'exact' });
const anchor = (placement, glyphs = 'X', scale = 1) => ({ type: 'world.create', object: { label: '云', glyphs, scale }, placement });
const update = (target, placement, changes = {}) => ({ type: 'world.update', target, changes, ...(placement ? { placement } : {}) });
const commit = (state, operations, model = false) => R[model ? 'commitModel' : 'commit'](state, R.propose(state, { text: '调整物件。' }), plan(operations));
const turn = (state, operations) => { const result = commit(state, operations); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const reasons = new Set(['SCHEMA_INVALID', 'OBJECT_TARGET_MISSING', 'OBJECT_LABEL_USED', 'REFERENCE_TARGET_MISSING', 'REFERENCE_LABEL_USED', 'LANDMARK_MISSING', 'SELF_TARGET', 'FOOTPRINT_INVALID', 'LANDMARK_FOOTPRINT', 'OUT_OF_BOUNDS', 'POSITION_OCCUPIED', 'NO_FREE_POSITION', 'SEARCH_BUDGET', 'SEARCH_CHOICE', 'WORLD_CAPACITY']);
const anchors = new Set(['sky', 'ground', 'keep_center', 'keep_base', 'window_left', 'window_right', 'window_below', 'above', 'below', 'left_of', 'right_of']);
function safeDiagnostic(value) {
  assert.equal(JSON.stringify(value).includes(secret), false);
  const d = value.error.diagnostic;
  assert.equal(d.stage, 'RUNTIME'); assert.equal(d.reason, 'OPERATION_REJECTED');
  assert.match(d.path, /^beats\[[0-3]\]\.operations\[(?:[0-9]|1[01])\]$/u);
  assert.ok(reasons.has(d.geometryReason));
  const allowed = new Set(['stage', 'reason', 'path', 'beatIndex', 'operationIndex', 'operationType', 'geometryReason', 'placementAnchor', 'placementPolicy', 'footprintCols', 'footprintRows', 'occupiedCount']);
  assert.ok(Object.keys(d).every(key => allowed.has(key)));
  if ('placementAnchor' in d) assert.ok(anchors.has(d.placementAnchor));
  if ('placementPolicy' in d) assert.ok(['auto', 'exact'].includes(d.placementPolicy));
  assert.ok(Number.isInteger(d.occupiedCount) && d.occupiedCount >= 0 && d.occupiedCount <= 8);
  if ('footprintCols' in d || 'footprintRows' in d) {
    assert.ok(Number.isInteger(d.footprintCols) && d.footprintCols >= 1 && d.footprintCols <= 72);
    assert.ok(Number.isInteger(d.footprintRows) && d.footprintRows >= 1 && d.footprintRows <= 30);
  }
  return d;
}
function rejected(state, operations, code, reason, model = false) {
  const before = JSON.stringify(state), saved = JSON.stringify(R.serialize(state)), request = JSON.stringify(operations);
  const result = commit(state, operations, model);
  assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(result.error.path, '$');
  assert.equal(result.state, undefined); assert.equal(result.frames, undefined);
  assert.equal(safeDiagnostic(result).geometryReason, reason);
  assert.equal(JSON.stringify(state), before); assert.equal(JSON.stringify(R.serialize(state)), saved); assert.equal(JSON.stringify(operations), request);
  return result.error.diagnostic;
}

test('missing object IDs and unique visible labels are distinguished without accepting or echoing either', () => {
  const state = turn(fresh(), [create()]);
  assert.equal(R.context(state).world.objects[0].label, '小云');
  for (const model of [false, true]) {
    const missing = rejected(state, [update(secret, null, { x: 30 })], 'TARGET_MISSING', 'OBJECT_TARGET_MISSING', model);
    assert.equal(missing.occupiedCount, 1); assert.equal(missing.footprintCols, undefined);
    rejected(state, [update('obj_999', null, { x: 30 })], 'TARGET_MISSING', 'OBJECT_TARGET_MISSING', model);
    rejected(state, [update('小云', null, { x: 30 })], 'TARGET_MISSING', 'OBJECT_LABEL_USED', model);
  }
  const duplicate = turn(state, [create('小云', 30)]);
  rejected(duplicate, [update('小云', null, { x: 40 })], 'TARGET_MISSING', 'OBJECT_TARGET_MISSING');
});

test('relative references distinguish unknown IDs, unique labels, missing built-in landmarks and self-targets', () => {
  const state = turn(fresh(), [create()]);
  for (const target of [secret, 'obj_999', 'missing_landmark']) rejected(state, [anchor({ anchor: 'right_of', target })], 'PLACEMENT_TARGET', 'REFERENCE_TARGET_MISSING');
  rejected(state, [anchor({ anchor: 'right_of', target: '小云' })], 'PLACEMENT_TARGET', 'REFERENCE_LABEL_USED');
  const self = rejected(state, [update('obj_1', { anchor: 'right_of', target: 'obj_1' })], 'PLACEMENT_INVALID', 'SELF_TARGET');
  assert.equal(self.occupiedCount, 0); assert.equal(self.footprintCols, 2); assert.equal(self.footprintRows, 1);
  const duplicate = turn(state, [create('小云', 30)]);
  rejected(duplicate, [anchor({ anchor: 'above', target: '小云' })], 'PLACEMENT_TARGET', 'REFERENCE_TARGET_MISSING');
  for (const target of ['constructor', '__proto__', 'toString']) rejected(state, [anchor({ anchor: 'above', target })], 'GEOMETRY_INVALID', 'REFERENCE_TARGET_MISSING');
});

test('missing fixed landmarks report only a fixed anchor and local category', () => {
  const pack = P.get('rain-lab'); pack.world.landmarks = {};
  const state = fresh(pack);
  for (const value of ['sky', 'ground', 'window_left', 'window_right', 'window_below']) {
    const d = rejected(state, [anchor({ anchor: value })], 'PLACEMENT_TARGET', 'LANDMARK_MISSING');
    assert.equal(d.placementAnchor, value); assert.equal(d.placementPolicy, 'auto');
  }
  for (const target of ['sky', 'ground', 'window']) rejected(state, [anchor({ anchor: 'below', target })], 'PLACEMENT_TARGET', 'LANDMARK_MISSING');
});

test('wrong keys, invalid coordinate values and forged diagnostic fields never reflect model strings', () => {
  const state = turn(fresh(), [create()]);
  const cases = [
    { ...create(), [secret]: secret },
    { ...create(), geometryReason: secret, placementAnchor: secret, footprintCols: secret },
    { ...create(), object: { ...create().object, [secret]: secret } },
    { ...create(), object: { ...create().object, x: secret } },
    { ...create(), object: { ...create().object, x: { [secret]: secret } } },
    { ...create(), object: { ...create().object, y: -1 } },
    { ...create(), object: { ...create().object, x: 0.5 } },
    { ...create(), placementPolicy: secret },
    anchor({ anchor: secret, target: secret, [secret]: secret }),
    anchor({ anchor: 'sky', target: secret }),
    anchor({ anchor: 'right_of', target: secret, gap: secret }),
    update('obj_1', { anchor: 'sky' }, { x: secret }),
    update('obj_1', null, { [secret]: secret })
  ];
  for (const op of cases) rejected(state, [op], 'OPERATION_INVALID', 'SCHEMA_INVALID', true);
  const d = rejected(state, [{ ...create(), placementPolicy: secret }], 'OPERATION_INVALID', 'SCHEMA_INVALID');
  assert.equal(d.placementPolicy, undefined);
  const unrecognized = rejected(state, [anchor({ anchor: secret, target: secret })], 'OPERATION_INVALID', 'SCHEMA_INVALID');
  assert.equal(unrecognized.placementAnchor, undefined);
});

test('footprints are bounded, include whitespace, and never include glyphs or coordinates', () => {
  const state = fresh();
  const largest = { ...create(), object: { label: secret, glyphs: Array(10).fill('X'.repeat(24)).join('\n'), scale: 3, x: 99, y: 59 } };
  const d = rejected(state, [largest], 'GEOMETRY_INVALID', 'OUT_OF_BOUNDS');
  assert.equal(d.footprintCols, 72); assert.equal(d.footprintRows, 30);
  const padded = { ...create(), object: { label: '云', glyphs: 'X   \n    ', scale: 2, x: 99, y: 59 } };
  const padding = rejected(state, [padded], 'GEOMETRY_INVALID', 'OUT_OF_BOUNDS');
  assert.equal(padding.footprintCols, 8); assert.equal(padding.footprintRows, 4);
  for (const glyphs of ['X'.repeat(25), Array(11).fill('X').join('\n'), '非ASCII', '   ', 'X\t']) {
    const invalid = rejected(state, [{ ...create(), object: { ...create().object, glyphs } }], 'GEOMETRY_INVALID', 'FOOTPRINT_INVALID');
    assert.equal(invalid.footprintCols, undefined); assert.equal(invalid.footprintRows, undefined);
  }
});

test('landmark size, fixed collisions and object count capacity have distinct local reasons', () => {
  const pack = P.get('rain-lab'); pack.world.landmarks.sky = { x: 0, y: 0, width: 1, height: 1 };
  rejected(fresh(pack), [anchor({ anchor: 'sky' }, 'XX')], 'GEOMETRY_INVALID', 'LANDMARK_FOOTPRINT');
  const state = turn(fresh(), [create(), create('邻居', 22)]);
  const collision = rejected(state, [update('obj_1', { anchor: 'keep_center' }, { scale: 3 })], 'PLACEMENT_CAPACITY', 'POSITION_OCCUPIED');
  assert.equal(collision.occupiedCount, 1); assert.equal(collision.footprintCols, 6); assert.equal(collision.footprintRows, 3);
  rejected(state, [create()], 'PLACEMENT_CAPACITY', 'POSITION_OCCUPIED');
  const full = turn(fresh(), Array.from({ length: 8 }, (_, i) => create('云', i * 3)));
  assert.equal(rejected(full, [create()], 'WORLD_CAPACITY', 'WORLD_CAPACITY').occupiedCount, 8);
});

test('bounded joint-search attempt exhaustion retains the failed operation diagnostic', () => {
  const pack = P.get('rain-lab'); pack.world.landmarks.sky = { x: 0, y: 0, width: 20, height: 20 };
  // 400 positions for the first object cannot leave room for the second, which
  // fills the landmark. The 256-attempt limit arrives before the work limit.
  const operations = [anchor({ anchor: 'sky' }), anchor({ anchor: 'sky' }, Array(10).fill('X'.repeat(10)).join('\n'), 2)];
  const d = rejected(fresh(pack), operations, 'PLACEMENT_CAPACITY', 'SEARCH_BUDGET');
  assert.equal(d.path, 'beats[0].operations[1]'); assert.equal(d.operationIndex, 1);
  assert.equal(d.placementAnchor, 'sky'); assert.equal(d.footprintCols, 20); assert.equal(d.footprintRows, 20); assert.equal(d.occupiedCount, 1);
});

test('later geometric failure rolls back staged memory, dialogue and earlier successful placements', () => {
  const state = fresh();
  const operations = [
    { type: 'memory.upsert', id: 'note_cloud', title: '云', body: '想看云' },
    create(),
    update('obj_1', { anchor: 'right_of', target: secret })
  ];
  const d = rejected(state, operations, 'PLACEMENT_TARGET', 'REFERENCE_TARGET_MISSING', true);
  assert.equal(d.operationIndex, 2); assert.equal(d.occupiedCount, 0);
  assert.equal(state.world.objects.length, 0); assert.equal(state.memories.length, 0); assert.equal(state.transcript.length, 0);
});

test('valid references and resize keep canonical saved plans, sentence snapshots and replay deterministic', () => {
  const state = turn(fresh(), [create(), anchor({ anchor: 'right_of', target: 'obj_1', gap: 3 })]);
  const before = clone(R.serialize(state));
  const operations = [update('obj_1', { anchor: 'keep_base' }, { scale: 2 }), update('obj_2', { anchor: 'below', target: 'window' })];
  const requested = clone(operations), result = commit(state, operations);
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.deepEqual(operations, requested);
  assert.deepEqual(R.serialize(state), before);
  const saved = R.serialize(result.state);
  for (const name of ['diagnostic', 'geometryReason', 'footprintCols', 'occupiedCount']) assert.equal(JSON.stringify(saved).includes(name), false);
  for (const op of saved.events.at(-1).plan.beats[0].operations) { assert.equal(op.placement, undefined); assert.equal(op.placementPolicy, 'exact'); }
  const restored = R.restore(saved, result.state.pack);
  assert.equal(restored.ok, true); assert.deepEqual(R.serialize(restored.state), saved);
  assert.deepEqual(R.view(restored.state, { event: 1, line: 0 }), result.frames[0]);
});

test('discarding successful placement or a failed diagnostic leaves the original proposal and state unchanged', () => {
  const state = fresh(), proposal = R.propose(state, { text: '调整物件。' });
  const before = JSON.stringify(state), proposalBefore = JSON.stringify(proposal);
  const bad = R.commit(state, proposal, plan([anchor({ anchor: 'right_of', target: secret })]));
  assert.equal(bad.ok, false); safeDiagnostic(bad);
  const discarded = R.commit(state, proposal, plan([create()]));
  assert.equal(discarded.ok, true); assert.equal(JSON.stringify(state), before); assert.equal(JSON.stringify(proposal), proposalBefore);
  const observed = R.observe(state, { type: 'panel.viewed', panel: 'world' });
  assert.deepEqual(R.commit(observed, proposal, plan([create()])), { ok: false, error: { code: 'STALE_PROPOSAL', path: '$' } });
});

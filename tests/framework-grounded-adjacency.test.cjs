'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const C = require('../framework/capabilities.js');
const copy = value => JSON.parse(JSON.stringify(value));
const size = object => ({ width: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale, height: object.glyphs.split('\n').length * object.scale });
const point = object => ({ x: object.x, y: object.y });
const bottom = object => object.y + size(object).height;
const rect = (label, x, y, width, height, scale = 1) => ({ type: 'world.create', object: { label, x, y, glyphs: Array(height).fill('X'.repeat(width)).join('\n'), scale }, placementPolicy: 'exact' });
const beside = (target = 'obj_2', reference = 'obj_1', anchor = 'left_of', gap = 3, changes = {}, extra = {}) => ({ type: 'world.update', target, changes, placement: { anchor, target: reference, gap }, ...extra });
const plan = operations => ({ schema: C.SCHEMA, topic: null, lines: ['位置调整好了。'], beats: [{ afterLine: 0, operations }] });
const commit = (state, operations) => R.commit(state, R.propose(state, { text: '只移动指定物件，保留两者之间的空隙。' }), plan(operations));
const turn = (state, operations) => { const result = commit(state, operations); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const pack = ground => { const value = P.get('rain-lab'); if (ground !== undefined) value.world.landmarks.ground = ground; return value; };
function roundTrip(state) {
  const saved = R.serialize(state), restored = R.restore(JSON.stringify(saved), state.pack);
  assert.equal(restored.ok, true, JSON.stringify(restored.error)); assert.deepEqual(restored.state, state);
  return restored.state;
}

test('moving a scaled ground-contact object beside a shorter grounded object keeps its baseline', () => {
  const before = turn(R.create(pack()), [rect('横向物件', 28, 42, 17, 4), rect('竖向物件', 50, 38, 6, 4, 2)]);
  const original = copy(R.serialize(before)), operation = beside(), requested = copy(operation);
  const after = turn(before, [operation]);
  assert.deepEqual(point(after.world.objects[1]), { x: 13, y: 38 });
  assert.equal(bottom(after.world.objects[1]), bottom(before.world.objects[1]));
  assert.deepEqual(after.world.objects[0], before.world.objects[0]);
  assert.deepEqual(R.serialize(before), original); assert.deepEqual(operation, requested);
  roundTrip(after);
});

test('both recognized ground contact edges survive left/right moves and simultaneous unequal resizing', () => {
  for (const baseline of [46, 47]) for (const anchor of ['left_of', 'right_of']) for (const scale of [1, 2, 3]) {
    const before = turn(R.create(pack()), [rect('参照', 40, baseline - 6, 4, 3, 2), rect('待移动', 75, baseline - 3, 3, 3)]);
    const after = turn(before, [beside('obj_2', 'obj_1', anchor, 2, { scale })]), object = after.world.objects[1];
    assert.deepEqual(point(object), { x: anchor === 'left_of' ? 38 - 3 * scale : 50, y: baseline - 3 * scale });
    assert.equal(bottom(object), baseline); assert.deepEqual(after.world.objects[0], before.world.objects[0]);
    const normalized = after.events.at(-1).plan.beats[0].operations[0];
    assert.equal(normalized.placement, undefined); assert.equal(normalized.placementPolicy, 'exact');
    assert.deepEqual({ x: normalized.changes.x, y: normalized.changes.y }, point(object));
    roundTrip(after);
  }
});

test('alternating horizontal moves and inverse size changes do not accumulate vertical drift', () => {
  const before = turn(R.create(pack()), [rect('参照', 28, 42, 17, 4), rect('另一件', 48, 42, 6, 4)]);
  let state = before;
  for (let i = 0; i < 3; i++) {
    state = turn(state, [beside('obj_2', 'obj_1', 'left_of', 3, { scale: 2 })]);
    assert.deepEqual(point(state.world.objects[1]), { x: 13, y: 38 });
    state = turn(state, [beside('obj_2', 'obj_1', 'right_of', 3, { scale: 1 })]);
    assert.deepEqual(point(state.world.objects[1]), point(before.world.objects[1]));
  }
  assert.deepEqual(state.world.objects[0], before.world.objects[0]); roundTrip(state);
});

test('creates without a prior baseline still center beside a grounded reference', () => {
  for (const baseline of [46, 47]) for (const anchor of ['left_of', 'right_of']) {
    const before = turn(R.create(pack()), [rect('参照', 28, baseline - 4, 17, 4)]);
    const operation = { type: 'world.create', object: { label: '新物件', glyphs: 'XXXXXX\nXXXXXX\nXXXXXX\nXXXXXX', scale: 2 }, placement: { anchor, target: 'obj_1', gap: 3 } };
    const after = turn(before, [operation]);
    assert.deepEqual(point(after.world.objects[1]), { x: anchor === 'left_of' ? 13 : 48, y: baseline - 6 });
    assert.deepEqual(after.world.objects[0], before.world.objects[0]); roundTrip(after);
  }
});

test('airborne objects, airborne references and unequal contact baselines retain relative centering', () => {
  for (const [referenceBaseline, movingBaseline] of [[46, 16], [16, 46], [16, 16], [45, 45], [48, 48], [46, 47], [47, 46]]) {
    const before = turn(R.create(pack()), [rect('参照', 28, referenceBaseline - 4, 17, 4), rect('另一件', 60, movingBaseline - 8, 6, 4, 2)]);
    const after = turn(before, [beside()]);
    assert.deepEqual(point(after.world.objects[1]), { x: 13, y: referenceBaseline - 6 });
    assert.deepEqual(after.world.objects[0], before.world.objects[0]); roundTrip(after);
  }
});

test('missing ground or objects outside its width do not infer ground contact', () => {
  for (const ground of [null, { x: 20, y: 46, width: 40, height: 1 }]) {
    const value = pack();
    if (ground) value.world.landmarks.ground = ground; else delete value.world.landmarks.ground;
    const before = turn(R.create(value), [rect('参照', 28, 42, 17, 4), rect('另一件', 65, 38, 6, 4, 2)]);
    const after = turn(before, [beside()]);
    assert.deepEqual(point(after.world.objects[1]), { x: 13, y: 40 }); roundTrip(after);
  }
});

test('sky, landmark and vertical relative anchors retain their original geometry', () => {
  const before = turn(R.create(pack()), [rect('参照', 28, 42, 17, 4), rect('另一件', 60, 38, 6, 4, 2)]);
  for (const anchor of ['above', 'below']) {
    const after = turn(before, [beside('obj_2', 'obj_1', anchor, 3)]);
    assert.deepEqual(point(after.world.objects[1]), { x: 30, y: anchor === 'above' ? 31 : 49 }); roundTrip(after);
  }
  const sky = turn(before, [{ type: 'world.update', target: 'obj_2', changes: {}, placement: { anchor: 'sky' } }]);
  assert.deepEqual(point(sky.world.objects[1]), { x: 44, y: 6 });
  const landmark = turn(before, [beside('obj_2', 'window', 'right_of', 3)]);
  assert.deepEqual(point(landmark.world.objects[1]), { x: 46, y: 31 }); roundTrip(landmark);
});

test('exact relative centering and exact numeric coordinates remain deliberate', () => {
  const before = turn(R.create(pack()), [rect('参照', 28, 42, 17, 4), rect('另一件', 50, 38, 6, 4, 2)]);
  const exact = turn(before, [beside('obj_2', 'obj_1', 'left_of', 3, {}, { placementPolicy: 'exact' })]);
  assert.deepEqual(point(exact.world.objects[1]), { x: 13, y: 40 }); roundTrip(exact);
  const numeric = turn(before, [{ type: 'world.update', target: 'obj_2', changes: { x: 13, y: 41 }, placementPolicy: 'exact' }]);
  assert.deepEqual(point(numeric.world.objects[1]), { x: 13, y: 41 }); roundTrip(numeric);
});

test('an obstacle at the requested contact point rejects the whole turn instead of changing the gap or baseline', () => {
  const before = turn(R.create(pack()), [rect('参照', 28, 42, 17, 4), rect('另一件', 50, 38, 6, 4, 2), rect('障碍', 13, 38, 2, 2)]);
  const saved = copy(R.serialize(before)), operations = [{ type: 'weather.set', changes: { paused: true } }, beside()], requested = copy(operations);
  const result = commit(before, operations);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'PLACEMENT_CAPACITY');
  assert.equal(result.error.diagnostic.geometryReason, 'NO_FREE_POSITION');
  assert.equal(result.error.diagnostic.operationIndex, 1); assert.equal(result.frames, undefined); assert.equal(result.state, undefined);
  assert.deepEqual(R.serialize(before), saved); assert.deepEqual(operations, requested);
});

test('horizontal ground bounds reject a gap that fits the grid but leaves the ground region', () => {
  const ground = { x: 20, y: 46, width: 60, height: 1 };
  for (const anchor of ['left_of', 'right_of']) {
    const objects = anchor === 'left_of' ? [rect('参照', 30, 42, 17, 4), rect('另一件', 60, 38, 6, 4, 2)] : [rect('参照', 60, 42, 10, 4), rect('另一件', 30, 38, 6, 4, 2)];
    const before = turn(R.create(pack(ground)), objects), saved = copy(R.serialize(before));
    const result = commit(before, [beside('obj_2', 'obj_1', anchor)]);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'PLACEMENT_CAPACITY');
    assert.equal(result.error.diagnostic.geometryReason, 'NO_FREE_POSITION'); assert.deepEqual(R.serialize(before), saved);
  }
});

test('grid edges and a resize taller than the existing baseline reject impossible ground contact', () => {
  for (const anchor of ['left_of', 'right_of']) {
    const x = anchor === 'left_of' ? 5 : 85;
    const before = turn(R.create(pack()), [rect('参照', x, 42, 10, 4), rect('另一件', 40, 38, 6, 4, 2)]);
    const result = commit(before, [beside('obj_2', 'obj_1', anchor)]);
    assert.equal(result.ok, false); assert.equal(result.error.diagnostic.geometryReason, 'OUT_OF_BOUNDS');
  }
  const before = turn(R.create(pack({ x: 0, y: 5, width: 100, height: 1 })), [rect('参照', 28, 1, 17, 4), rect('另一件', 60, 1, 6, 4)]);
  const result = commit(before, [beside('obj_2', 'obj_1', 'left_of', 3, { scale: 2 })]);
  assert.equal(result.ok, false); assert.equal(result.error.diagnostic.geometryReason, 'OUT_OF_BOUNDS');
});

test('full object capacity does not prevent moving one object or disturb its neighbors', () => {
  const objects = [rect('参照', 28, 42, 17, 4), rect('另一件', 50, 38, 6, 4, 2), ...Array.from({ length: 6 }, (_, i) => rect('旁观' + i, 80, i, 1, 1))];
  const before = turn(R.create(pack()), objects), after = turn(before, [beside()]);
  assert.equal(after.world.objects.length, before.world.capacity); assert.deepEqual(point(after.world.objects[1]), { x: 13, y: 38 });
  before.world.objects.forEach((object, i) => { if (i !== 1) assert.deepEqual(after.world.objects[i], object); });
  roundTrip(after);
});

test('same-turn grounded creations establish a baseline for a later update and replay sentence frames exactly', () => {
  const before = R.create(pack());
  const requested = { schema: C.SCHEMA, topic: null, lines: ['先摆好。', '再移动。'], beats: [
    { afterLine: 0, operations: [rect('参照', 28, 42, 17, 4), rect('另一件', 50, 38, 6, 4, 2)] },
    { afterLine: 1, operations: [beside()] }
  ] }, original = copy(requested);
  const result = R.commit(before, R.propose(before, { text: '先创建两件，再把后者移到前者左侧。' }), requested);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(point(result.frames[0].world.objects[1]), { x: 50, y: 38 });
  assert.deepEqual(point(result.frames[1].world.objects[1]), { x: 13, y: 38 });
  assert.deepEqual(result.frames[0].world.objects[0], result.frames[1].world.objects[0]); assert.deepEqual(requested, original);
  const restored = roundTrip(result.state);
  result.frames.forEach((frame, line) => assert.deepEqual(R.view(restored, { event: 0, line }), frame));
});

test('a reference moved earlier in the turn supplies its current grounded geometry', () => {
  const before = turn(R.create(pack()), [rect('参照', 28, 42, 17, 4), rect('另一件', 70, 38, 6, 4, 2)]);
  const requested = { schema: C.SCHEMA, topic: null, lines: ['参照挪好了。', '另一件也挪好了。'], beats: [
    { afterLine: 0, operations: [{ type: 'world.update', target: 'obj_1', changes: { x: 35 }, placementPolicy: 'exact' }] },
    { afterLine: 1, operations: [beside()] }
  ] };
  const result = R.commit(before, R.propose(before, { text: '先移动参照，再把另一件放在它左边。' }), requested);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(point(result.state.world.objects[1]), { x: 20, y: 38 });
  assert.deepEqual(result.frames[0].world.objects[1], before.world.objects[1]);
  assert.deepEqual(result.frames[1].world.objects[0], result.frames[0].world.objects[0]);
  const restored = roundTrip(result.state);
  result.frames.forEach((frame, line) => assert.deepEqual(R.view(restored, { event: 1, line }), frame));
});

test('normalized old placements preserve the historical below-ground position on restore and replay', () => {
  const before = turn(R.create(pack()), [rect('参照', 28, 42, 17, 4), rect('另一件', 50, 38, 6, 4, 2)]);
  const historical = turn(before, [{ type: 'world.update', target: 'obj_2', changes: { x: 13, y: 40 }, placementPolicy: 'exact' }]);
  for (const version of ['3', '4']) {
    const saved = copy(R.serialize(historical));
    if (version === '3') for (const event of saved.events) { event.rulesVersion = '3'; delete event.consentVersion; }
    const original = copy(saved), restored = R.restore(saved, pack());
    assert.equal(restored.ok, true, JSON.stringify(restored.error));
    assert.deepEqual(point(restored.state.world.objects[1]), { x: 13, y: 40 });
    assert.deepEqual(point(R.view(restored.state, { event: 0, line: 0 }).world.objects[1]), { x: 50, y: 38 });
    assert.deepEqual(point(R.view(restored.state, { event: 1, line: 0 }).world.objects[1]), { x: 13, y: 40 });
    assert.deepEqual(saved, original); roundTrip(restored.state);
  }
});

test('historical rules-2 relative placements still use their original center alignment', () => {
  const withoutPolicy = operation => { const value = copy(operation); delete value.placementPolicy; return value; };
  const saved = { schema: 'her-world-save-v4', pack: { id: 'rain-lab', version: '1.0.0', rulesVersion: '2', digest: '362c6f2f' }, importedSnapshot: null, events: [
    { id: 'event_1', type: 'turn', input: '以前的摆放', plan: plan([rect('参照', 28, 42, 17, 4), rect('另一件', 50, 38, 6, 4, 2)].map(withoutPolicy)) },
    { id: 'event_2', type: 'turn', input: '以前的移动', plan: plan([beside()]) }
  ] }, original = copy(saved), restored = R.restore(saved, pack());
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  assert.deepEqual(point(restored.state.world.objects[1]), { x: 13, y: 40 });
  assert.deepEqual(saved, original); assert.deepEqual(restored.state.events[1].plan, saved.events[1].plan); roundTrip(restored.state);
});

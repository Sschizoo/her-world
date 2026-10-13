'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const C = require('../framework/capabilities.js');
const copy = value => JSON.parse(JSON.stringify(value));
const rect = (label, x, y, width = 2, height = 2) => ({ type: 'world.create', object: { label, x, y, glyphs: Array(height).fill('X'.repeat(width)).join('\n'), scale: 1 }, placementPolicy: 'exact' });
const resize = (target, anchor = 'keep_center', scale = 2, extra = {}) => ({ type: 'world.update', target, changes: { scale }, placement: { anchor }, placementPolicy: 'auto', ...extra });
const plan = operations => ({ schema: C.SCHEMA, topic: null, lines: ['变大一点，别挤到一起。'], beats: [{ afterLine: 0, operations }] });
const commit = (state, operations) => R.commit(state, R.propose(state, { text: '变大一点，别挤到一起' }), plan(operations));
const turn = (state, operations) => { const result = commit(state, operations); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const pack = landmarks => { const value = P.get('rain-lab'); if (landmarks) value.world.landmarks = landmarks; return value; };
const size = object => ({ width: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale, height: object.glyphs.split('\n').length * object.scale });
const point = object => ({ x: object.x, y: object.y });
const overlaps = (a, b) => { const aa = size(a), bb = size(b); return a.x < b.x + bb.width && a.x + aa.width > b.x && a.y < b.y + bb.height && a.y + aa.height > b.y; };
const contains = (region, object) => { const s = size(object); return object.x >= region.x && object.y >= region.y && object.x + s.width <= region.x + region.width && object.y + s.height <= region.y + region.height; };
function nearest(before, operation, region = { x: 0, y: 0, width: 100, height: 60 }) {
  const current = before.world.objects.find(object => object.id === operation.target), old = size(current);
  const item = { ...current, ...operation.changes }, next = size(item);
  const desired = { x: current.x + Math.floor(old.width / 2) - Math.floor(next.width / 2), y: operation.placement.anchor === 'keep_base' ? current.y + old.height - next.height : current.y + Math.floor(old.height / 2) - Math.floor(next.height / 2) };
  const candidates = [];
  for (let y = region.y; y + next.height <= region.y + region.height; y++) for (let x = region.x; x + next.width <= region.x + region.width; x++) {
    const candidate = { ...item, x, y };
    if (before.world.objects.every(other => other.id === current.id || !overlaps(candidate, other))) candidates.push({ x, y, distance: (x - desired.x) ** 2 + (y - desired.y) ** 2 });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  return candidates.length ? { x: candidates[0].x, y: candidates[0].y } : null;
}
function roundTrip(state) {
  const saved = R.serialize(state), restored = R.restore(JSON.stringify(saved), state.pack);
  assert.equal(restored.ok, true, JSON.stringify(restored.error)); assert.deepEqual(restored.state, state);
  return restored.state;
}

test('a 22 by 6 cloud grows beside another sky cloud at the nearest free point', () => {
  const before = turn(R.create(pack()), [rect('小云', 42, 8, 11, 3), rect('另一朵云', 54, 8, 11, 3)]);
  const saved = copy(R.serialize(before)), operation = resize('obj_1'), original = copy(operation);
  const after = turn(before, [operation]), cloud = after.world.objects[0];
  assert.deepEqual(size(cloud), { width: 22, height: 6 });
  assert.deepEqual(point(cloud), nearest(before, operation, before.world.landmarks.sky));
  assert.ok(contains(before.world.landmarks.sky, cloud)); assert.equal(overlaps(...after.world.objects), false);
  assert.deepEqual(after.world.objects[1], before.world.objects[1]);
  assert.equal(cloud.id, before.world.objects[0].id); assert.equal(cloud.source.createdBy, before.world.objects[0].source.createdBy);
  assert.equal(cloud.source.createdEventId, before.world.objects[0].source.createdEventId);
  assert.deepEqual(operation, original); assert.deepEqual(R.serialize(before), saved);
  const stored = after.events.at(-1).plan.beats[0].operations[0];
  assert.equal(stored.placement, undefined); assert.equal(stored.placementPolicy, 'exact'); assert.deepEqual({ x: stored.changes.x, y: stored.changes.y }, point(cloud));
  const defaultAuto = copy(operation); delete defaultAuto.placementPolicy;
  assert.deepEqual(point(turn(before, [defaultAuto]).world.objects[0]), point(cloud));
  roundTrip(after);
});

test('auto keep anchors minimize distance rather than preferring a much farther point on the same row', () => {
  for (const anchor of ['keep_center', 'keep_base']) {
    const before = turn(R.create(pack({})), [rect('主体', 40, 20), rect('长邻居', 38, 19, 10, 1)]), operation = resize('obj_1', anchor, 3);
    const after = turn(before, [operation]);
    assert.deepEqual(point(after.world.objects[0]), nearest(before, operation));
    assert.deepEqual(after.world.objects[1], before.world.objects[1]); assert.equal(overlaps(...after.world.objects), false); roundTrip(after);
  }
});

test('unblocked keep anchors and repeated size reversals preserve the original center or base exactly', () => {
  for (const anchor of ['keep_center', 'keep_base']) {
    const before = turn(R.create(pack({})), [rect('主体', 40, 24, 11, 3)]); let state = before;
    for (let i = 0; i < 3; i++) {
      const operation = resize('obj_1', anchor), enlarged = turn(state, [operation]);
      assert.deepEqual(point(enlarged.world.objects[0]), nearest(state, operation));
      state = turn(enlarged, [resize('obj_1', anchor, 1)]);
      assert.deepEqual(point(state.world.objects[0]), point(before.world.objects[0]));
    }
    roundTrip(state);
  }
});

test('auto keep anchors find an in-grid footprint at every corner while exact stays strict', () => {
  for (const anchor of ['keep_center', 'keep_base']) for (const x of [0, 98]) for (const y of [0, 58]) {
    const before = turn(R.create(pack({})), [rect('边缘物件', x, y)]), operation = resize('obj_1', anchor, 3);
    const after = turn(before, [operation]); assert.deepEqual(point(after.world.objects[0]), nearest(before, operation));
    assert.ok(contains({ x: 0, y: 0, width: 100, height: 60 }, after.world.objects[0]));
    const strict = commit(before, [{ ...operation, placementPolicy: 'exact' }]);
    assert.equal(strict.ok, false); assert.equal(strict.error.diagnostic.geometryReason, 'OUT_OF_BOUNDS');
    roundTrip(after);
  }
});

test('exact keep collisions still fail and explicitly permitted overlap retains its exact anchor', () => {
  const before = turn(R.create(pack({})), [rect('主体', 40, 20), rect('邻居', 42, 20)]);
  for (const anchor of ['keep_center', 'keep_base']) {
    const strict = resize('obj_1', anchor, 3, { placementPolicy: 'exact' }), rejected = commit(before, [strict]);
    assert.equal(rejected.ok, false); assert.equal(rejected.error.diagnostic.geometryReason, 'POSITION_OCCUPIED');
    const overlapping = turn(before, [{ ...strict, allowOverlap: true }]);
    assert.equal(overlaps(...overlapping.world.objects), true); assert.deepEqual(overlapping.world.objects[1], before.world.objects[1]); roundTrip(overlapping);
  }
});

test('sky boundaries constrain even unblocked preferred anchors and never teleport oversized clouds', () => {
  const sky = { x: 4, y: 3, width: 8, height: 6 };
  const before = turn(R.create(pack({ sky })), [rect('云', 4, 3)]), operation = resize('obj_1');
  const after = turn(before, [operation]); assert.deepEqual(point(after.world.objects[0]), { x: 4, y: 3 }); assert.ok(contains(sky, after.world.objects[0]));
  const rejected = commit(before, [resize('obj_1', 'keep_center', 1, { changes: { glyphs: 'XXXXXXXXX\nXXXXXXXXX' } })]);
  assert.equal(rejected.ok, false); assert.equal(rejected.error.diagnostic.geometryReason, 'NO_FREE_POSITION');
  assert.deepEqual(point(before.world.objects[0]), { x: 4, y: 3 });
});

test('crowded semantic regions reject placement without moving neighbors or escaping to open grid space', () => {
  const sky = { x: 4, y: 3, width: 6, height: 4 };
  const before = turn(R.create(pack({ sky })), [rect('云', 4, 3), rect('固定邻居', 7, 3, 3, 4)]), saved = copy(R.serialize(before));
  const rejected = commit(before, [resize('obj_1')]);
  assert.equal(rejected.ok, false); assert.equal(rejected.error.diagnostic.geometryReason, 'NO_FREE_POSITION');
  assert.deepEqual(R.serialize(before), saved); assert.equal(rejected.state, undefined);
});

test('auto keep fallback never bypasses footprint validation', () => {
  const before = turn(R.create(pack({})), [rect('物件', 0, 0)]), saved = copy(R.serialize(before));
  for (const glyphs of ['X'.repeat(25), Array(11).fill('X').join('\n'), '   ', '非ASCII']) {
    const rejected = commit(before, [resize('obj_1', 'keep_center', 2, { changes: { glyphs } })]);
    assert.equal(rejected.ok, false); assert.equal(rejected.error.diagnostic.geometryReason, 'FOOTPRINT_INVALID');
  }
  assert.deepEqual(R.serialize(before), saved);
});

test('containing landmark selection uses smallest area and stable ID ties', () => {
  const cases = [
    { landmarks: { outer: { x: 10, y: 10, width: 20, height: 20 }, inner: { x: 15, y: 15, width: 6, height: 6 } }, original: [15, 15], scale: 2, region: 'inner' },
    { landmarks: { zeta: { x: 10, y: 10, width: 8, height: 8 }, alpha: { x: 12, y: 10, width: 8, height: 8 } }, original: [12, 12], scale: 3, region: 'alpha' }
  ];
  for (const value of cases) {
    const before = turn(R.create(pack(value.landmarks)), [rect('区域内物件', ...value.original)]), operation = resize('obj_1', 'keep_center', value.scale);
    const after = turn(before, [operation]); assert.deepEqual(point(after.world.objects[0]), nearest(before, operation, value.landmarks[value.region]));
    assert.ok(contains(value.landmarks[value.region], after.world.objects[0])); roundTrip(after);
  }
});

test('ground objects grow upward, retain their baseline and width bounds, and do not move neighbors', () => {
  const ground = { x: 10, y: 46, width: 24, height: 1 };
  for (const anchor of ['keep_center', 'keep_base']) {
    const before = turn(R.create(pack({ ground })), [rect('凳子', 10, 45, 3, 2), rect('邻居', 15, 45, 3, 2)]);
    const after = turn(before, [resize('obj_1', anchor, 2)]), object = after.world.objects[0], dimensions = size(object);
    assert.equal(object.y + dimensions.height, 47); assert.ok(object.x >= 10 && object.x + dimensions.width <= 34);
    assert.deepEqual(point(object), { x: 18, y: 43 }); assert.equal(overlaps(...after.world.objects), false);
    assert.deepEqual(after.world.objects[1], before.world.objects[1]); roundTrip(after);
  }
});

test('cross-sentence resize batches use earlier updates and expose stable, replayable sentence frames', () => {
  const before = turn(R.create(pack()), [rect('小云', 36, 8, 11, 3), rect('另一朵云', 48, 8, 11, 3), rect('旁观者', 80, 10, 2, 2)]);
  const requested = { schema: C.SCHEMA, topic: null, lines: ['第一朵长大了。', '第二朵也长大了。'], beats: [{ afterLine: 0, operations: [resize('obj_1')] }, { afterLine: 1, operations: [resize('obj_2')] }] }, original = copy(requested);
  const result = R.commit(before, R.propose(before, { text: '两朵都变大一点，别挤到一起' }), requested);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(result.frames[0].world.objects[1], before.world.objects[1]);
  assert.deepEqual(result.frames[1].world.objects[0], result.frames[0].world.objects[0]);
  assert.deepEqual(result.state.world.objects[2], before.world.objects[2]); assert.deepEqual(requested, original);
  for (const frame of result.frames) for (let i = 0; i < frame.world.objects.length; i++) for (let j = i + 1; j < frame.world.objects.length; j++) assert.equal(overlaps(frame.world.objects[i], frame.world.objects[j]), false);
  const restored = roundTrip(result.state);
  result.frames.forEach((frame, line) => assert.deepEqual(R.view(restored, { event: 1, line }), frame));
});

test('an impossible later resize rolls back all earlier operations and sentence output', () => {
  const sky = { x: 4, y: 3, width: 8, height: 6 }, before = turn(R.create(pack({ sky })), [rect('云', 4, 3), rect('另一个', 10, 7)]);
  const saved = copy(R.serialize(before)), requested = { schema: C.SCHEMA, topic: null, lines: ['先放大。', '然后再放大。'], beats: [{ afterLine: 0, operations: [resize('obj_1')] }, { afterLine: 1, operations: [resize('obj_2', 'keep_center', 1, { changes: { glyphs: 'XXXXXXXXX' } })] }] };
  const result = R.commit(before, R.propose(before, { text: '两朵都变大一点' }), requested);
  assert.equal(result.ok, false); assert.equal(result.error.diagnostic.geometryReason, 'NO_FREE_POSITION'); assert.equal(result.error.diagnostic.beatIndex, 1);
  assert.equal(result.state, undefined); assert.equal(result.frames, undefined); assert.deepEqual(R.serialize(before), saved);
});

test('normalized historical exact events replay unchanged without inferring new region constraints', () => {
  const before = turn(R.create(pack()), [rect('旧物件', 4, 3)]);
  const historical = turn(before, [{ type: 'world.update', target: 'obj_1', changes: { x: 0, y: 0 }, placementPolicy: 'exact' }]);
  assert.deepEqual(point(historical.world.objects[0]), { x: 0, y: 0 }); roundTrip(historical);
});

test('historical rules-2 keep-anchor resizes retain their original overlapping geometry', () => {
  const withoutPolicy = operation => { const value = copy(operation); delete value.placementPolicy; return value; };
  const saved = { schema: 'her-world-save-v4', pack: { id: 'rain-lab', version: '1.0.0', rulesVersion: '2', digest: '362c6f2f' }, importedSnapshot: null, events: [
    { id: 'event_1', type: 'turn', input: '以前的云', plan: plan([rect('小云', 42, 8, 11, 3), rect('另一朵', 54, 8, 11, 3)].map(withoutPolicy)) },
    { id: 'event_2', type: 'turn', input: '以前的放大', plan: plan([withoutPolicy(resize('obj_1'))]) }
  ] };
  const original = copy(saved), restored = R.restore(saved, pack());
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  assert.deepEqual(point(restored.state.world.objects[0]), { x: 36, y: 6 }); assert.equal(overlaps(...restored.state.world.objects), true);
  assert.deepEqual(saved, original); assert.deepEqual(restored.state.events[1].plan, saved.events[1].plan); roundTrip(restored.state);
});

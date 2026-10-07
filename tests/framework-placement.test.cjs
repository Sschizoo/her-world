'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const C = require('../framework/capabilities.js');
const P = require('../framework/packs.js');
const clone = value => JSON.parse(JSON.stringify(value));
const pack = () => P.get('rain-lab');
const create = (glyphs = ' (____)\n(______)', placement = { anchor: 'sky' }, extra = {}) => ({ type: 'world.create', object: { label: '云', glyphs, scale: 1 }, placement, ...extra });
const plan = operations => ({ schema: C.SCHEMA, lines: ['物件按要求摆好了。'], beats: [{ afterLine: 0, operations }], topic: null });
const commit = (state, operations, text = '添加多个物件') => R.commit(state, R.propose(state, { text }), plan(operations));
const turn = (state, operations, text) => { const result = commit(state, operations, text); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const size = object => ({ width: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale, height: object.glyphs.split('\n').length * object.scale });
const overlap = (a, b) => { const x = size(a), y = size(b); return a.x < b.x + y.width && b.x < a.x + x.width && a.y < b.y + y.height && b.y < a.y + x.height; };
const positions = state => state.world.objects.map(({ id, x, y }) => ({ id, x, y }));
const disjoint = state => state.world.objects.forEach((a, i) => state.world.objects.slice(i + 1).forEach(b => assert.equal(overlap(a, b), false, a.id + ' overlaps ' + b.id)));
const inSky = state => { const sky = state.world.landmarks.sky; for (const object of state.world.objects) { const { width, height } = size(object); assert.ok(object.x >= sky.x && object.x + width <= sky.x + sky.width); assert.ok(object.y >= sky.y && object.y + height <= sky.y + sky.height); } };
const roundTrip = state => { const result = R.restore(JSON.stringify(R.serialize(state)), state.pack); assert.equal(result.ok, true, JSON.stringify(result.error)); assert.deepEqual(result.state, state); };

test('two identical sky anchors separate on their intended row, then repeated requests avoid old clouds', () => {
  let state = turn(R.create(pack()), [create(), create()]);
  assert.equal(state.world.objects[0].y, state.world.objects[1].y);
  disjoint(state); inSky(state);
  const first = positions(state);
  state = turn(state, [create(), create()], '再添加两朵云');
  assert.deepEqual(positions(state).slice(0, 2), first);
  disjoint(state); inSky(state); roundTrip(state);
  assert.equal(state.world.objects[3].source.createdBy, '再添加两朵云');
});

test('joint placement finds two 36 by 9 clouds that greedy centering cannot fit', () => {
  const cloud = create('CCCCCCCCCCCC\nCCCCCCCCCCCC\nCCCCCCCCCCCC'); cloud.object.scale = 3;
  const initial = R.create(pack()), proposal = R.propose(initial, { text: '加两朵大云' });
  const requested = { schema: C.SCHEMA, topic: null, lines: ['第一朵云。', '第二朵云。'], beats: [{ afterLine: 0, operations: [cloud] }, { afterLine: 1, operations: [cloud] }] };
  const before = JSON.stringify(requested), result = R.commit(initial, proposal, requested);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(positions(result.state), [{ id: 'obj_1', x: 4, y: 6 }, { id: 'obj_2', x: 40, y: 6 }]);
  assert.equal(result.frames[0].world.objects.length, 1);
  assert.equal(result.frames[0].world.objects[0].x, 4, 'first line already has final settled placement');
  assert.equal(result.frames[1].world.objects.length, 2);
  assert.equal(JSON.stringify(requested), before);
  assert.deepEqual(R.view(result.state, { event: 0, line: 0 }), result.frames[0]);
  disjoint(result.state); inSky(result.state); roundTrip(result.state);
});

test('dense same-turn batches use boundary packing instead of exhausting equivalent centered arrangements', () => {
  const cloud = create('CCCCC\nCCCCC\nCCCCC\nCCCCC'); cloud.object.scale = 3;
  const state = turn(R.create(pack()), Array.from({ length: 6 }, () => clone(cloud)));
  disjoint(state); inSky(state); roundTrip(state);
  assert.deepEqual(state.world.objects.map(object => object.x), [4, 19, 34, 49, 64, 79]);
});

test('joint placement stacks two 72 by 30 objects at vertical boundaries with existing objects fixed', () => {
  const initial = turn(R.create(pack()), [{ type: 'world.create', object: { label: '已有物件', glyphs: 'X', scale: 1, x: 90, y: 15 }, placementPolicy: 'exact' }]);
  const large = { type: 'world.create', object: { label: '大物件', glyphs: Array(10).fill('X'.repeat(24)).join('\n'), scale: 3, x: 14, y: 15 } };
  const requested = { schema: C.SCHEMA, topic: null, lines: ['第一件。', '第二件。'], beats: [{ afterLine: 0, operations: [large] }, { afterLine: 1, operations: [large] }] };
  const inputBefore = JSON.stringify(requested), stateBefore = JSON.stringify(R.serialize(initial));
  const result = R.commit(initial, R.propose(initial, { text: '放下两件大物件' }), requested);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(positions(result.state).slice(1), [{ id: 'obj_2', x: 0, y: 0 }, { id: 'obj_3', x: 0, y: 30 }]);
  assert.deepEqual(result.state.world.objects[0], initial.world.objects[0]);
  assert.equal(result.frames[0].world.objects.length, 2);
  assert.deepEqual(result.frames[0].world.objects[1], result.state.world.objects[1]);
  assert.equal(result.frames[1].world.objects.length, 3);
  assert.deepEqual(R.view(result.state, { event: 1, line: 0 }), result.frames[0]);
  assert.equal(JSON.stringify(requested), inputBefore);
  assert.equal(JSON.stringify(R.serialize(initial)), stateBefore);
  disjoint(result.state); roundTrip(result.state);
});

test('saved centered clouds never move to make a later creation fit', () => {
  const cloud = create('CCCCCCCCCCCC\nCCCCCCCCCCCC\nCCCCCCCCCCCC'); cloud.object.scale = 3;
  const state = turn(R.create(pack()), [cloud]), before = JSON.stringify(R.serialize(state));
  const result = commit(state, [cloud]);
  assert.deepEqual(result, { ok: false, error: { code: 'PLACEMENT_CAPACITY', path: '$', diagnostic: { stage: 'RUNTIME', reason: 'OPERATION_REJECTED', path: 'beats[0].operations[0]', beatIndex: 0, operationIndex: 0, operationType: 'world.create', geometryReason: 'NO_FREE_POSITION', placementAnchor: 'sky', placementPolicy: 'auto', footprintCols: 36, footprintRows: 9, occupiedCount: 1 } } });
  assert.equal(JSON.stringify(R.serialize(state)), before);
});

test('different scales and whitespace padding use the whole rectangular footprint', () => {
  const first = create('C       \n        '), second = create(' D \nDDD'); second.object.scale = 3;
  const third = create('   E\nEEEE\n  E '); third.object.scale = 2;
  const state = turn(R.create(pack()), [first, second, third]);
  assert.deepEqual(size(state.world.objects[0]), { width: 8, height: 2 });
  disjoint(state); inSky(state); roundTrip(state);
});

test('repeated proposed numeric positions avoid occupied rectangles and stay inside grid edges', () => {
  const op = { type: 'world.create', object: { label: '边缘物件', glyphs: 'XX\nXX', scale: 3, x: 94, y: 54 } };
  const state = turn(R.create(pack()), Array.from({ length: 8 }, () => clone(op)));
  disjoint(state);
  for (const object of state.world.objects) { assert.ok(object.x >= 0 && object.x <= 94); assert.ok(object.y >= 0 && object.y <= 54); }
  assert.deepEqual(positions(state), positions(turn(R.create(pack()), Array.from({ length: 8 }, () => clone(op)))));
});

test('ground placement keeps every scaled baseline and stays within the landmark width', () => {
  const p = pack(); p.world.landmarks.ground = { x: 15, y: 45, width: 70, height: 1 };
  const a = create('TTTT\n TT ', { anchor: 'ground' }), b = create('MMMMMM\n M  M ', { anchor: 'ground' }); b.object.scale = 2;
  const state = turn(R.create(p), [a, b, a]); disjoint(state);
  for (const object of state.world.objects) { assert.equal(object.y + size(object).height, 46); assert.ok(object.x >= 15 && object.x + size(object).width <= 85); }
});

test('window and relative placements retain their exact side and requested gap while finding free space', () => {
  for (const [anchor, side] of [['window_left', 'left'], ['window_right', 'right'], ['window_below', 'below']]) {
    const state = turn(R.create(pack()), [create('XX\nXX', { anchor, gap: 1 }), create('XX\nXX', { anchor, gap: 1 })]);
    disjoint(state); const target = state.world.landmarks.window;
    for (const object of state.world.objects) {
      if (side === 'left') assert.equal(object.x + size(object).width + 1, target.x);
      if (side === 'right') assert.equal(object.x, target.x + target.width + 1);
      if (side === 'below') assert.equal(object.y, target.y + target.height + 1);
    }
  }
  const target = { type: 'world.create', object: { label: '目标', glyphs: 'TARGET', scale: 1, x: 40, y: 30 }, placementPolicy: 'exact' };
  for (const side of ['above', 'below', 'left_of', 'right_of']) {
    const state = turn(R.create(pack()), [target, create('XX\nXX', { anchor: side, target: 'obj_1', gap: 3 }), create('XX\nXX', { anchor: side, target: 'obj_1', gap: 3 })]);
    disjoint(state);
    for (const object of state.world.objects.slice(1)) {
      if (side === 'above') assert.equal(object.y + size(object).height + 3, 30);
      if (side === 'below') assert.equal(object.y, 34);
      if (side === 'left_of') assert.equal(object.x + size(object).width + 3, 40);
      if (side === 'right_of') assert.equal(object.x, 49);
    }
    roundTrip(state);
  }
});

test('exact coordinates reject accidental overlap and permit explicitly opted-in layering', () => {
  const op = { type: 'world.create', object: { label: '云', glyphs: 'CCC', scale: 1, x: 10, y: 10 }, placementPolicy: 'exact' };
  const state = turn(R.create(pack()), [op]);
  assert.equal(commit(state, [op]).error.code, 'PLACEMENT_CAPACITY');
  const layered = turn(state, [{ ...op, allowOverlap: true }]);
  assert.equal(overlap(...layered.world.objects), true); roundTrip(layered);
  for (const policy of [undefined, 'auto']) assert.equal(C.validate({ ...op, placementPolicy: policy, allowOverlap: true }), false);
  const noPolicy = clone(op); delete noPolicy.placementPolicy; noPolicy.allowOverlap = true; assert.equal(C.validate(noPolicy), false);
  assert.equal(C.validate({ ...op, allowOverlap: false }), true);
  assert.equal(C.validate({ ...op, placementPolicy: 'random' }), false);
});

test('joint placement recomputes a relative constraint when its earlier same-turn target must move', () => {
  const target = { type: 'world.create', object: { label: '目标', glyphs: 'T', scale: 1, x: 40, y: 30 } };
  const relative = create('X'.repeat(24), { anchor: 'right_of', target: 'obj_1', gap: 2 }); relative.object.scale = 3;
  const state = turn(R.create(pack()), [target, relative]);
  assert.equal(state.world.objects[0].x, 0);
  assert.equal(state.world.objects[1].x, state.world.objects[0].x + 3);
  assert.ok(state.world.objects[1].x + size(state.world.objects[1]).width <= 100);
  disjoint(state); roundTrip(state);
});

test('fixed self anchors exclude their old footprint and refuse displacement when blocked', () => {
  for (const anchor of ['keep_center', 'keep_base']) {
    const start = turn(R.create(pack()), [{ type: 'world.create', object: { label: '灯', glyphs: 'XX\nXX', scale: 1, x: 40, y: 30 } }]);
    const enlarged = turn(start, [{ type: 'world.update', target: 'obj_1', changes: { scale: 2 }, placement: { anchor } }]);
    assert.equal(enlarged.world.objects[0].x, 39);
    assert.equal(enlarged.world.objects[0].y, anchor === 'keep_center' ? 29 : 28);
    const blocked = turn(start, [{ type: 'world.create', object: { label: '邻居', glyphs: 'X', scale: 1, x: 39, y: 30 }, placementPolicy: 'exact' }]);
    const result = commit(blocked, [{ type: 'world.update', target: 'obj_1', changes: { scale: 2 }, placement: { anchor } }]);
    assert.equal(result.error.code, 'PLACEMENT_CAPACITY');
    assert.deepEqual(positions(blocked).slice(0, 1), positions(start));
  }
});

test('ordinary resize can relocate only the edited object and its final coordinates replay exactly', () => {
  const a = { type: 'world.create', object: { label: '甲', glyphs: 'XX', scale: 1, x: 20, y: 20 }, placementPolicy: 'exact' };
  const b = { type: 'world.create', object: { label: '乙', glyphs: 'XX', scale: 1, x: 22, y: 20 }, placementPolicy: 'exact' };
  const before = turn(R.create(pack()), [a, b]);
  const state = turn(before, [{ type: 'world.update', target: 'obj_1', changes: { scale: 2 } }]);
  disjoint(state); assert.deepEqual(state.world.objects[1], before.world.objects[1]);
  assert.notEqual(state.world.objects[0].x, before.world.objects[0].x);
  roundTrip(state);
});

test('cramped sky fails the whole turn without dialogue, notes, partial objects or input mutation', () => {
  const p = pack(); p.world.landmarks.sky = { x: 0, y: 0, width: 8, height: 2 };
  const initial = R.create(p), before = JSON.stringify(R.serialize(initial));
  const operations = [{ type: 'memory.upsert', id: 'note_clouds', title: '云', body: '两朵云' }, create('CCCCCC\nCCCCCC'), create('CCCCCC\nCCCCCC')];
  const request = JSON.stringify(operations), result = commit(initial, operations);
  assert.deepEqual(result, { ok: false, error: { code: 'PLACEMENT_CAPACITY', path: '$', diagnostic: { stage: 'RUNTIME', reason: 'OPERATION_REJECTED', path: 'beats[0].operations[2]', beatIndex: 0, operationIndex: 2, operationType: 'world.create', geometryReason: 'NO_FREE_POSITION', placementAnchor: 'sky', placementPolicy: 'auto', footprintCols: 6, footprintRows: 2, occupiedCount: 1 } } });
  assert.equal(JSON.stringify(R.serialize(initial)), before); assert.equal(JSON.stringify(operations), request);
});

test('geometry-invalid anchors and coordinates reject rather than silently changing constraints', () => {
  const initial = R.create(pack());
  for (const operation of [
    create('X'.repeat(24), { anchor: 'window_left' }, { object: { label: '宽物件', glyphs: 'X'.repeat(24), scale: 3 } }),
    create('XXX\nXXX', { anchor: 'sky' }, { object: { label: '高物件', glyphs: Array(10).fill('X').join('\n'), scale: 3 } }),
    { type: 'world.create', object: { label: '越界', glyphs: 'XX', scale: 3, x: 99, y: 59 } }
  ]) assert.equal(commit(initial, [operation]).error.code, 'GEOMETRY_INVALID');
});

const predecessor = { '1': '402db16c', '2': '362c6f2f' };
const oldSave = rulesVersion => ({ schema: 'her-world-save-v4', pack: { id: 'rain-lab', version: '1.0.0', rulesVersion, digest: predecessor[rulesVersion] }, importedSnapshot: null, events: [{ id: 'event_1', type: 'turn', input: '以前的两朵云', plan: plan([create(), create()]) }] });

test('rules1 and rules2 migration preserve overlapping old anchors, sources, plans and every replay position', () => {
  for (const version of ['1', '2']) {
    const saved = oldSave(version), original = JSON.stringify(saved), restored = R.restore(saved, pack());
    assert.equal(restored.ok, true, JSON.stringify(restored.error));
    assert.equal(restored.migration.fromRulesVersion, version); assert.equal(restored.migration.toRulesVersion, '4');
    assert.equal(overlap(...restored.state.world.objects), true);
    assert.deepEqual(restored.state.events[0].plan, saved.events[0].plan);
    assert.equal(restored.state.events[0].rulesVersion, '2');
    assert.equal(restored.state.world.objects[0].source.createdBy, saved.events[0].input);
    assert.equal(JSON.stringify(saved), original);
    assert.deepEqual(R.view(restored.state, { event: 0, line: 0 }).world, R.view(restored.state).world);
    roundTrip(restored.state);
    const next = turn(restored.state, [create()]);
    assert.deepEqual(next.world.objects.slice(0, 2), restored.state.world.objects);
    assert.equal(overlap(next.world.objects[0], next.world.objects[2]), false);
    roundTrip(next);
  }
});

test('same-footprint visual and label edits preserve historical overlaps without implicit repair', () => {
  const restored = R.restore(oldSave('2'), pack()).state;
  const state = turn(restored, [{ type: 'world.update', target: 'obj_1', changes: { glyphs: ' [____]\n[______]', label: '改外观的云' } }]);
  assert.deepEqual(positions(state), positions(restored));
  assert.equal(overlap(...state.world.objects), true);
  assert.equal(state.events.at(-1).plan.beats[0].operations[0].changes.x, undefined);
  roundTrip(state);
});

test('new saves contain resolved placements and reject replaying fresh placement proposals', () => {
  const state = turn(R.create(pack()), [create(), create()]), saved = clone(R.serialize(state));
  for (const op of saved.events[0].plan.beats[0].operations) {
    assert.equal(op.placement, undefined); assert.equal(op.placementPolicy, 'exact');
    assert.ok(Number.isInteger(op.object.x)); assert.ok(Number.isInteger(op.object.y));
  }
  roundTrip(state);
  const changed = clone(saved); changed.events[0].plan = plan([create(), create()]);
  assert.equal(R.restore(changed, pack()).error.code, 'EVENT_INVALID');
  const unmarked = clone(saved); delete unmarked.events[0].rulesVersion;
  assert.equal(R.restore(unmarked, pack()).error.code, 'EVENT_INVALID');
  const unnormalizedResize = clone(saved);
  unnormalizedResize.events.push({ id: 'event_2', type: 'turn', rulesVersion: '3', input: '修改大小', plan: plan([{ type: 'world.update', target: 'obj_1', changes: { scale: 2 } }]) });
  assert.equal(R.restore(unnormalizedResize, pack()).error.code, 'EVENT_INVALID');
});

test('unknown predecessor content cannot use the placement migration', () => {
  const saved = oldSave('2'); saved.pack.digest = '00000000';
  assert.equal(R.restore(saved, pack()).error.code, 'PACK_MISMATCH');
  const changed = pack(); changed.world.landmarks.sky.width--;
  assert.equal(R.restore(oldSave('2'), changed).error.code, 'PACK_MISMATCH');
});

test('current saves reject a rules2 turn after rules4 even when observations intervene', () => {
  const initial = turn(R.create(pack()), [create()]);
  for (const state of [initial, R.observe(initial, { type: 'panel.viewed', panel: 'world' })]) {
    const saved = clone(R.serialize(state)), old = oldSave('2').events[0];
    old.id = 'event_' + (state.revision + 1); old.rulesVersion = '2';
    saved.events.push(old);
    const original = JSON.stringify(saved);
    assert.deepEqual(R.restore(saved, pack()), { ok: false, error: { code: 'EVENT_INVALID', path: '$' } });
    assert.equal(JSON.stringify(saved), original);
  }
});

test('migrated rules2 prefix allows interleaved observations before its one-way rules4 transition', () => {
  const saved = oldSave('2');
  saved.events.push({ id: 'event_2', type: 'panel.viewed', panel: 'world' });
  saved.events.push({ id: 'event_3', type: 'turn', input: '后来又添的一朵旧云', plan: plan([create()]) });
  const original = JSON.stringify(saved), restored = R.restore(saved, pack());
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  const state = turn(restored.state, [create()], '现在新添一朵云');
  assert.deepEqual(state.events.map(event => event.type === 'turn' ? event.rulesVersion : event.type), ['2', 'panel.viewed', '2', '4']);
  assert.deepEqual(state.events.slice(0, 3), saved.events.map(event => event.type === 'turn' ? { ...event, rulesVersion: '2' } : event));
  assert.deepEqual(state.world.objects.slice(0, 3), restored.state.world.objects);
  assert.equal(state.world.objects[0].source.createdBy, '以前的两朵云');
  assert.equal(state.world.objects[2].source.createdBy, '后来又添的一朵旧云');
  assert.equal(state.world.objects[2].source.createdEventId, 'event_3');
  assert.equal(state.world.objects[3].source.createdBy, '现在新添一朵云');
  assert.equal(state.world.objects[3].source.createdEventId, 'event_4');
  assert.equal(JSON.stringify(saved), original);
  roundTrip(state);
  assert.deepEqual(R.view(state, { event: 2, line: 0 }).world, R.view(restored.state).world);
});

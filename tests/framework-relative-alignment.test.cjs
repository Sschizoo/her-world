'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const C = require('../framework/capabilities.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const copy = value => JSON.parse(JSON.stringify(value));
const size = object => ({ width: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale, height: object.glyphs.split('\n').length * object.scale });
const bottom = object => object.y + size(object).height;
const point = object => ({ x: object.x, y: object.y });
const rect = (label, x, y, width, height, scale = 1, placementPolicy = 'exact') => ({ type: 'world.create', object: { label, x, y, glyphs: Array(height).fill('X'.repeat(width)).join('\n'), scale }, placementPolicy });
const adjacent = (anchor = 'right_of', align = 'bottom', extra = {}) => ({ type: 'world.create', object: { label: '任意物件', glyphs: 'X\nX\nX\nX\nX', scale: 1 }, placement: { anchor, target: 'obj_1', gap: 2, ...(align === undefined ? {} : { align }) }, ...extra });
const plan = operations => ({ schema: C.SCHEMA, topic: null, lines: ['按声明的位置摆好了。'], beats: [{ afterLine: 0, operations }] });
const commit = (state, operations) => R.commit(state, R.propose(state, { text: '按照明确的间隔与对齐方式摆放这些物件。' }), plan(operations));
const turn = (state, operations) => { const result = commit(state, operations); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const fresh = () => R.create(P.get('rain-lab'));
function roundTrip(state) {
  const saved = R.serialize(state), before = copy(saved), restored = R.restore(saved, state.pack);
  assert.equal(restored.ok, true, JSON.stringify(restored.error)); assert.deepEqual(restored.state, state); assert.deepEqual(saved, before);
  for (let event = 0; event < state.events.length; event++) for (let line = 0; line < state.events[event].plan.lines.length; line++) assert.deepEqual(R.view(restored.state, { event, line }), R.view(state, { event, line }));
}
function rejectAtomically(state, operations, reason) {
  const saved = copy(R.serialize(state)), before = copy(operations), result = commit(state, operations);
  assert.equal(result.ok, false); assert.equal(result.state, undefined); assert.equal(result.frames, undefined);
  if (reason) assert.equal(result.error.diagnostic.geometryReason, reason);
  assert.deepEqual(R.serialize(state), saved); assert.deepEqual(operations, before);
  return result.error;
}

test('the five-row lamp reproduction retains the old result unless bottom alignment is explicit', () => {
  // Exact operation from attested 005-response.txt (SHA-256
  // 7cc25532eeae3f78cb552322e5f87be18b2141b016cecdda767cdf17d1dedace).
  // Keep that original response/artifact unchanged: this is a separate variant.
  const original = { type: 'world.create', object: { label: '小灯', glyphs: '  ___  \n /___\\ \n   |   \n   |   \n _|_|_ ', scale: 1 }, placement: { anchor: 'right_of', target: 'obj_1', gap: 4 }, placementPolicy: 'exact' };
  const before = turn(fresh(), [{ type: 'world.create', object: { label: '双人长椅', glyphs: '+---------+---------+\n|         |         |\n+===================+\n  ||             ||', scale: 1, x: 26, y: 43 }, placementPolicy: 'exact' }]);
  const input = copy(original), historical = turn(before, [original]);
  assert.deepEqual(point(historical.world.objects[1]), { x: 51, y: 43 });
  assert.equal(bottom(historical.world.objects[0]), 47); assert.equal(bottom(historical.world.objects[1]), 48);
  for (const placementPolicy of ['auto', 'exact']) {
    const after = turn(before, [{ ...original, placement: { ...original.placement, align: 'bottom' }, placementPolicy }]);
    assert.deepEqual(point(after.world.objects[1]), { x: 51, y: 42 });
    assert.equal(bottom(after.world.objects[1]), 47); assert.deepEqual(after.world.objects[0], before.world.objects[0]); roundTrip(after);
  }
  assert.deepEqual(original, input); roundTrip(historical);
});

test('both explicit alignments use full scaled padded rectangles on either side, at ground or in air', () => {
  for (const baseline of [20, 47]) for (const anchor of ['left_of', 'right_of']) for (const align of ['center', 'bottom']) for (const scale of [1, 2, 3]) {
    const before = turn(fresh(), [{ type: 'world.create', object: { label: '参照', glyphs: '  X  \n     ', scale: 3, x: 40, y: baseline - 6 }, placementPolicy: 'exact' }]);
    const operation = adjacent(anchor, align, { object: { label: '任意物件', glyphs: ' X  \n    \n X  ', scale } });
    const after = turn(before, [operation]), item = after.world.objects[1];
    assert.deepEqual(size(item), { width: 4 * scale, height: 3 * scale });
    assert.deepEqual(point(item), { x: anchor === 'left_of' ? 38 - 4 * scale : 57, y: align === 'bottom' ? baseline - 3 * scale : baseline - 3 - Math.floor(3 * scale / 2) });
    assert.deepEqual(after.world.objects[0], before.world.objects[0]);
  }
});

test('explicit alignment works with landmark references and does not require a ground landmark or a noun', () => {
  const pack = P.get('rain-lab'); pack.world.landmarks = { ledge: { x: 40, y: 18, width: 10, height: 4 } };
  for (const anchor of ['left_of', 'right_of']) for (const label of ['悬浮灯', '长椅', 'cloud', 'arbitrary']) {
    const operation = adjacent(anchor, 'bottom'); operation.object.label = label; operation.placement.target = 'ledge';
    const state = turn(R.create(pack), [operation]);
    assert.deepEqual(point(state.world.objects[0]), { x: anchor === 'left_of' ? 37 : 52, y: 17 });
    assert.equal(bottom(state.world.objects[0]), 22); roundTrip(state);
  }
});

test('explicit center overrides preserved ground contact and bottom allows a resized airborne update', () => {
  const before = turn(fresh(), [rect('参照', 28, 42, 17, 4), rect('待移动', 60, 38, 6, 4, 2)]);
  for (const placementPolicy of ['auto', 'exact']) for (const align of ['center', 'bottom']) {
    const after = turn(before, [{ type: 'world.update', target: 'obj_2', changes: {}, placement: { anchor: 'left_of', target: 'obj_1', gap: 3, align }, placementPolicy }]);
    assert.deepEqual(point(after.world.objects[1]), { x: 13, y: align === 'center' ? 40 : 38 });
    assert.deepEqual(after.world.objects[0], before.world.objects[0]); roundTrip(after);
  }
  const air = turn(fresh(), [rect('参照', 30, 18, 6, 4), rect('待移动', 60, 45, 2, 2)]);
  const resized = turn(air, [{ type: 'world.update', target: 'obj_2', changes: { scale: 3 }, placement: { anchor: 'right_of', target: 'obj_1', align: 'bottom' } }]);
  assert.deepEqual(point(resized.world.objects[1]), { x: 38, y: 16 });
  assert.equal(bottom(resized.world.objects[1]), 22); assert.deepEqual(resized.world.objects[0], air.world.objects[0]); roundTrip(resized);
});

test('omitting align retains ordinary center/search and historical shared-ground updates', () => {
  const ground = turn(fresh(), [rect('参照', 28, 42, 17, 4), rect('待移动', 60, 38, 6, 4, 2)]);
  const operation = { type: 'world.update', target: 'obj_2', changes: {}, placement: { anchor: 'left_of', target: 'obj_1', gap: 3 } };
  assert.deepEqual(point(turn(ground, [operation]).world.objects[1]), { x: 13, y: 38 });
  assert.deepEqual(point(turn(ground, [{ ...operation, placementPolicy: 'exact' }]).world.objects[1]), { x: 13, y: 40 });
  const before = turn(fresh(), [rect('参照', 20, 20, 4, 4), rect('障碍', 26, 20, 1, 1)]);
  const defaults = adjacent(); delete defaults.placement.align;
  const result = turn(before, [defaults]);
  assert.equal(result.world.objects[2].x, 26); assert.equal(result.world.objects[2].y, 21);
  assert.deepEqual(result.world.objects.slice(0, 2), before.world.objects); roundTrip(result);
});

test('explicit auto and exact alignment reject occupied positions atomically instead of searching vertically', () => {
  for (const align of ['center', 'bottom']) for (const placementPolicy of ['auto', 'exact']) {
    const before = turn(fresh(), [rect('参照', 20, 20, 4, 4), rect('障碍', 26, 20, 1, 1)]);
    const error = rejectAtomically(before, [{ type: 'weather.set', changes: { paused: true } }, adjacent('right_of', align, { placementPolicy })], 'POSITION_OCCUPIED');
    assert.equal(error.code, 'PLACEMENT_CAPACITY'); assert.equal(error.diagnostic.operationIndex, 1);
  }
});

test('explicit alignment never clamps at top/bottom boundaries while omitted alignment keeps its clamp', () => {
  for (const y of [0, 59]) for (const align of ['center', 'bottom']) for (const placementPolicy of ['auto', 'exact']) {
    const before = turn(fresh(), [rect('边界参照', 20, y, 4, 1)]), operation = adjacent('right_of', align, { placementPolicy });
    if (y === 59 && align === 'bottom') {
      const after = turn(before, [operation]); assert.deepEqual(point(after.world.objects[1]), { x: 26, y: 55 });
    } else assert.equal(rejectAtomically(before, [operation], 'OUT_OF_BOUNDS').code, 'GEOMETRY_INVALID');
    const defaults = copy(operation); delete defaults.placement.align;
    assert.deepEqual(point(turn(before, [defaults]).world.objects[1]), { x: 26, y: y === 0 ? 0 : 55 });
  }
  for (const [anchor, x] of [['left_of', 0], ['right_of', 96]]) {
    const before = turn(fresh(), [rect('边界参照', x, 20, 4, 4)]);
    rejectAtomically(before, [adjacent(anchor)], 'OUT_OF_BOUNDS');
  }
});

test('joint packing recomputes explicit alignment from earlier movable creations and settles sentence frames', () => {
  for (const align of ['center', 'bottom']) {
    const before = turn(fresh(), [rect('固定邻居', 90, 10, 1, 1)]);
    const target = rect('参照', 40, 30, 1, 1, 1, 'auto'), relative = adjacent('right_of', align, { object: { label: '宽物件', glyphs: 'X'.repeat(24) + '\n' + ' '.repeat(24) + '\n' + 'X'.repeat(24), scale: 3 } });
    relative.placement.target = 'obj_2';
    const requested = { schema: C.SCHEMA, topic: null, lines: ['参照就位。', '按参照摆好。'], beats: [{ afterLine: 0, operations: [target] }, { afterLine: 1, operations: [relative] }] }, original = copy(requested);
    const result = R.commit(before, R.propose(before, { text: '新增两件，第二件按第一件对齐。' }), requested);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const [neighbor, first, second] = result.state.world.objects;
    assert.deepEqual(neighbor, before.world.objects[0]); assert.equal(first.x, 0); assert.equal(second.x, 3);
    assert.equal(second.y, align === 'bottom' ? bottom(first) - 9 : first.y - 4);
    assert.deepEqual(result.frames[0].world.objects[1], first); assert.deepEqual(result.frames[1].world.objects, result.state.world.objects);
    assert.deepEqual(requested, original); roundTrip(result.state);
  }
});

test('joint packing may move a same-turn target vertically but never relaxes explicit bottom alignment', () => {
  const target = rect('参照', 40, 0, 1, 1, 1, 'auto');
  const aligned = adjacent('right_of', 'bottom', { object: { label: '高物件', glyphs: 'X\nX\nX', scale: 3 } });
  const state = turn(fresh(), [target, aligned]);
  assert(state.world.objects[0].y >= 8); assert.equal(bottom(state.world.objects[0]), bottom(state.world.objects[1])); roundTrip(state);
  const fixed = turn(fresh(), [{ ...target, placementPolicy: 'exact' }]);
  rejectAtomically(fixed, [aligned], 'OUT_OF_BOUNDS');
});

test('same-turn references resolve at the operation boundary and cannot target labels, future or removed objects', () => {
  const target = rect('参照', 20, 20, 4, 4), aligned = adjacent();
  const state = turn(fresh(), [target, { type: 'world.update', target: 'obj_1', changes: { y: 25 }, placementPolicy: 'exact' }, aligned]);
  assert.equal(bottom(state.world.objects[1]), 29); roundTrip(state);
  for (const operations of [[aligned, target], [target, { type: 'world.remove', target: 'obj_1' }, aligned]]) assert.equal(rejectAtomically(fresh(), operations).code, 'PLACEMENT_TARGET');
  const before = turn(fresh(), [target]);
  for (const [reference, reason] of [['参照', 'REFERENCE_LABEL_USED'], ['obj_999', 'REFERENCE_TARGET_MISSING']]) {
    const invalid = copy(aligned); invalid.placement.target = reference;
    assert.equal(rejectAtomically(before, [invalid], reason).code, 'PLACEMENT_TARGET');
  }
  const self = { type: 'world.update', target: 'obj_1', changes: {}, placement: { anchor: 'right_of', target: 'obj_1', align: 'bottom' } };
  assert.equal(rejectAtomically(before, [self], 'SELF_TARGET').code, 'PLACEMENT_INVALID');
});

test('full capacity still allows aligned resize of one object and preserves every existing neighbor', () => {
  const before = turn(fresh(), [rect('参照', 20, 20, 4, 4), rect('待移动', 60, 30, 2, 2), ...Array.from({ length: 6 }, (_, i) => rect('旁观' + i, 90, i * 2, 1, 1))]);
  const operation = { type: 'world.update', target: 'obj_2', changes: { scale: 3 }, placement: { anchor: 'left_of', target: 'obj_1', gap: 0, align: 'bottom' } };
  const after = turn(before, [operation]);
  assert.equal(after.world.objects.length, after.world.capacity); assert.deepEqual(point(after.world.objects[1]), { x: 14, y: 18 });
  before.world.objects.forEach((object, index) => { if (index !== 1) assert.deepEqual(after.world.objects[index], object); }); roundTrip(after);
  assert.equal(rejectAtomically(before, [adjacent()], 'WORLD_CAPACITY').code, 'WORLD_CAPACITY');
});

test('explicit overlap permission remains exact-only and never changes the declared alignment', () => {
  const before = turn(fresh(), [rect('参照', 20, 20, 4, 4), rect('障碍', 26, 20, 1, 1)]);
  const operation = adjacent('right_of', 'bottom', { placementPolicy: 'exact', allowOverlap: true });
  const after = turn(before, [operation]); assert.deepEqual(point(after.world.objects[2]), { x: 26, y: 19 }); roundTrip(after);
  for (const placementPolicy of ['auto', undefined]) {
    const invalid = copy(operation); if (placementPolicy) invalid.placementPolicy = placementPolicy; else delete invalid.placementPolicy;
    assert.equal(C.validate(invalid), false); rejectAtomically(before, [invalid], 'SCHEMA_INVALID');
  }
});

test('align is a strict typed field available only on horizontal relative placement in rules 4', () => {
  const valid = adjacent(), before = turn(fresh(), [rect('参照', 20, 20, 4, 4)]);
  for (const type of ['world.create', 'world.update']) {
    const base = type === 'world.create' ? valid : { type, target: 'obj_1', changes: {}, placement: { ...valid.placement, target: 'window' } };
    for (const align of ['center', 'bottom']) assert.equal(C.validate({ ...base, placement: { ...base.placement, align } }), true);
    for (const align of [null, false, 1, 'top', 'base', 'Bottom', '', {}, ['bottom']]) assert.equal(C.validate({ ...base, placement: { ...base.placement, align } }), false);
    for (const anchor of ['above', 'below', 'sky', 'ground', 'keep_center', 'keep_base', 'window_left', 'window_right', 'window_below']) {
      const placement = { anchor, align: 'bottom', ...(['above', 'below'].includes(anchor) ? { target: 'obj_1' } : {}) };
      assert.equal(C.validate({ ...base, placement }), false, anchor);
    }
    for (const version of ['2', '3']) assert.equal(C.validate(base, version), false);
  }
  const invalids = [{ ...valid, align: 'bottom' }, { ...valid, object: { ...valid.object, align: 'bottom' } }, { ...valid, object: { ...valid.object, x: 20, y: 20 } }, { ...valid, placement: { ...valid.placement, baseline: 47 } }, { ...valid, placement: { anchor: 'right_of', align: 'bottom' } }];
  for (const invalid of invalids) { assert.equal(C.validate(invalid), false); rejectAtomically(before, [invalid], 'SCHEMA_INVALID'); }
});

test('canonical, dynamic reference and model-definition schemas expose the same exact alignment contract', () => {
  const state = turn(fresh(), [rect('参照', 20, 20, 4, 4)]), context = R.context(state), definition = C.modelDefinition(context);
  for (const id of ['world.create', 'world.update']) {
    const canonical = C.descriptors([id])[0], dynamic = context.capabilities.find(item => item.id === id);
    const variants = value => value.schema.properties.placement.anyOf.filter(branch => branch.required.includes('target'));
    assert.deepEqual(variants(canonical).map(branch => branch.properties.anchor.enum), [['above', 'below', 'left_of', 'right_of']]);
    assert.deepEqual(variants(canonical)[0].properties.align, { type: 'string', enum: ['center', 'bottom'] });
    assert.deepEqual(variants(canonical)[0].anyOf, [{ properties: { align: false } }, { properties: { anchor: { type: 'string', enum: ['left_of', 'right_of'] } } }]);
    assert(!variants(canonical)[0].required.includes('align')); assert.equal(variants(canonical)[0].additionalProperties, false);
    for (const branch of variants(dynamic)) for (const reference of ['obj_1', 'obj_2', 'window', 'ground']) assert(branch.properties.target.enum.includes(reference));
    const withoutTarget = branch => { const value = copy(branch); delete value.properties.target; return value; };
    assert.deepEqual(withoutTarget(variants(dynamic)[0]), withoutTarget(variants(canonical)[0]));
    assert.deepEqual(definition.capabilities.find(item => item.id === id), dynamic);
    assert.match(dynamic.description, /Use align:bottom for intended shared-base or floor adjacency/);
    assert.match(dynamic.description, /even in air/); assert.match(dynamic.description, /centering does not imply ground contact/);
    assert.match(dynamic.description, /Follow player intent for floating or hanging objects/);
    for (const version of ['2', '3']) for (const world of [undefined, state.world]) {
      const legacy = C.descriptors([id], version, world)[0];
      assert.deepEqual(variants(legacy).map(branch => branch.properties.anchor.enum), [['above', 'below', 'left_of', 'right_of']]);
      assert.equal(variants(legacy)[0].properties.align, undefined); assert(!legacy.description.includes('align:bottom'));
    }
  }
  const request = M.buildRequest(context, '放在参照旁边并让底边对齐');
  assert(request.messages[0].content.endsWith('\n本轮内容与能力定义：\n' + JSON.stringify(definition)));
  assert(Buffer.byteLength(JSON.stringify(request)) < 128 * 1024);
});

test('new aligned plans save exact coordinates and old normalized rules-3/4 positions replay unchanged', () => {
  const before = turn(fresh(), [rect('参照', 20, 20, 4, 4)]), after = turn(before, [adjacent()]);
  const normalized = after.events.at(-1).plan.beats[0].operations[0];
  assert.equal(normalized.placement, undefined); assert.equal(normalized.placementPolicy, 'exact');
  assert.deepEqual({ x: normalized.object.x, y: normalized.object.y }, { x: 26, y: 19 }); roundTrip(after);
  // Saved legacy centering deliberately has bottom 25, one row below target 24.
  const old = turn(before, [rect('历史物件', 26, 20, 1, 5)]);
  for (const version of ['3', '4']) {
    const saved = copy(R.serialize(old));
    if (version === '3') for (const event of saved.events) { event.rulesVersion = '3'; delete event.consentVersion; }
    const original = copy(saved), restored = R.restore(saved, old.pack);
    assert.equal(restored.ok, true, JSON.stringify(restored.error)); assert.deepEqual(point(restored.state.world.objects[1]), { x: 26, y: 20 });
    assert.equal(bottom(restored.state.world.objects[1]), 25); assert.deepEqual(saved, original); roundTrip(restored.state);
  }
});

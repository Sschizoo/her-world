'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const C = require('../framework/capabilities.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const copy = value => JSON.parse(JSON.stringify(value));
const input = '在天空里放两朵大小不同的云吧，左边小一点，右边大一点，中间留出空隙。雨先保持这样。';
const small = { label: '小云', glyphs: "  .--.  \n (    )\n  `--'  ", scale: 1 };
const large = { label: '大云', glyphs: "   .----.   \n--(        )--\n   `------'   ", scale: 2 };
const size = object => ({ width: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale, height: object.glyphs.split('\n').length * object.scale });
const point = ({ id, x, y }) => ({ id, x, y });
const create = (object, placement = { anchor: 'sky' }) => ({ type: 'world.create', object: copy(object), placement });
const plan = operations => ({ schema: C.SCHEMA, lines: ['按声明的约束放置物件。'], beats: [{ afterLine: 0, operations }], topic: null });
const commit = (state, operations, text = input) => R.commit(state, R.propose(state, { text }), plan(operations));
const accepted = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const fresh = () => accepted(commit(R.create(P.get('rain-lab')), [{ type: 'weather.set', changes: { kind: 'rain', name: '叶信', intensity: 1, paused: false } }], '把雨叫作叶信，下一点小雨。'));
function replay(state) {
  const before = copy(R.serialize(state)), restored = R.restore(before, state.pack);
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  assert.deepEqual(restored.state, state);
  for (let event = 0; event < state.events.length; event++) for (let line = 0; line < state.events[event].plan.lines.length; line++) assert.deepEqual(R.view(restored.state, { event, line }), R.view(state, { event, line }));
  assert.deepEqual(R.serialize(state), before);
}
function inSky(state) {
  const sky = state.world.landmarks.sky;
  for (const object of state.world.objects) {
    const { width, height } = size(object);
    assert(object.x >= sky.x && object.x + width <= sky.x + sky.width);
    assert(object.y >= sky.y && object.y + height <= sky.y + sky.height);
  }
}

test('synthetic independent sky anchors reproduce the observed reversed coordinates without claiming the live raw proposal', () => {
  // The live object positions were visible, but its raw placements and scale
  // were not inspected. These are independently authored synthetic operations.
  const before = fresh(), operations = [create(small), create(large)], unchanged = copy(operations);
  const state = accepted(commit(before, operations));
  assert.deepEqual(state.world.objects.map(point), [{ id: 'obj_1', x: 46, y: 9 }, { id: 'obj_2', x: 18, y: 7 }]);
  assert.deepEqual(state.world.objects.map(size), [{ width: 8, height: 3 }, { width: 28, height: 6 }]);
  assert.equal(state.world.objects[1].x + size(state.world.objects[1]).width, state.world.objects[0].x, 'independent anchors do not guarantee a positive rectangle gap');
  assert.deepEqual(state.world.weather, before.world.weather);
  assert.deepEqual(operations, unchanged);
  inSky(state); replay(state);
});

test('explicit right_of gives the requested full-footprint gap and the correction keeps the reference and rain fixed', () => {
  const before = fresh(), state = accepted(commit(before, [create(small), create(large, { anchor: 'right_of', target: 'obj_1', gap: 3 })]));
  assert.deepEqual(state.world.objects.map(point), [{ id: 'obj_1', x: 46, y: 9 }, { id: 'obj_2', x: 57, y: 7 }]);
  assert.equal(state.world.objects[1].x, state.world.objects[0].x + size(state.world.objects[0]).width + 3);
  assert.deepEqual(state.world.weather, before.world.weather); inSky(state); replay(state);
  const reversed = accepted(commit(before, [create(small), create(large)]));
  const corrected = accepted(commit(reversed, [{ type: 'world.update', target: 'obj_1', changes: {}, placement: { anchor: 'left_of', target: 'obj_2', gap: 3 } }], '请把小云移到大云的左边，隔开三格；大云的位置和雨都不要动。'));
  assert.deepEqual(corrected.world.objects.map(point), [{ id: 'obj_1', x: 7, y: 9 }, { id: 'obj_2', x: 18, y: 7 }]);
  assert.deepEqual(corrected.world.objects[1], reversed.world.objects[1]);
  assert.deepEqual(corrected.world.weather, reversed.world.weather); inSky(corrected); replay(corrected);
});

test('relative creation preserves either horizontal direction and scaled padded gap across sizes and joint retries', () => {
  const before = fresh();
  for (const anchor of ['left_of', 'right_of']) for (const smallScale of [1, 2, 3]) for (const largeScale of [1, 2, 3]) for (const gap of [1, 3, 10]) {
    const operations = [create({ ...small, scale: smallScale }), create({ ...large, scale: largeScale }, { anchor, target: 'obj_1', gap })];
    const result = commit(before, operations), state = accepted(result), [reference, placed] = state.world.objects;
    assert.equal(anchor === 'right_of' ? placed.x - reference.x - size(reference).width : reference.x - placed.x - size(placed).width, gap);
    assert.deepEqual(state.world.weather, before.world.weather);
    assert.deepEqual(result.frames.at(-1).world.objects, state.world.objects);
  }
});

test('mocked current v4 model path recomputes right_of after moving the earlier same-turn creation and replays every line', async () => {
  const before = fresh(), context = R.context(before);
  const operations = [create({ ...small, scale: 3 }), create({ ...large, scale: 3 }, { anchor: 'right_of', target: 'obj_1', gap: 10 })];
  const wire = { schema: 'her-world-turn-v4', requestedChanges: [{ domain: 'scene', support: { quote: input } }], lines: operations.map((operation, index) => ({ text: index ? '大云在小云右边，中间留出空隙。' : '先放小云。', mode: 'apply_now', operations: [operation] })), topic: null };
  const unchanged = copy(wire), api = M.create({ fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(wire) }, finish_reason: 'stop' }] })) });
  assert(api.connect('MOCK_ONLY_NOT_A_REAL_PASSWORD'));
  let canonical;
  try { canonical = await api.request({ context, input }); } finally { api.disconnect(); }
  const result = R.commitModel(before, R.propose(before, { text: input }), canonical), state = accepted(result);
  assert.deepEqual(state.world.objects.map(point), [{ id: 'obj_1', x: 4, y: 6 }, { id: 'obj_2', x: 38, y: 6 }]);
  assert.equal(result.frames[0].world.objects[0].x, 4, 'the first displayed line already uses the final joint-search position');
  assert.equal(state.world.objects[1].x, state.world.objects[0].x + size(state.world.objects[0]).width + 10);
  assert.deepEqual(state.world.weather, before.world.weather); assert.deepEqual(wire, unchanged);
  for (const beat of state.events.at(-1).plan.beats) for (const operation of beat.operations) { assert.equal(operation.placement, undefined); assert.equal(operation.placementPolicy, 'exact'); }
  inSky(state); replay(state);
});

test('relative obstacle search keeps the side axis and an impossible fixed-reference relation rejects atomically', () => {
  const start = fresh(), reference = { type: 'world.create', object: { label: '参照', glyphs: '        ', scale: 1, x: 40, y: 30 }, placementPolicy: 'exact' };
  reference.object.glyphs = '   X    ';
  const obstacle = { type: 'world.create', object: { label: '障碍', glyphs: Array(6).fill('X'.repeat(14)).join('\n'), scale: 2, x: 50, y: 24 }, placementPolicy: 'exact' };
  const before = accepted(commit(start, [reference, obstacle])), state = accepted(commit(before, [create(large, { anchor: 'right_of', target: 'obj_1', gap: 2 })]));
  assert.equal(state.world.objects[2].x, 50); assert.notEqual(state.world.objects[2].y, 28);
  assert.deepEqual(state.world.objects.slice(0, 2), before.world.objects); replay(state);
  const edge = accepted(commit(start, [{ ...reference, object: { ...reference.object, x: 90 } }])), saved = copy(R.serialize(edge));
  const rejected = commit(edge, [create(large, { anchor: 'right_of', target: 'obj_1', gap: 3 })]);
  assert.equal(rejected.ok, false); assert.equal(rejected.error.diagnostic.geometryReason, 'OUT_OF_BOUNDS');
  assert.equal(rejected.state, undefined); assert.equal(rejected.frames, undefined); assert.deepEqual(R.serialize(edge), saved);
});

test('outgoing current request includes relational planning guidance while retaining the exact capability schemas', () => {
  const context = R.context(fresh()), before = copy(context), request = M.buildRequest(context, input), system = request.messages[0].content;
  for (const phrase of ['优先使用left_of、right_of、above或below与target、gap', '留出空隙须使用正gap', '独立的sky或ground锚点', '创建顺序和auto数值坐标也不保证这些关系', '本轮能力定义列出的对应预分配id', '含空格的完整缩放字形矩形', '相对锚点不会自动继承目标所在的区域', 'placementPolicy:"exact"']) assert(system.includes(phrase), phrase);
  const marker = '\n本轮内容与能力定义：\n', definition = JSON.parse(system.slice(system.indexOf(marker) + marker.length));
  assert.deepEqual(definition, C.modelDefinition(context));
  const createDefinition = definition.capabilities.find(item => item.id === 'world.create');
  assert(JSON.stringify(createDefinition.schema).includes('"right_of"')); assert(JSON.stringify(createDefinition.schema).includes('"obj_1"'));
  assert(createDefinition.description.includes('Successful world.create operations allocate these IDs in order this turn: obj_1, obj_2'));
  assert.deepEqual(context, before); assert.equal(JSON.parse(request.messages[1].content).playerSaid, input);
});

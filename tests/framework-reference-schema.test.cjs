'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Caps = require('../framework/capabilities.js');
const Runtime = require('../framework/runtime.js');
const Packs = require('../framework/packs.js');
const Model = require('../framework/model.js');
const copy = value => JSON.parse(JSON.stringify(value));
const fresh = () => Runtime.create(Packs.get('rain-lab'));
const plan = operations => ({ schema: Caps.SCHEMA, topic: null, lines: ['改好了。'], beats: [{ afterLine: 0, operations }] });
const commit = (state, operations) => Runtime.commit(state, Runtime.propose(state, { text: '摆好它们，并记下意义' }), plan(operations));
const create = (label = '纸灯', x = 20, y = 25) => ({ type: 'world.create', object: { label, glyphs: 'X', scale: 1, x, y } });
const descriptors = (state, ids = state.pack.capabilities) => Object.fromEntries(Caps.descriptors(ids, '4', state.world, state.pack.entities).map(item => [item.id, item]));
const rootTargets = item => item.schema.properties.target === false ? [] : item.schema.properties.target.enum;
const placementChoices = item => item.schema.properties.placement === false ? [] : item.schema.properties.placement.anyOf;
const anchors = item => placementChoices(item).flatMap(branch => branch.properties.anchor.enum);
const relativeTargets = item => placementChoices(item).find(branch => branch.required.includes('target'))?.properties.target.enum || [];

test('model reference fields enumerate object IDs and real landmarks without changing canonical validation', () => {
  const initial = fresh(), made = commit(initial, [create('小纸灯')]);
  assert(made.ok, JSON.stringify(made.error));
  const state = made.state, caps = descriptors(state);
  for (const id of ['world.update', 'world.remove']) {
    assert(rootTargets(caps[id]).includes('obj_1'));
    for (const excluded of ['小纸灯', 'rain', 'window', 'visitor', 'obj_999', 'new_1']) assert(!rootTargets(caps[id]).includes(excluded));
    assert.match(caps[id].description, /exact ID.*never a label/);
    assert.match(caps[id].description, /"target":"obj_1"/);
  }
  assert(relativeTargets(caps['world.update']).includes('obj_1'));
  for (const id of ['sky', 'window', 'ground']) assert(relativeTargets(caps['world.update']).includes(id));
  for (const id of ['小纸灯', 'rain', 'visitor', 'obj_999', 'new_1']) assert(!relativeTargets(caps['world.update']).includes(id));
  for (const id of ['obj_1', 'rain', 'window', 'visitor']) assert(rootTargets(caps['world.annotate']).includes(id));
  assert(!rootTargets(caps['world.annotate']).includes('ground'), 'a geometric landmark is not automatically an annotatable pack entity');
  assert(Object.isFrozen(caps['world.update'].schema.properties.target.enum));

  const unknown = { type: 'world.update', target: '小纸灯', changes: {}, placement: { anchor: 'above', target: 'obj_999' } };
  assert.equal(Caps.validate(unknown), true, 'canonical structure remains state-independent');
  const result = commit(state, [unknown]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TARGET_MISSING');
  const placementError = commit(state, [{ ...unknown, target: 'obj_1' }]);
  assert.equal(placementError.ok, false);
  assert.equal(placementError.error.code, 'PLACEMENT_TARGET');
  assert.deepEqual(Runtime.restore(Runtime.serialize(state), state.pack).state, state);
});

test('fresh same-turn creation IDs support relative placement, update, annotation and removal in order', () => {
  const state = fresh(), caps = descriptors(state);
  for (const id of ['world.update', 'world.remove', 'world.annotate']) assert(rootTargets(caps[id]).includes('obj_1'));
  assert(relativeTargets(caps['world.create']).includes('obj_1'));
  assert.match(caps['world.create'].description, /allocate these IDs in order this turn: obj_1, obj_2/);
  assert.match(caps['world.update'].description, /only after its earlier creation and before removal/);
  const second = { type: 'world.create', object: { label: '小星', glyphs: '*', scale: 1 }, placement: { anchor: 'right_of', target: 'obj_1', gap: 2 } };
  const update = { type: 'world.update', target: 'obj_1', changes: { label: '我们的灯' } };
  const annotation = { type: 'world.annotate', target: 'obj_1', field: 'meaning', value: '相聚' };
  const removed = { type: 'world.remove', target: 'obj_2' };
  const result = commit(state, [create(), second, update, annotation, removed]);
  assert(result.ok, JSON.stringify(result.error));
  assert.deepEqual(result.state.world.objects.map(item => item.id), ['obj_1']);
  assert.equal(result.state.world.objects[0].label, '我们的灯');
  assert.equal(result.state.world.annotations.obj_1.meaning, '相聚');
  assert.equal(result.state.world.nextId, 3);
  assert.deepEqual(Runtime.restore(Runtime.serialize(result.state), state.pack).state, result.state);
  for (const operations of [[update, create()], [create(), { ...removed, target: 'obj_1' }, update]]) {
    const invalid = commit(state, operations);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'TARGET_MISSING', 'enumeration does not bypass runtime lifetime checks');
  }
});

test('prospective IDs retain remove-then-create flows while respecting capabilities, capacity and ID exhaustion', () => {
  const pack = Packs.get('rain-lab'); pack.world.capacity = 1;
  const state = Runtime.create(pack), caps = descriptors(state);
  assert.equal(Caps.MAX_OPERATIONS, Runtime.constants.MAX_OPERATIONS);
  const operations = [];
  for (let index = 1; index <= 6; index++) operations.push(create('灯' + index), { type: 'world.remove', target: 'obj_' + index });
  assert(rootTargets(caps['world.remove']).includes('obj_6'));
  assert(!rootTargets(caps['world.remove']).includes('obj_7'));
  assert(commit(state, operations).ok);
  const occupied = commit(state, [create()]).state;
  assert(rootTargets(descriptors(occupied)['world.update']).includes('obj_2'), 'a removal may free a full world slot');
  const withoutRemove = descriptors(occupied, ['world.create', 'world.update']);
  assert.deepEqual(rootTargets(withoutRemove['world.update']), ['obj_1']);
  const withoutCreate = descriptors(state, ['world.update', 'world.remove']);
  assert.deepEqual(rootTargets(withoutCreate['world.update']), []);
  const nearEnd = copy(state.world); nearEnd.nextId = 10000;
  let exposed = Caps.descriptors(['world.create', 'world.update', 'world.remove'], '4', nearEnd);
  assert.deepEqual(rootTargets(exposed.find(item => item.id === 'world.update')), ['obj_10000']);
  nearEnd.nextId = 10001;
  exposed = Caps.descriptors(['world.create', 'world.update', 'world.remove'], '4', nearEnd);
  assert.equal(exposed.find(item => item.id === 'world.update').schema.properties.target, false);
});

test('landmark availability is pack data, including generic packs without rain or window', () => {
  const pack = Packs.get('lantern-lab');
  pack.world.landmarks = { pedestal: { x: 40, y: 30, width: 10, height: 3 } };
  pack.entities = [{ id: 'bell', label: '铜铃', kind: 'object' }];
  const state = Runtime.create(pack), caps = descriptors(state);
  for (const id of ['world.create', 'world.update']) {
    for (const unavailable of ['sky', 'ground', 'window_left', 'window_right', 'window_below']) assert(!anchors(caps[id]).includes(unavailable));
    assert(relativeTargets(caps[id]).includes('pedestal'));
    for (const unavailable of ['rain', 'window', 'bell', '铜铃']) assert(!relativeTargets(caps[id]).includes(unavailable));
  }
  assert(anchors(caps['world.update']).includes('keep_base'));
  assert(!anchors(caps['world.create']).includes('keep_base'));
  assert(rootTargets(caps['world.annotate']).includes('bell'));
  for (const absent of ['rain', 'window', 'pedestal', '铜铃']) assert(!rootTargets(caps['world.annotate']).includes(absent));
  assert(!JSON.stringify(Object.values(caps).filter(item => item.id.startsWith('world.'))).includes('"rain"'), 'scene reference enums do not hardcode story entities');
  const result = commit(state, [{ type: 'world.create', object: { label: '小灯', glyphs: 'X', scale: 1 }, placement: { anchor: 'above', target: 'pedestal', gap: 1 } }, { type: 'world.annotate', target: 'bell', field: 'meaning', value: '回声' }]);
  assert(result.ok, JSON.stringify(result.error));
  assert.equal(result.state.world.annotations.bell.meaning, '回声');
  const absentWindow = { type: 'world.create', object: { label: '小灯', glyphs: 'X', scale: 1 }, placement: { anchor: 'window_left' } };
  assert(Caps.validate(absentWindow));
  assert.equal(commit(state, [absentWindow]).error.code, 'PLACEMENT_TARGET');
  for (const name of ['sky', 'ground', 'window']) {
    const world = { ...state.world, landmarks: { [name]: { x: 10, y: 10, width: 10, height: 10 } } };
    const descriptor = Caps.descriptors(['world.create'], '4', world)[0];
    assert.deepEqual(anchors(descriptor).filter(anchor => ['sky', 'ground', 'window_left', 'window_right', 'window_below'].includes(anchor)), name === 'window' ? ['window_left', 'window_right', 'window_below'] : [name]);
  }
});

test('empty world uses valid impossible schemas and no-world calls preserve legacy descriptor shapes', () => {
  const world = { objects: [], landmarks: {}, capacity: 1, nextId: 10001 };
  const ids = ['world.create', 'world.update', 'world.remove', 'world.annotate', 'memory.upsert'];
  const before = Caps.descriptors(ids);
  const bounded = Object.fromEntries(Caps.descriptors(ids, '4', world).map(item => [item.id, item]));
  assert.equal(bounded['world.create'].schema.properties.placement, false);
  for (const id of ['world.update', 'world.remove', 'world.annotate']) assert.equal(bounded[id].schema.properties.target, false);
  assert(!JSON.stringify(bounded).includes('"enum":[]'));
  assert(!JSON.stringify(bounded).includes('"anyOf":[]'));
  assert.deepEqual(Caps.descriptors(ids), before, 'bounded descriptions never mutate canonical or legacy descriptors');
  assert.deepEqual(before.find(item => item.id === 'world.update').schema.properties.target, { type: 'string', minLength: 1, maxLength: 64 });
  assert.deepEqual(bounded['memory.upsert'], before.find(item => item.id === 'memory.upsert'), 'bodyless report proposal branch is untouched');
  for (const version of ['2', '3']) {
    const legacy = Caps.descriptors(['memory.upsert'], version, world)[0];
    assert(legacy.schema.required.includes('body'));
    assert.equal(legacy.schema.anyOf, undefined);
  }
});

test('request budget measures the exact bounded model schemas in both request locations', () => {
  const state = fresh(), context = copy(Runtime.context(state));
  context.capabilities = Caps.descriptors(state.pack.capabilities, '4', state.world, state.pack.entities);
  const expected = Buffer.byteLength(JSON.stringify({ context: JSON.stringify(context), definition: JSON.stringify(Caps.modelDefinition(context)) }));
  assert.equal(Caps.requestContextBytes(context), expected);
  assert(expected <= Runtime.constants.MAX_CONTEXT_BYTES);
  const request = Model.buildRequest(context, '把灯放在旁边');
  assert(Buffer.byteLength(JSON.stringify(request)) < 128 * 1024);
  assert(request.messages[0].content.includes(JSON.stringify(context.capabilities)));
});

test('reference catalog derives complete scaled ASCII footprints without changing state or accepting dimensions', () => {
  const operation = { type: 'world.create', object: { label: '小灯', glyphs: '  X \nX\n    ', scale: 3, x: 20, y: 25 } };
  const result = commit(fresh(), [operation]);
  assert(result.ok, JSON.stringify(result.error));
  const state = result.state, context = Runtime.context(state), before = JSON.stringify(state), saved = Runtime.serialize(state);
  const definition = Caps.modelDefinition(context), catalog = definition.referenceCatalog;
  assert.deepEqual(catalog.objects, [{ id: 'obj_1', x: 20, y: 25, scale: 3, footprintCols: 12, footprintRows: 9 }]);
  assert.deepEqual(catalog.landmarks, [
    { id: 'sky', x: 4, y: 3, footprintCols: 92, footprintRows: 14 },
    { id: 'window', x: 30, y: 29, footprintCols: 13, footprintRows: 12 },
    { id: 'ground', x: 0, y: 46, footprintCols: 100, footprintRows: 1 }
  ]);
  assert.equal(JSON.stringify(state), before);
  assert(!JSON.stringify(saved).includes('footprintCols'));
  assert(!Object.hasOwn(context.world.objects[0], 'footprintRows'));
  assert(!Object.hasOwn(Runtime.view(state).world.objects[0], 'footprintCols'));
  assert.deepEqual(Runtime.restore(saved, state.pack).state, state);
  assert.equal(Caps.validate({ ...operation, object: { ...operation.object, footprintCols: 12 } }), false);
  assert.equal(Caps.validate({ type: 'world.update', target: 'obj_1', changes: { footprintRows: 9 } }), false);
  const decorated = copy(context);
  Object.assign(decorated.world.objects[0], { footprintCols: 999, footprintRows: 999, unknown: 'do not copy' });
  assert.deepEqual(Caps.modelDefinition(decorated).referenceCatalog, catalog, 'computed metadata never trusts supplied dimensions or unknown fields');
  assert(!JSON.stringify(catalog).includes('小灯'));
  assert(!JSON.stringify(catalog).includes('glyphs'));
  const built = Model.buildRequest(context, '放在旁边');
  assert(built.messages[0].content.endsWith('\n本轮内容与能力定义：\n' + JSON.stringify(definition)));
  assert.equal(Caps.requestContextBytes(context), Buffer.byteLength(JSON.stringify({ context: JSON.stringify(context), definition: JSON.stringify(definition) })));
  assert(Buffer.byteLength(JSON.stringify(built)) < 128 * 1024);
});

test('reference catalog contains only current objects and actual generic landmark rectangles', () => {
  const pack = Packs.get('lantern-lab');
  pack.world.landmarks = { pedestal: { x: 40, y: 30, width: 10, height: 3 } };
  let state = Runtime.create(pack);
  assert.deepEqual(Caps.modelDefinition(Runtime.context(state)).referenceCatalog, { objects: [], landmarks: [{ id: 'pedestal', x: 40, y: 30, footprintCols: 10, footprintRows: 3 }] });
  state = commit(state, [create()]).state;
  state = commit(state, [{ type: 'world.update', target: 'obj_1', changes: { glyphs: 'XX\n X', scale: 2 } }]).state;
  assert.deepEqual(Caps.modelDefinition(Runtime.context(state)).referenceCatalog.objects, [{ id: 'obj_1', x: state.world.objects[0].x, y: state.world.objects[0].y, scale: 2, footprintCols: 4, footprintRows: 4 }]);
  state = commit(state, [{ type: 'world.remove', target: 'obj_1' }]).state;
  assert.deepEqual(Caps.modelDefinition(Runtime.context(state)).referenceCatalog.objects, []);
  assert.deepEqual(Caps.modelDefinition({ character: {} }).referenceCatalog, { objects: [], landmarks: [] });
});

test('maximum reference metadata fits the additional 16 KiB reserved for accepted older contexts', () => {
  const oldCapabilities = Caps.descriptors(), maximumIds = prefix => Array.from({ length: prefix === 'l' ? 12 : 32 }, (_, index) => prefix + String(index).padStart(2, '0') + 'a'.repeat(61));
  const encodedLegacyBytes = context => {
    const definition = { pack: context.pack, persona: { name: '', role: '' }, guidance: '', topics: context.topics, capabilities: context.capabilities };
    return Buffer.byteLength(JSON.stringify({ context: JSON.stringify(context), definition: JSON.stringify(definition) }));
  };
  let maximumDelta = 0;
  for (let count = 0; count <= 8; count++) for (const nextId of [9991, 9995, 10001]) for (let mask = 0; mask < 8; mask++) {
    const reserved = ['sky', 'ground', 'window'].filter((id, index) => mask & (1 << index));
    const world = {
      capacity: 8, nextId,
      objects: Array.from({ length: count }, (_, index) => ({ id: 'obj_' + (nextId - 1 - index), glyphs: Array(10).fill('X'.repeat(24)).join('\n'), x: 10, y: 10, scale: 3 })),
      landmarks: Object.fromEntries([...reserved, ...maximumIds('l').slice(reserved.length)].map(id => [id, { x: 90, y: 50, width: 10, height: 10 }]))
    };
    const entities = maximumIds('e').map(id => ({ id }));
    const context = { pack: {}, character: {}, topics: [], world, entities, capabilities: oldCapabilities };
    const before = encodedLegacyBytes(context);
    context.capabilities = Caps.descriptors(undefined, '4', world, entities);
    const delta = Caps.requestContextBytes(context) - before;
    assert(delta <= 16 * 1024, 'bounded current references must fit above the previous 96 KiB limit');
    maximumDelta = Math.max(maximumDelta, delta);
  }
  assert(maximumDelta > 15 * 1024 - 1024, 'fixture reaches a dense reference catalog');
});

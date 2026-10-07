'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const focus = require('../framework/focus.js');
const pack = { entities: [{ id: 'rain', label: '雨', kind: 'weather' }, { id: 'window', label: '窗', kind: 'landmark' }] };
test('unseen entities are absent; plain chat cannot invent a focus target', () => {
  assert.deepEqual(focus.calculate({ transcript: [{ role: 'user', text: '你好' }], world: { objects: [] } }, pack), []);
});
test('focus follows visible dialogue and object state, sums to exactly one hundred', () => {
  const view = { transcript: [{ role: 'user', text: '雨落在窗外' }, { role: 'her', text: '长椅已经放好了' }], world: { objects: [{ id: 'obj_1', label: '长椅' }], weather: { intensity: 1, paused: false } } };
  const first = focus.calculate(view, pack);
  assert.equal(first.reduce((sum, item) => sum + item.percent, 0), 100);
  assert.deepEqual(first, focus.calculate(view, pack));
  assert(first.find(item => item.id === '#object/obj_1'));
  assert(first.every(item => item.evidence.length));
});
test('recent topic wins after unrelated older topic decays, hidden lines never count', () => {
  const view = { transcript: [{ role: 'user', text: '雨' }, ...Array.from({ length: 8 }, () => ({ role: 'user', text: '聊聊窗' })), { role: 'her', text: '雨雨雨', incomplete: true }], world: { objects: [] } };
  const rows = focus.calculate(view, pack);
  assert.equal(rows[0].id, 'window');
  assert(rows[0].percent > 80);
});
test('a weather capability supplies encountered focus even when the content pack has no weather topic', () => {
  const workshop = { entities: [{ id: 'window', label: '窗', kind: 'landmark' }] };
  const before = { revision: 1, transcript: [], world: { objects: [], weather: { name: '窗外天气', intensity: 0, paused: true, source: null } } };
  assert.deepEqual(focus.calculate(before, workshop), []);
  const after = { ...before, revision: 2, world: { ...before.world, weather: { name: '窗外天气', intensity: 1, paused: false, source: { eventId: 'event_2', text: '让雨恢复' } } } };
  assert.equal(focus.calculate(after, workshop)[0].id, '#weather');
  assert.equal(focus.calculate(after, workshop)[0].percent, 100);
  const paused = { ...after, revision: 3, world: { ...after.world, weather: { ...after.world.weather, paused: true } } };
  assert(focus.calculate(paused, workshop)[0].score < focus.calculate(after, workshop)[0].score);
});
test('authored IDs cannot inherit unseen evidence from dynamic objects or weather', () => {
  const colliding = { entities: [{ id: 'runtime.weather', label: '未出现的钟', kind: 'place' }, { id: 'obj_1', label: '未出现的门', kind: 'place' }] };
  const view = { revision: 1, transcript: [], world: { objects: [{ id: 'obj_1', label: '长椅' }], weather: { name: '雨', intensity: 1, paused: false, source: { eventId: 'event_1', text: '下雨' } } } };
  const rows = focus.calculate(view, colliding);
  assert.deepEqual(rows.map(row => row.label).sort(), ['长椅', '雨'].sort());
  assert(rows.every(row => row.id.startsWith('#')));
});

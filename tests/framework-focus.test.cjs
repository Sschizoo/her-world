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
  assert(first.find(item => item.id === 'obj_1'));
  assert(first.every(item => item.evidence.length));
});
test('recent topic wins after unrelated older topic decays, hidden lines never count', () => {
  const view = { transcript: [{ role: 'user', text: '雨' }, ...Array.from({ length: 8 }, () => ({ role: 'user', text: '聊聊窗' })), { role: 'her', text: '雨雨雨', incomplete: true }], world: { objects: [] } };
  const rows = focus.calculate(view, pack);
  assert.equal(rows[0].id, 'window');
  assert(rows[0].percent > 80);
});

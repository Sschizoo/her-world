'use strict';

// Offline UI + canonical replay. DOM emulation is not browser pixel QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, runtime, packs } = require('./helpers/framework-ui-harness.cjs');

const kinds = [['雨', 'rain', '雨'], ['雪', 'snow', '雪'], ['雾', 'mist', '雾'], ['晴', 'clear', '晴空']];
const summaryIds = ['world-status', 'weather-status', 'world-summary', 'world-caption'];
async function say(r, input) {
  await r.say(input); await r.timers.flush();
  assert.equal(r.app.snapshot().lastFailure, null);
}
function expectLabels(r, label, state, name) {
  const world = r.app.snapshot().visible.world;
  assert.equal(r.ids['world-status'].textContent, world.objects.length + ' objects · ' + label + ' · ' + state);
  assert.equal(r.ids['weather-status'].textContent, label + ' / ' + state + (name ? ' · 名称：' + name : ''));
  assert.equal(r.ids['world-summary'].textContent, '天气：' + label + ' · ' + state + (name ? '　名称：' + name : '') + '　物件 ' + world.objects.length + ' / ' + world.capacity + (world.weather.source ? '　来源：' + world.weather.source.text : ''));
  assert.equal(r.ids['world-caption'].textContent, name || (world.objects.length ? world.objects.at(-1).label : '一处可以慢慢填满的空白'));
  assert.deepEqual(r.draws.at(-1), world, 'labels and drawing consume the same visible world');
}
function restoreWithoutChanges(r, packId) {
  const before = structuredClone(r.app.snapshot().state), key = r.app.snapshot().storageKey, saved = r.store.get(key);
  const replay = runtime.restore(saved, packs.get(packId));
  assert(replay.ok); assert.deepEqual(replay.state, before);
  const next = setup({ store: r.store, search: '?pack=' + packId });
  assert.deepEqual(next.app.snapshot().state, before);
  assert.equal(next.store.get(key), saved, 'displaying the restored state does not rewrite saved bytes');
  assert.equal(next.model.calls(), 0);
  return next;
}

for (const packId of ['rain-lab', 'lantern-lab']) {
  test(packId + ': switching all weather types labels kind separately from the preserved default name', async () => {
    const r = setup({ search: '?pack=' + packId });
    try {
      await r.offline();
      const name = r.app.snapshot().state.world.weather.name;
      for (const [command, kind, label] of kinds) {
        await say(r, '/天气 ' + command);
        const weather = r.app.snapshot().state.world.weather;
        assert.equal(weather.kind, kind); assert.equal(weather.name, name);
        assert.equal(weather.intensity, kind === 'clear' ? 0 : 1); assert.equal(weather.paused, false);
        expectLabels(r, label, kind === 'clear' ? '安静' : '强度 1', name);
        const next = restoreWithoutChanges(r, packId);
        try { expectLabels(next, label, kind === 'clear' ? '安静' : '强度 1', name); }
        finally { next.app.destroy(); }
      }
      assert.equal(r.model.calls(), 0);
    } finally { r.app.destroy(); }
  });
}

for (const [command, kind, label] of kinds) {
  test(kind + ': named weather stays literal across intensity, pause, replay and repeated updates', async () => {
    const r = setup(), name = '<b>雪 & 雨</b>';
    try {
      for (const id of summaryIds) Object.defineProperty(r.ids[id], 'innerHTML', { set() { assert.fail(id + ' must only use plain text'); } });
      await r.offline(); await say(r, '/创建 纸船');
      const objects = structuredClone(r.app.snapshot().state.world.objects);
      await say(r, '/天气 ' + command); await say(r, '/命名 ' + name);
      if (kind !== 'clear') await say(r, '/天气 强度 3');
      expectLabels(r, label, kind === 'clear' ? '安静' : '强度 3', name);
      for (let repeat = 0; repeat < 2; repeat++) {
        await say(r, '/天气 停');
        assert.equal(r.app.snapshot().state.world.weather.kind, kind);
        assert.equal(r.app.snapshot().state.world.weather.intensity, kind === 'clear' ? 0 : 3);
        assert.equal(r.app.snapshot().state.world.weather.paused, true);
        expectLabels(r, label, '暂停', name);
        const next = restoreWithoutChanges(r, 'rain-lab');
        try { expectLabels(next, label, '暂停', name); }
        finally { next.app.destroy(); }
        if (kind !== 'clear') {
          await say(r, '/天气 恢复');
          assert.equal(r.app.snapshot().state.world.weather.paused, false);
          expectLabels(r, label, '强度 3', name);
        }
      }
      assert.deepEqual(r.app.snapshot().state.world.objects, objects);
      for (const id of summaryIds) assert.equal(r.ids[id].children.length, 0, id + ' contains no parsed name markup');
      assert.equal(r.app.snapshot().state.world.weather.name, name);
      assert.equal(r.model.calls(), 0);
    } finally { r.app.destroy(); }
  });
}

test('weather summaries change with the visible sentence, never with a future committed kind', async () => {
  const r = setup({ reduced: false });
  try {
    await r.offline();
    const name = r.app.snapshot().state.world.weather.name;
    expectLabels(r, '雨', '暂停', name);
    await r.say('/天气 雪');
    assert.equal(r.app.snapshot().state.world.weather.kind, 'snow');
    assert.equal(r.app.snapshot().visible.world.weather.kind, 'rain');
    expectLabels(r, '雨', '暂停', name);
    await r.timers.flush(); expectLabels(r, '雪', '强度 1', name);
    const before = structuredClone(r.app.snapshot().state), count = r.draws.length;
    await r.ids['tab-memory'].emit('click'); await r.ids['tab-world'].emit('click');
    assert.deepEqual(r.app.snapshot().state, before);
    assert.equal(r.draws.length, count, 'unchanged weather does not redraw');
    expectLabels(r, '雪', '强度 1', name);
  } finally { r.app.destroy(); }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const O = require('../framework/offline.js');
const { setup } = require('./helpers/framework-ui-harness.cjs');

function say(state, input) {
  const plan = O.respond(R.context(state), input);
  const result = R.commit(state, R.propose(state, { text: input }), plan);
  assert(result.ok, JSON.stringify(result.error));
  return { ...result, plan };
}

for (const packId of ['rain-lab', 'lantern-lab']) {
  test(packId + ': rain-specific stop leaves snow, mist and clear weather unchanged', () => {
    for (const name of ['雪', '雾', '晴']) {
      for (const paused of [false, true]) {
        let state = say(R.create(P.get(packId)), '/天气 ' + name).state;
        if (paused) state = say(state, '/天气 停').state;
        for (const input of ['停雨', '让雨停下吧。', '雨先停一下！']) {
          const before = structuredClone(state), result = say(state, input);
          assert.deepEqual(result.plan.beats, []);
          assert.match(result.lines[0], /现在不是雨/);
          assert.match(result.lines[0], /\/天气 停/);
          assert.deepEqual(result.state.world, before.world);
          assert.deepEqual(result.state.memories, before.memories);
          assert.deepEqual(result.state.story, before.story);
          assert.deepEqual(state, before, 'the input state is not mutated');
          const restored = R.restore(JSON.stringify(R.serialize(result.state)), P.get(packId));
          assert(restored.ok);
          assert.deepEqual(restored.state, result.state);
        }
      }
    }
  });

  test(packId + ': actual and already paused rain retain their kind, name and density', () => {
    let state = say(R.create(P.get(packId)), '/天气 雨').state;
    state = say(state, '/天气 强度 3').state;
    state = say(state, '/命名 叶间信').state;
    for (const input of ['停雨', '让雨停下吧。', '雨先停一下！']) {
      const result = say(state, input);
      assert.equal(result.state.world.weather.kind, 'rain');
      assert.equal(result.state.world.weather.name, '叶间信');
      assert.equal(result.state.world.weather.intensity, 3);
      assert.equal(result.state.world.weather.paused, true);
      assert.match(result.lines[0], /雨先停在这里/);
      state = result.state;
    }
    const resumed = say(state, '/天气 恢复').state;
    assert.equal(resumed.world.weather.kind, 'rain');
    assert.equal(resumed.world.weather.intensity, 3);
    assert.equal(resumed.world.weather.paused, false);
  });

  test(packId + ': generic stop still pauses the explicitly selected weather', () => {
    for (const name of ['雨', '雪', '雾', '晴']) {
      const before = say(R.create(P.get(packId)), '/天气 ' + name).state;
      const after = say(before, '/天气 停').state;
      assert.equal(after.world.weather.kind, before.world.weather.kind);
      assert.equal(after.world.weather.name, before.world.weather.name);
      assert.equal(after.world.weather.intensity, before.world.weather.intensity);
      assert.equal(after.world.weather.paused, true);
    }
  });
}

test('ordinary negated or hypothetical rain phrases do not execute an offline stop', () => {
  const state = say(R.create(P.get('rain-lab')), '/天气 雨').state;
  for (const input of ['不要停雨', '如果停雨会怎样？', '刚才你让雨停下了吗？']) {
    const result = say(state, input);
    assert.deepEqual(result.plan.beats, []);
    assert.deepEqual(result.state.world, state.world);
  }
});

test('offline app clarifies a wrong weather target without calling a model or switching weather', async () => {
  const r = setup({ reduced: true, search: '?pack=lantern-lab' });
  try {
    await r.offline();
    await r.say('/天气 雪'); await r.timers.flush();
    const before = structuredClone(r.app.snapshot().state.world);
    await r.say('停雨'); await r.timers.flush();
    assert.equal(r.app.snapshot().lastFailure, null);
    assert.deepEqual(r.app.snapshot().state.world, before);
    assert.match(r.ids.transcript.textContent, /现在不是雨/);
    assert.equal(r.model.calls(), 0);
    await r.say('/天气 停'); await r.timers.flush();
    assert.equal(r.app.snapshot().state.world.weather.kind, 'snow');
    assert.equal(r.app.snapshot().state.world.weather.paused, true);
    assert.equal(r.model.calls(), 0);
  } finally { r.app.destroy(); }
});

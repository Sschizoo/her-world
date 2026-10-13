'use strict';
/* All 21 outputs are historical independent GPT substitutes, captured before
 * the current explicit-alignment capability descriptors. Lantern's 13 captures
 * also predate existing-object completion. These are compatibility replays.
 * The UI harness is DOM emulation, not browser, GLM/provider, network, or
 * security-review evidence. Generation-time fixture bytes remain unchanged. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const { setup } = require('./helpers/framework-ui-harness.cjs');
const fixturePath = path.join(__dirname, 'fixtures/framework-batch-v019-surrogate.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const rainFixturePath = path.join(__dirname, 'fixtures/framework-rain-v019-surrogate.json');
const rainFixture = JSON.parse(fs.readFileSync(rainFixturePath, 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const pack = P.get(fixture.pack);
// Reconstruct only the one content-pack opt-in added after these 13 captures.
// Keep this exact historical definition at the model and app boundaries. The
// current capability prompt is different; never rewrite captured request hashes
// or manufacture a historical wire request by normalizing today's request.
delete pack.nodes.find(node => node.id === 'make').completion.existing;
assert.equal(R.serialize(R.create(pack)).pack.digest, 'd11120d9');
const historicalPacks = {
  get: id => id === pack.id ? JSON.parse(JSON.stringify(pack)) : P.get(id),
  list: () => P.list().map(item => historicalPacks.get(item.id))
};
const dimensions = object => ({
  width: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale,
  height: object.glyphs.split('\n').length * object.scale
});

function assertGeometry(world) {
  for (const object of world.objects) {
    const size = dimensions(object);
    assert(object.x >= 0 && object.y >= 0);
    assert(object.x + size.width <= world.grid.cols);
    assert(object.y + size.height <= world.grid.rows);
  }
  for (let i = 0; i < world.objects.length; i++) {
    for (let j = i + 1; j < world.objects.length; j++) {
      const a = world.objects[i], b = world.objects[j];
      const x = dimensions(a), y = dimensions(b);
      assert.equal(a.x < b.x + y.width && a.x + x.width > b.x &&
        a.y < b.y + y.height && a.y + x.height > b.y, false, 'objects overlap');
    }
  }
}

function assertCapture(record) {
  assert.equal(record.requestUnchanged, true);
  assert(!Number.isNaN(Date.parse(record.capturedAt)));
  assert.equal(sha(record.raw), record.sha256, 'unmodified first raw output');
  // The fixture's pinned file hash preserves the original generation-time hashes.
  // Current requests intentionally differ after capability-prompt changes.
  assert.match(record.requestSha256, /^[a-f0-9]{64}$/, 'historical generation-time request body hash');
  assert.match(record.requestFileSha256, /^[a-f0-9]{64}$/, 'historical generation-time request file hash');
  assert.deepEqual(record.responderReceipt, {
    requestFileSha256: record.requestFileSha256,
    responseSha256: record.sha256
  });
}

function transport(records = fixture.records) {
  const bodies = [];
  const model = M.create({ fetch: async (_url, options) => {
    const record = records[bodies.length];
    bodies.push(options.body);
    assert(record, 'unexpected additional model call');
    return new Response(JSON.stringify({
      choices: [{ message: { content: record.raw }, finish_reason: 'stop' }]
    }), { status: 200 });
  } });
  return { model, bodies };
}

const routes = new Map();
function replayCapturedRoute(source = fixture) {
  if (routes.has(source)) return routes.get(source);
  const route = (async () => {
    const wire = transport(source.records), turns = [];
    const routePack = source === fixture ? pack : P.get(source.pack);
    let state = R.create(routePack);
    wire.model.connect('DUMMY_ATTESTED_SURROGATE_ONLY');
    try {
      for (const [index, record] of source.records.entries()) {
        const before = state, context = R.context(before);
        const request = M.buildRequest(context, record.input);
        assertCapture(record);
        const canonical = await wire.model.request({ context, input: record.input });
        assert.equal(wire.bodies[index], JSON.stringify(request));
        assert.equal(canonical.schema, 'her-world-turn-v2');
        const result = R.commitModel(before, R.propose(before, { text: record.input }), canonical);
        assert.equal(result.ok, true, `turn ${index + 1}: ${JSON.stringify(result.error)}`);
        state = result.state;
        const restored = R.restore(JSON.stringify(R.serialize(state)), routePack);
        assert.equal(restored.ok, true);
        assert.deepEqual(restored.state, state, `turn ${index + 1} stored replay`);
        assert.deepEqual(result.lines, JSON.parse(record.raw).lines.map(row => row.text));
        assert.equal(result.frames.length, result.lines.length);
        for (const [line, frame] of result.frames.entries()) {
          assertGeometry(frame.world);
          assert.deepEqual(R.view(restored.state, { event: state.events.length - 1, line }), frame,
            `turn ${index + 1}, sentence ${line + 1} stored frame`);
        }
        const accepted = state;
        if (record.afterPanelObservation) state = R.observe(state, record.afterPanelObservation);
        const saved = R.restore(JSON.stringify(R.serialize(state)), routePack);
        assert.equal(saved.ok, true);
        assert.deepEqual(saved.state, state);
        turns.push({ before, context, request, canonical, result, accepted, state });
      }
      assert.equal(wire.bodies.length, source.records.length);
      return turns;
    } finally {
      wire.model.disconnect();
    }
  })();
  routes.set(source, route);
  return route;
}

test('13 historical lantern captures retain their attestations and compatibility-replay through the current adapter, runtime and saved frames', async () => {
  assert.equal(sha(fs.readFileSync(fixturePath)), '1bfdebc21c8e6e5d9193687a19e01330a40cf6c548770c5a60fd10df0e41e0b9');
  assert.equal(fixture.records.length, 13);
  assert.equal(fixture.pack, 'lantern-lab');
  assert.equal(fixture.rulesVersion, '4');
  assert.equal(fixture.modelProtocol, 'her-world-turn-v4');
  const turns = await replayCapturedRoute();
  const at = index => turns[index].state;
  const object = (index, id) => at(index).world.objects.find(item => item.id === id);

  assert.deepEqual(turns[0].result.frames.map(frame => frame.story.completed), [['purpose'], ['purpose', 'make']]);
  assert.deepEqual(turns[0].result.frames.map(frame => frame.memories.length), [1, 1]);
  assert.deepEqual(turns[0].result.frames.map(frame => frame.world.objects.length), [0, 1]);
  assert.equal(at(0).story.answers.q_purpose.value, '在窗边读书');
  assert.equal(at(0).memories[0].body, '我想在窗边读书。');
  assert.equal(at(0).memories[0].perspective, 'player_report');
  assert.equal(object(0, 'obj_1').label, '双人长椅');
  assert.equal(object(0, 'obj_1').y, at(0).world.landmarks.window.y + at(0).world.landmarks.window.height + 1);
  assert.deepEqual(at(0).story.completed, ['purpose', 'make', 'inspect']);
  assert.deepEqual(at(0).events.at(-1), { id: 'event_2', ...fixture.records[0].afterPanelObservation });
  assert.deepEqual(at(1).story.completed, ['purpose', 'make', 'inspect', 'route']);
  assert.deepEqual(at(2).story.completed, ['purpose', 'make', 'inspect', 'route', 'stay']);
  assert.equal(at(2).story.answers.q_route.value, 'stay');
  assert.equal(at(2).facts.route_expressed, true);
  assert.equal(at(2).world.annotations.obj_1.meaning, '坐下来的时候就可以不着急了。');

  assert.equal(object(3, 'obj_2').x - object(3, 'obj_1').x - dimensions(object(3, 'obj_1')).width, 4);
  assert.equal(object(4, 'obj_2').x - object(4, 'obj_1').x - dimensions(object(4, 'obj_1')).width, 8);
  assert(object(4, 'obj_2').x > object(3, 'obj_2').x);
  assert.deepEqual(object(4, 'obj_1'), object(3, 'obj_1'), 'moving the lamp preserves its neighbor');
  assert.deepEqual(JSON.parse(fixture.records[5].raw).requestedChanges, []);
  assert.deepEqual(at(5).world, at(4).world, 'hypothetical removal does not mutate the world');
  assert.deepEqual(at(5).memories, at(4).memories);
  assert.deepEqual(at(5).story, at(4).story);

  const firstPreference = at(6).memories.at(-1);
  assert.equal(at(6).memories.length, 3, 'salient preference does not need an explicit remember command');
  assert.equal(firstPreference.body, fixture.records[6].input);
  assert.equal(firstPreference.perspective, 'player_report');
  const exposed = turns[7].context.memories.find(note => note.body === firstPreference.body);
  const correction = turns[7].canonical.beats.flatMap(beat => beat.operations).find(op => op.type === 'memory.upsert');
  assert.equal(correction.id, exposed.id, 'correction uses the current opaque handle');
  assert.equal(correction.id, 'memory_3');
  const corrected = at(7).memories.find(note => note.id === firstPreference.id);
  assert.equal(at(7).memories.length, 3);
  assert.deepEqual(corrected.source, firstPreference.source, 'first source survives correction');
  assert.equal(corrected.currentRevision.number, 2);
  assert.equal(corrected.currentRevision.text, fixture.records[7].input);
  assert.equal(corrected.body, fixture.records[7].input);
  assert.deepEqual(at(7).world, at(6).world);

  assert.equal(at(8).memories.length, 2);
  assert(!at(8).memories.some(note => note.id === firstPreference.id));
  const recall = JSON.stringify(turns[9].context);
  for (const index of [6, 7, 8]) assert(!recall.includes(fixture.records[index].input), `forgotten source turn ${index + 1} excluded`);
  assert(!turns[9].context.memories.some(note => note.id === exposed.id));
  assert(turns[9].context.memories.some(note => note.body === at(0).memories[0].body));
  assert(turns[9].context.memories.some(note => note.body === fixture.records[2].input), 'independent earlier fact remains available');
  assert(fixture.records[9].raw.includes(fixture.records[2].input));
  assert(!fixture.records[9].raw.includes(fixture.records[6].input));
  assert(!fixture.records[9].raw.includes(fixture.records[7].input));
  assert(at(9).events.some(event => event.input === fixture.records[6].input), 'forgetting retains the independent audit');
  assert.deepEqual(at(9).memories, at(8).memories, 'recall does not silently restore a deleted memory');

  const learned = at(10).memories.at(-1);
  assert.notEqual(learned.id, firstPreference.id, 'relearning receives a fresh identity');
  assert.equal(learned.source.text, fixture.records[10].input);
  assert.equal(learned.currentRevision.number, 1);
  assert.equal(learned.body, '现在我更喜欢一盏很小、不会抢走注意力的灯。');
  assert.notEqual(R.view(at(10)).memories.at(-1).recallHandle, exposed.id);
  assert.deepEqual(at(10).memories.slice(0, 2), at(9).memories);
  assert.deepEqual(at(10).world, at(9).world);

  assert.equal(object(11, 'obj_2').scale, 2);
  assert.equal(object(11, 'obj_2').glyphs, object(10, 'obj_2').glyphs);
  assert.equal(object(11, 'obj_2').y + dimensions(object(11, 'obj_2')).height,
    object(10, 'obj_2').y + dimensions(object(10, 'obj_2')).height, 'scaling keeps the lamp base');
  assert.deepEqual(object(11, 'obj_1'), object(10, 'obj_1'));
  assert.equal(object(12, 'obj_1').x - object(12, 'obj_2').x - dimensions(object(12, 'obj_2')).width, 3);
  assert.equal(object(12, 'obj_2').y + dimensions(object(12, 'obj_2')).height,
    at(12).world.landmarks.ground.y, 'fresh raw placement preserves current ground contact');
  assert.deepEqual(object(12, 'obj_1'), object(11, 'obj_1'));
  assert.equal(at(12).world.weather.paused, true);
  assert.deepEqual(at(12).world.weather, at(11).world.weather, 'already-paused weather remains unchanged');
  assert.deepEqual(at(12).story.completed, ['purpose', 'make', 'inspect', 'route', 'stay']);
});

test('the real app compatibility-replays 13 historical lantern outputs using fresh requests and the ordinary world-panel observation', async t => {
  const turns = await replayCapturedRoute(), wire = transport();
  const r = setup({ model: wire.model, packs: historicalPacks, search: '?pack=lantern-lab' });
  t.after(() => r.app.destroy());
  await r.online();
  for (const [index, record] of fixture.records.entries()) {
    await r.say(record.input);
    await r.timers.flush();
    assert.equal(wire.bodies.length, index + 1);
    assert.equal(wire.bodies[index], JSON.stringify(turns[index].request), `fresh compatibility request ${index + 1}`);
    const snapshot = r.app.snapshot();
    assert.equal(snapshot.lastFailure, null);
    assert.equal(snapshot.busy, false);
    assert.equal(snapshot.revealing, false);
    assert.deepEqual(snapshot.state, turns[index].state, `actual app state ${index + 1}`);
    assert.deepEqual(snapshot.visible, R.view(snapshot.state));
    const restored = R.restore(r.store.get(snapshot.storageKey), pack);
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.state, snapshot.state);
    assert.equal(r.ids['object-count'].textContent, String(snapshot.state.world.objects.length).padStart(2, '0'));
    assert.equal(r.ids['memory-count'].textContent, String(snapshot.state.memories.length).padStart(2, '0'));
    if (index === 0) {
      assert.equal(snapshot.activePanel, 'world');
      assert.equal(r.ids['panel-world'].hidden, false);
      assert.deepEqual(snapshot.state.events.at(-1), { id: 'event_2', ...record.afterPanelObservation });
    }
    if (index === 7) assert(r.ids['memory-list'].textContent.includes(record.input));
    if (index === 8) assert(!r.ids['memory-list'].textContent.includes(fixture.records[7].input));
    if (index === 10) assert(r.ids['memory-list'].textContent.includes('现在我更喜欢一盏很小、不会抢走注意力的灯。'));
  }
  assert.equal(wire.bodies.length, 13);
});

test('the historical compound turn reveals memory and bench panels only with their respective sentences', async t => {
  const [turn] = await replayCapturedRoute(), wire = transport([fixture.records[0]]);
  const r = setup({ model: wire.model, packs: historicalPacks, reduced: false, search: '?pack=lantern-lab' });
  t.after(() => r.app.destroy());
  await r.online();
  await r.say(fixture.records[0].input);
  assert.equal(wire.bodies[0], JSON.stringify(turn.request));
  assert.deepEqual(r.app.snapshot().state, turn.accepted, 'entire accepted turn is saved before reveal');
  assert.equal(r.ids['memory-count'].textContent, '00');
  assert.equal(r.ids['object-count'].textContent, '00');
  assert(!r.ids['memory-list'].textContent.includes('我想在窗边读书。'));
  assert(!r.ids['objects-list'].textContent.includes('双人长椅'));
  await r.ids['skip-reveal'].emit('click');
  assert.deepEqual(r.app.snapshot().visible, turn.result.frames[0]);
  assert.equal(r.ids['memory-count'].textContent, '01');
  assert.equal(r.ids['object-count'].textContent, '00');
  assert(r.ids['memory-list'].textContent.includes('我想在窗边读书。'));
  assert(!r.ids['objects-list'].textContent.includes('双人长椅'));
  await r.ids['skip-reveal'].emit('click');
  await r.timers.advance(360);
  assert.equal(r.ids['object-count'].textContent, '00', 'the next sentence must finish before its operation appears');
  await r.ids['skip-reveal'].emit('click');
  assert.deepEqual(r.app.snapshot().visible, turn.result.frames[1]);
  assert.equal(r.ids['object-count'].textContent, '01');
  assert(r.ids['objects-list'].textContent.includes('双人长椅'));
  await r.timers.flush();
  assert.deepEqual(r.app.snapshot().state, turn.state);
  assert.equal(wire.bodies.length, 1);
});

test('reload midway through the historical first reply restores the complete saved turn without a second model call', async t => {
  const [turn] = await replayCapturedRoute(), wire = transport([fixture.records[0]]);
  const r = setup({ model: wire.model, packs: historicalPacks, reduced: false, search: '?pack=lantern-lab' });
  t.after(() => r.app.destroy());
  await r.online();
  await r.say(fixture.records[0].input);
  await r.ids['skip-reveal'].emit('click');
  assert.equal(r.app.snapshot().revealing, true);
  assert.equal(r.ids['object-count'].textContent, '00');
  const key = r.app.snapshot().storageKey, saved = r.store.get(key);
  const restored = R.restore(saved, pack);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state, turn.accepted);
  r.app.destroy();
  const reloadedWire = transport([]);
  const next = setup({ model: reloadedWire.model, packs: historicalPacks, store: r.store, reduced: false, search: '?pack=lantern-lab' });
  t.after(() => next.app.destroy());
  await next.timers.flush();
  assert.equal(next.app.snapshot().lastFailure, null);
  assert.equal(next.app.snapshot().revealing, false);
  assert.deepEqual(next.app.snapshot().state, turn.accepted);
  assert.deepEqual(next.app.snapshot().visible, R.view(turn.accepted));
  assert.equal(next.store.get(key), saved);
  assert.equal(next.ids['memory-count'].textContent, '01');
  assert.equal(next.ids['object-count'].textContent, '01');
  assert(next.ids.transcript.textContent.includes(JSON.parse(fixture.records[0].raw).lines[1].text));
  assert.equal(wire.bodies.length, 1);
  assert.equal(reloadedWire.bodies.length, 0);
});

test('8 historical rain captures preserve attestations and compatibility-replay deferral, all four nodes, consent, clouds and shared-event evidence', async () => {
  assert.equal(sha(fs.readFileSync(rainFixturePath)), '58b7371da66b440629fba1de8856e995b66b3132a7fa9adf9f2d9cd474bf7319');
  assert.equal(rainFixture.records.length, 8);
  assert.equal(rainFixture.pack, 'rain-lab');
  assert.equal(rainFixture.rulesVersion, '4');
  assert.equal(rainFixture.modelProtocol, 'her-world-turn-v4');
  const turns = await replayCapturedRoute(rainFixture);
  const at = index => turns[index].state;
  assert.deepEqual(at(0).story.completed, []);
  assert.deepEqual(at(0).story.deferred, ['q_rain']);
  assert.deepEqual(at(0).world, turns[0].before.world);
  assert.equal(at(0).memories[0].body, '我更喜欢叶子相互碰到的那种声音。');
  assert.equal(at(0).memories[0].perspective, 'player_report');
  assert.deepEqual(turns[0].result.frames.map(frame => frame.memories.length), [0, 1]);
  assert.deepEqual(at(1).story.completed, ['describe']);
  assert.deepEqual(at(1).story.deferred, []);
  assert.equal(at(1).memories[1].body, '雨像天空把攒着的水一点点放下来，碰到叶面就像有人轻敲。');
  assert.equal(at(1).memories[1].perspective, 'player_report');
  assert.deepEqual(turns[1].result.frames.map(frame => frame.world.weather.paused), [true, false]);
  assert.deepEqual(turns[1].result.frames.map(frame => frame.world.weather.intensity), [0, 1]);
  assert.equal(at(2).world.weather.name, '叶间信');
  assert.deepEqual(turns[2].accepted.story.completed, ['describe', 'name']);
  assert.deepEqual(at(2).story.completed, ['describe', 'name', 'read']);
  assert.deepEqual(at(2).events.at(-1), { id: 'event_4', ...rainFixture.records[2].afterPanelObservation });
  assert.deepEqual(at(3).story.completed, ['describe', 'name', 'read', 'visitor']);
  assert.equal(at(3).story.answers.q_visitor.value, 'decline');
  assert.equal(at(3).facts.visitor_decided, true);
  assert.deepEqual(at(3).memories, at(2).memories, 'declining a visitor reference creates no identity memory');
  assert.deepEqual(at(3).world, at(2).world);

  for (const index of [4, 6]) {
    const original = JSON.parse(rainFixture.records[index].raw);
    assert.deepEqual(original.requestedChanges, []);
    assert(original.lines.every(line => line.mode === 'discussion' && line.operations.length === 0));
    assert.deepEqual(at(index).world, turns[index].before.world, 'hypothetical/casual words do not execute scene or weather changes');
    assert.deepEqual(at(index).memories, turns[index].before.memories);
    assert.deepEqual(at(index).story.completed, turns[index].before.story.completed);
  }
  assert.equal(at(5).world.weather.intensity, 2);
  assert.equal(at(5).world.weather.paused, false);
  assert.deepEqual(turns[5].result.frames.map(frame => frame.world.objects.length), [0, 2]);
  const clouds = at(5).world.objects, sky = at(5).world.landmarks.sky;
  assert.equal(clouds.length, 2);
  assert.notEqual(clouds[0].glyphs, clouds[1].glyphs);
  for (const cloud of clouds) {
    const size = dimensions(cloud);
    assert(cloud.x >= sky.x && cloud.y >= sky.y);
    assert(cloud.x + size.width <= sky.x + sky.width);
    assert(cloud.y + size.height <= sky.y + sky.height);
    assert.equal(cloud.source.createdBy, rainFixture.records[5].input);
  }

  const last = at(7), shared = last.memories.at(-1), finalInput = rainFixture.records[7].input;
  assert.deepEqual(turns[7].result.frames.map(frame => frame.world.weather.paused), [true, true]);
  assert.deepEqual(turns[7].result.frames.map(frame => frame.memories.length), [2, 3]);
  assert.equal(shared.kind, 'experience');
  assert.equal(shared.perspective, 'shared_event');
  assert.equal(shared.body, '一起调整了世界里的天气');
  const rawMemory = JSON.parse(rainFixture.records[7].raw).lines[1].operations[0];
  assert.equal(rawMemory.body, shared.body);
  assert.equal(Object.hasOwn(rawMemory, 'eventSupport'), false);
  assert.equal(Object.hasOwn(rawMemory, 'support'), false);
  const eventId = last.events.at(-1).id;
  assert.deepEqual(shared.eventSupport, { eventId, index: 0, type: 'weather.set' });
  assert.deepEqual(shared.support, { eventId, channel: 'player', start: 0, end: finalInput.length, quote: finalInput });
  assert.deepEqual(shared.source, { eventId, text: finalInput, span: { start: 0, end: finalInput.length } });
  assert.deepEqual(last.world.objects, at(6).world.objects);
  assert.deepEqual(last.memories.slice(0, 2), at(6).memories);
  assert.deepEqual(last.story.completed, ['describe', 'name', 'read', 'visitor']);
  const lanternTurns = await replayCapturedRoute();
  assert.equal(last.story.completed.length + lanternTurns.at(-1).state.story.completed.length, 9);
});

test('the real app compatibility-replays 8 historical rain outputs with fresh requests, a logs-panel visit, and weather-before-memory reveal', async t => {
  const turns = await replayCapturedRoute(rainFixture), wire = transport(rainFixture.records);
  const r = setup({ model: wire.model, reduced: false, search: '?pack=rain-lab' });
  t.after(() => r.app.destroy());
  await r.online();
  for (const [index, record] of rainFixture.records.entries()) {
    await r.say(record.input);
    assert.equal(wire.bodies.length, index + 1);
    assert.equal(wire.bodies[index], JSON.stringify(turns[index].request), `fresh rain compatibility request ${index + 1}`);
    assert.equal(r.app.snapshot().lastFailure, null);
    if (index === 7) {
      assert.equal(r.app.snapshot().visible.world.weather.paused, false);
      assert.equal(r.ids['memory-count'].textContent, '02');
      assert.equal(r.app.snapshot().state.world.weather.paused, true);
      assert.equal(r.app.snapshot().state.memories.length, 3);
      await r.ids['skip-reveal'].emit('click');
      assert.deepEqual(r.app.snapshot().visible, turns[index].result.frames[0]);
      assert.equal(r.app.snapshot().visible.world.weather.paused, true);
      assert.equal(r.ids['memory-count'].textContent, '02');
      assert(!r.ids['memory-list'].textContent.includes('一起调整了世界里的天气'));
      await r.timers.advance(360);
      await r.ids['skip-reveal'].emit('click');
      assert.deepEqual(r.app.snapshot().visible, turns[index].result.frames[1]);
      assert.equal(r.ids['memory-count'].textContent, '03');
      assert(r.ids['memory-list'].textContent.includes('一起调整了世界里的天气'));
    }
    await r.timers.flush();
    if (record.afterPanelObservation) {
      assert.deepEqual(r.app.snapshot().state, turns[index].accepted, 'logs must actually be visited to complete read');
      assert.equal(r.app.snapshot().state.facts.records_seen, undefined);
      r.app.selectPanel('logs');
      await r.timers.flush();
      assert.equal(r.app.snapshot().activePanel, 'logs');
      assert.equal(r.ids['panel-logs'].hidden, false);
      assert.deepEqual(r.app.snapshot().state.events.at(-1), { id: 'event_4', ...record.afterPanelObservation });
    }
    const snapshot = r.app.snapshot();
    assert.equal(snapshot.busy, false);
    assert.equal(snapshot.revealing, false);
    assert.deepEqual(snapshot.state, turns[index].state, `actual rain app state ${index + 1}`);
    assert.deepEqual(snapshot.visible, R.view(snapshot.state));
    const restored = R.restore(r.store.get(snapshot.storageKey), P.get(rainFixture.pack));
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.state, snapshot.state);
  }
  assert.equal(wire.bodies.length, 8);
});

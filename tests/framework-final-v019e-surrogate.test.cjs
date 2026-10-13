'use strict';
/* Historical final v0.1.9 attribution-prompt captures: first independent
 * substitute responses, generation-time request hashes and responder receipts
 * are frozen. Current visitor-reference and relative-placement clarifications
 * postdate these captures, so these are compatibility replays, not evidence of
 * generation against today's prompt. Transport is mocked and the real app runs
 * in a DOM harness; these tests are not browser or GLM/provider evidence. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const M = require('../framework/model.js');
const Memory = require('../framework/memory-policy.js');
const { setup } = require('./helpers/framework-ui-harness.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture(name, digest, count, pack) {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', name));
  return { bytes, digest, count, pack, source: JSON.parse(bytes) };
}
const lantern = fixture('framework-final-v019e-lantern-surrogate.json', 'd316a9b745e5178195df33a8667ec5f58304f0b66314191aa4a65bae322988e0', 8, 'lantern-lab');
const rain = fixture('framework-final-v019e-rain-surrogate.json', '2ae2e29558adc65f62aacb97c6517a1dc0e567985ff99f2125eaf8a99f50a674', 4, 'rain-lab');
// Hashes of the collectors' original final-state.json files, without rewriting
// those captures or deriving expected state from this test's execution.
const canonicalDigests = {
  'lantern-lab': '9c8a5ebca240ecea482dab3b2dc6900131848e3c3839d870ee866ae95b3e1ab2',
  'rain-lab': '50d9b216e69bbaa5d52afdaa4f7c33d692b92ed2e2985f917a2a4427560f584e'
};
const dimensions = object => ({
  width: Math.max(...object.glyphs.split('\n').map(row => row.length)) * object.scale,
  height: object.glyphs.split('\n').length * object.scale
});
const operations = record => JSON.parse(record.raw).lines.flatMap(line => line.operations);

function assertHistoricalCapture(record, request) {
  assert.equal(record.requestUnchanged, true);
  assert(!Number.isNaN(Date.parse(record.capturedAt)));
  assert.equal(sha(record.raw), record.sha256, 'first raw response remains byte-identical');
  // Pinned whole-fixture hashes below preserve the generation-time hashes;
  // never rewrite those captures to make an old response appear current.
  assert.match(record.requestSha256, /^[a-f0-9]{64}$/, 'historical generation-time request body hash');
  assert.match(record.requestFileSha256, /^[a-f0-9]{64}$/, 'historical generation-time request file hash');
  assert.notEqual(sha(JSON.stringify(request)), record.requestSha256, 'current replay request is not a generation-time attestation');
  assert.deepEqual(record.responderReceipt, {
    requestFileSha256: record.requestFileSha256,
    responseSha256: record.sha256
  }, 'the independent receipt binds the exact request file to the first raw response');
}

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
        a.y < b.y + y.height && a.y + x.height > b.y, false, 'objects do not overlap');
    }
  }
}

function assertSources(state) {
  for (const memory of state.memories) {
    assert.equal(memory.perspective, 'player_report');
    const original = state.events.find(event => event.id === memory.source.eventId);
    const current = state.events.find(event => event.id === memory.support.eventId);
    assert(original && current);
    assert.equal(memory.source.text, original.input);
    assert.equal(memory.currentRevision.text, current.input);
    assert.equal(memory.support.channel, 'player');
    assert.equal(current.input.slice(memory.support.start, memory.support.end), memory.support.quote);
    assert.equal(memory.body, memory.support.quote, 'report body is the exact player span');
    assert.deepEqual(memory.currentRevision.span, { start: memory.support.start, end: memory.support.end });
  }
  for (const object of state.world.objects) {
    assert.equal(object.source.createdBy, state.events.find(event => event.id === object.source.createdEventId).input);
    assert.equal(object.source.lastChangedBy, state.events.find(event => event.id === object.source.eventId).input);
  }
  const weather = state.world.weather.source;
  if (weather) assert.equal(weather.text, state.events.find(event => event.id === weather.eventId).input);
}

function transport(records) {
  const bodies = [];
  const model = M.create({ fetch: async (_url, options) => {
    const record = records[bodies.length];
    assert(record, 'no additional model request');
    bodies.push(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: record.raw }, finish_reason: 'stop' }] }), { status: 200 });
  } });
  return { model, bodies };
}

const routes = new Map();
function replay(collection) {
  if (routes.has(collection)) return routes.get(collection);
  const pending = (async () => {
    const { source } = collection, pack = P.get(source.pack), wire = transport(source.records), turns = [];
    let state = R.create(pack);
    wire.model.connect('DUMMY_FINAL_SURROGATE_ONLY');
    try {
      for (const [index, record] of source.records.entries()) {
        const before = state, context = R.context(before), request = M.buildRequest(context, record.input);
        assertHistoricalCapture(record, request);
        const canonical = await wire.model.request({ context, input: record.input });
        assert.equal(wire.bodies[index], JSON.stringify(request));
        assert.equal(canonical.schema, 'her-world-turn-v2');
        const result = R.commitModel(before, R.propose(before, { text: record.input }), canonical);
        assert.equal(result.ok, true, `${source.pack} turn ${index + 1}: ${JSON.stringify(result.error)}`);
        const accepted = result.state, event = accepted.events.at(-1);
        assert.equal(event.type, 'turn');
        assert.equal(event.input, record.input);
        assert.equal(event.plan.schema, 'her-world-turn-v2');
        assert.equal(event.completionVersion, source.pack === 'lantern-lab' ? 2 : undefined,
          'only the pack opting into existing-object completion writes completion version 2');
        assert.deepEqual(result.lines, JSON.parse(record.raw).lines.map(line => line.text));
        assert.equal(result.frames.length, result.lines.length);
        const saved = R.restore(JSON.stringify(R.serialize(accepted)), pack);
        assert.equal(saved.ok, true);
        assert.deepEqual(saved.state, accepted, `canonical turn ${index + 1} replay`);
        for (const [line, frame] of result.frames.entries()) {
          assertGeometry(frame.world);
          assert.deepEqual(R.view(saved.state, { event: accepted.events.length - 1, line }), frame,
            `saved sentence ${index + 1}.${line + 1} replay`);
        }
        assertSources(accepted);
        state = record.afterPanelObservation ? R.observe(accepted, record.afterPanelObservation) : accepted;
        const observed = R.restore(JSON.stringify(R.serialize(state)), pack);
        assert.equal(observed.ok, true);
        assert.deepEqual(observed.state, state, 'panel event survives canonical replay');
        turns.push({ before, request, canonical, result, accepted, state });
      }
      assert.equal(wire.bodies.length, source.records.length);
      return turns;
    } finally { wire.model.disconnect(); }
  })();
  routes.set(collection, pending);
  return pending;
}

for (const collection of [lantern, rain]) {
  test(`${collection.count} historical final v019e ${collection.pack} captures preserve receipts and replay every saved sentence`, async () => {
    assert.equal(sha(collection.bytes), collection.digest, 'immutable complete fixture file');
    assert.equal(collection.source.records.length, collection.count);
    assert.equal(collection.source.pack, collection.pack);
    assert.equal(collection.source.rulesVersion, '4');
    assert.equal(collection.source.modelProtocol, 'her-world-turn-v4');
    assert.equal(collection.source.release, 'framework-v0.1.9-final-attribution-candidate');
    assert.match(collection.source.kind, /independent OpenAI model substitute/);
    const turns = await replay(collection);
    assert.equal(turns.length, collection.count);
    assert.equal(sha(JSON.stringify(R.serialize(turns.at(-1).state), null, 2)), canonicalDigests[collection.pack],
      'final canonical event history equals the original generation-time saved file');
  });
}

test('historical final independent responses retain action, true preference, compound and hypothetical-negative distinctions', async () => {
  const turns = await replay(lantern), at = index => turns[index].state;
  assert.deepEqual(at(0).memories, [], 'a current request does not become a permanent preference');
  assert.deepEqual(operations(lantern.source.records[0]).map(op => op.type), ['weather.set']);
  assert.equal(at(0).world.weather.intensity, 1);
  assert.equal(at(0).world.weather.paused, false);
  assert.deepEqual(at(1).world, at(0).world, 'preference alone changes no weather or scene');
  assert.equal(at(1).memories.length, 1);
  assert.equal(at(1).memories[0].body, '我喜欢雨落在叶子上的声音，这对我很重要。');
  assert.equal(at(1).memories[0].kind, 'preference');
  assert.deepEqual(at(1).story.completed, [], 'undecided purpose remains unanswered');
  assert.deepEqual(turns[1].result.frames.map(frame => frame.memories.length), [1, 1]);

  assert.equal(at(2).memories.length, 2);
  assert.equal(at(2).memories[1].body, '我喜欢稍密一点的雨');
  assert.equal(at(2).memories[1].kind, 'preference');
  assert.deepEqual(at(2).memories[0], at(1).memories[0]);
  assert.deepEqual(turns[2].result.frames.map(frame => frame.world.weather.intensity), [2, 2]);
  assert.deepEqual(turns[2].result.frames.map(frame => frame.memories.length), [1, 2], 'weather and preference appear with their own sentences');

  const hypothetical = JSON.parse(lantern.source.records[3].raw);
  assert.deepEqual(hypothetical.requestedChanges, []);
  assert(hypothetical.lines.every(line => line.mode === 'discussion'));
  assert(operations(lantern.source.records[3]).every(op => op.type === 'memory.upsert'));
  assert.deepEqual(at(3).world, at(2).world, 'hypothetical and explicit no-change language leave weather untouched');
  assert.deepEqual(at(3).memories.slice(0, 2), at(2).memories);
  assert.equal(at(3).memories[2].title, '不喜欢暴雨');
  assert.equal(at(3).memories[2].body, '我其实不喜欢暴雨');
  assert.equal(at(3).memories[2].kind, 'preference');
  assert.deepEqual(turns[3].result.frames.map(frame => frame.memories.length), [2, 3]);
  assert(!at(3).memories.some(memory => memory.body === '我喜欢暴雨' || memory.body.includes('如果我说')));
});

test('historical final creation still precedes purpose without duplicate objects or early inspection credit', async () => {
  const turns = await replay(lantern), made = turns[4], answered = turns[5];
  assert.deepEqual(made.result.frames.map(frame => frame.world.objects.length), [1, 2]);
  assert.deepEqual(made.state.story.completed, []);
  assert.equal(R.view(made.state).activeQuestionId, 'q_purpose');
  const [bench, lamp] = made.state.world.objects;
  assert.equal(bench.label, '双人长椅');
  assert.equal(lamp.label, '小灯');
  assert.equal(lamp.x - bench.x - dimensions(bench).width, 4);
  assert.equal(lamp.y + dimensions(lamp).height, bench.y + dimensions(bench).height);
  assert.equal(operations(lantern.source.records[4])[1].placement.align, 'bottom');
  assert(operations(lantern.source.records[5]).every(op => op.type !== 'world.create'));
  assert.deepEqual(answered.accepted.world.objects, made.state.world.objects);
  assert.equal(answered.accepted.world.nextId, made.state.world.nextId);
  assert.deepEqual(answered.result.frames.map(frame => frame.story.completed), [['purpose', 'make'], ['purpose', 'make']]);
  assert.deepEqual(answered.accepted.story.completed, ['purpose', 'make']);
  assert.equal(answered.accepted.facts.world_seen, undefined);
  assert.equal(R.view(answered.accepted).activeQuestionId, 'q_inspect');
  const proof = answered.accepted.recall.records[answered.accepted.recall.bindings[Memory.recordIds.fact('object_made')]];
  assert.deepEqual([...new Set(proof.ownSources.map(ref => ref.eventId))], ['event_5', 'event_6'], 'completion keeps both original creation and prerequisite evidence');
  assert.deepEqual(answered.state.events.at(-1), { id: 'event_7', ...lantern.source.records[5].afterPanelObservation, completionVersion: 2 });
  assert.deepEqual(answered.state.story.completed, ['purpose', 'make', 'inspect']);
  assert.deepEqual(turns[6].state.story.completed, ['purpose', 'make', 'inspect', 'route']);
  assert.equal(turns[6].state.story.answers.q_route.value, 'stay');
  assert.deepEqual(turns[7].state.story.completed, ['purpose', 'make', 'inspect', 'route', 'stay']);
  assert.deepEqual(turns[7].state.world.objects, made.state.world.objects);
});

test('historical final rain captures retain weather boundaries, logs discovery, declined reference and unequal-height alignment', async () => {
  const turns = await replay(rain), at = index => turns[index].state;
  assert.deepEqual(turns[0].result.frames.map(frame => frame.memories.length), [1, 1]);
  assert.deepEqual(turns[0].result.frames.map(frame => frame.world.weather.intensity), [0, 1]);
  assert.deepEqual(turns[0].result.frames.map(frame => frame.world.weather.paused), [true, false]);
  assert.equal(at(0).memories[0].kind, 'concept');
  assert.equal(at(0).memories[0].body, '雨像天空把攒着的水一点点放下来，碰到叶面就像有人轻敲。');
  assert.deepEqual(at(0).story.completed, ['describe']);
  assert.equal(at(1).world.weather.name, '叶间信');
  assert.deepEqual(turns[1].accepted.story.completed, ['describe', 'name']);
  assert.equal(turns[1].accepted.facts.records_seen, undefined);
  assert.deepEqual(at(1).events.at(-1), { id: 'event_3', ...rain.source.records[1].afterPanelObservation });
  assert.deepEqual(at(1).story.completed, ['describe', 'name', 'read']);
  assert.equal(at(2).story.answers.q_visitor.value, 'decline');
  assert.deepEqual(at(2).memories, at(1).memories);
  assert.deepEqual(at(2).world, at(1).world);
  assert.deepEqual(at(2).story.completed, ['describe', 'name', 'read', 'visitor']);
  assert.deepEqual(turns[3].result.frames.map(frame => frame.world.objects.length), [0, 1, 2]);
  assert.deepEqual(at(3).world.weather, at(2).world.weather);
  assert.deepEqual(at(3).memories, at(2).memories);
  const [chair, lamp] = at(3).world.objects;
  assert.notEqual(dimensions(chair).height, dimensions(lamp).height);
  assert.equal(lamp.y + dimensions(lamp).height, chair.y + dimensions(chair).height);
  assert.equal(lamp.x - chair.x - dimensions(chair).width, 2);
  assert.equal(operations(rain.source.records[3])[1].placement.align, 'bottom');
});

test('the two historical final independent routes still complete all nine selected-branch nodes', async () => {
  const lanternTurns = await replay(lantern), rainTurns = await replay(rain);
  const completed = [
    ...lanternTurns.at(-1).state.story.completed.map(id => `lantern-lab:${id}`),
    ...rainTurns.at(-1).state.story.completed.map(id => `rain-lab:${id}`)
  ];
  assert.deepEqual(completed, [
    'lantern-lab:purpose', 'lantern-lab:make', 'lantern-lab:inspect', 'lantern-lab:route', 'lantern-lab:stay',
    'rain-lab:describe', 'rain-lab:name', 'rain-lab:read', 'rain-lab:visitor'
  ]);
  assert.equal(new Set(completed).size, 9);
});

function assertRendered(r, frame) {
  assert.equal(r.ids['object-count'].textContent, String(frame.world.objects.length).padStart(2, '0'));
  assert.equal(r.ids['memory-count'].textContent, String(frame.memories.length).padStart(2, '0'));
  const kinds = { concept: '学到的概念', preference: '偏好', experience: '共同经历', promise: '约定', note: '记下的片段' };
  const cards = r.ids['memory-list'].children.filter(row => row.children[0]?.tagName === 'H3');
  assert.equal(cards.length, frame.memories.length, 'unrevealed memories have no card');
  for (const [index, memory] of frame.memories.entries()) {
    const row = cards[index];
    assert.equal(row.children[0].textContent, '她记作：' + memory.title);
    assert.equal(row.children[1].textContent, '你的原话：' + memory.body);
    assert.equal(row.children[2].textContent, '来源：' + memory.source.text);
    assert(row.children[3].textContent.startsWith('她的归类：' + kinds[memory.kind]));
  }
}

for (const collection of [lantern, rain]) {
  test(`the actual app replays historical final ${collection.pack} responses through current requests, attribution cards and sentence boundaries`, async t => {
    const turns = await replay(collection), wire = transport(collection.source.records);
    const r = setup({ model: wire.model, reduced: false, search: '?pack=' + collection.pack });
    t.after(() => r.app.destroy());
    await r.online();
    for (const [index, record] of collection.source.records.entries()) {
      const turn = turns[index];
      await r.say(record.input);
      assert.equal(wire.bodies.length, index + 1);
      assert.equal(wire.bodies[index], JSON.stringify(turn.request));
      assert.equal(r.app.snapshot().lastFailure, null);
      assert.deepEqual(r.app.snapshot().state, turn.accepted, 'whole accepted turn is saved before paced reveal');
      assert.deepEqual(r.app.snapshot().visible, R.view(turn.before), 'no sentence effect appears before its words finish');
      assertRendered(r, R.view(turn.before));
      // Keep the required world/logs panel unseen until an explicit real tab
      // click below. Navigation also prevents automatic panel suggestions.
      await r.ids['tab-focus'].emit('click');
      for (const [line, frame] of turn.result.frames.entries()) {
        if (line) {
          await r.timers.advance(360);
          assert.deepEqual(r.app.snapshot().visible, turn.result.frames[line - 1], 'starting the next sentence adds no effect');
        }
        await r.ids['skip-reveal'].emit('click');
        assert.deepEqual(r.app.snapshot().visible, frame, `actual sentence ${index + 1}.${line + 1}`);
        assertRendered(r, frame);
        assert.equal(r.app.snapshot().currentBeat.phase, 'accepted');
      }
      await r.timers.flush();
      assert.deepEqual(r.app.snapshot().state, turn.accepted, 'no UI completion without its panel being viewed');
      if (record.afterPanelObservation) {
        const observation = record.afterPanelObservation;
        const fact = collection === lantern ? 'world_seen' : 'records_seen';
        assert.equal(r.app.snapshot().state.facts[fact], undefined);
        assert.equal(r.ids['panel-' + observation.panel].hidden, true);
        await r.ids['tab-' + observation.panel].emit('click');
        await r.timers.flush();
        assert.equal(r.app.snapshot().activePanel, observation.panel);
        assert.equal(r.ids['panel-' + observation.panel].hidden, false);
        assert.deepEqual(r.app.snapshot().state.events.at(-1), {
          id: turn.state.events.at(-1).id, ...observation, ...(collection === lantern ? { completionVersion: 2 } : {})
        });
        assert.equal(r.app.snapshot().state.facts[fact], true);
        assert.equal(wire.bodies.length, index + 1, 'actual panel observation makes no model call');
      }
      const snapshot = r.app.snapshot();
      assert.equal(snapshot.lastFailure, null);
      assert.equal(snapshot.busy, false);
      assert.equal(snapshot.revealing, false);
      assert.deepEqual(snapshot.state, turn.state, `actual app turn ${index + 1}`);
      assert.deepEqual(snapshot.visible, R.view(turn.state));
      assertRendered(r, snapshot.visible);
      const saved = R.restore(r.store.get(snapshot.storageKey), P.get(collection.pack));
      assert.equal(saved.ok, true);
      assert.deepEqual(saved.state, turn.state, 'app-persisted canonical state replays exactly');
    }
    assert.equal(wire.bodies.length, collection.count);
  });
}

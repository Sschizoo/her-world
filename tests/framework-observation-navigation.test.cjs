/* Ordinary synthetic gameplay only: no browser, provider, credentials or network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, runtime, packs, plan } = require('./helpers/framework-ui-harness.cjs');
const syntheticLocks = require('./helpers/synthetic-locks.cjs');
const RAIN_KEY = 'her-world.framework.v4:rain-lab:1.0.0';
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function responder(request = async () => plan(['慢慢看。'])) {
  return { containsCredential: () => false, redactCredential: value => value, onCredentialBoundary: () => () => {}, connect: () => true, disconnect() {}, connected: () => true, request };
}
async function seedRain(named = true) {
  const r = setup({ model: responder() });
  await r.offline(); await r.say('/回答 雨是水滴');
  if (named) await r.say('/回答 夜航');
  return new Map(r.store);
}
async function selectResponder(r) { await r.ids['connect-form'].emit('submit'); }
async function switchPack(r, id) { r.ids['pack-select'].value = id; await r.ids['pack-select'].emit('change'); }
async function visitLogs(r) { await r.ids['tab-logs'].emit('click'); await r.ids['tab-memory'].emit('click'); }
function sendInput(r,input) { r.ids['free-input'].value = input; return r.app.submit(); }
function savedRain(r) { const restored = runtime.restore(r.store.get(RAIN_KEY), packs.get('rain-lab')); assert(restored.ok); return restored.state; }

for (const held of [false, true]) for (const action of ['pack return', 'bfcache return']) {
  test(`actual pending-request visit survives ${action} with ${held ? 'delayed' : 'immediate'} locks`, async () => {
    const store = await seedRain(), locks = syntheticLocks(); let finish;
    const r = setup({ store, navigator: { locks }, model: responder(() => new Promise(resolve => { finish = resolve; })) });
    await selectResponder(r); if (held) locks.hold();
    const sending = sendInput(r,'今天看看风景'); await visitLogs(r);
    if (action === 'pack return') await switchPack(r, 'lantern-lab');
    else await r.event('pagehide', { persisted: true });
    finish(plan(['迟到的句子。'])); assert.equal(await sending, false);
    if (action === 'pack return') await switchPack(r, 'rain-lab');
    else await r.event('pageshow', { persisted: true });
    if (held) { assert.equal(r.app.snapshot().state.facts.records_seen, undefined); locks.release(); }
    await tick();
    assert.equal(r.app.snapshot().state.facts.records_seen, true);
    assert.equal(savedRain(r).facts.records_seen, true);
    assert.deepEqual(savedRain(r).events.at(-1).questionIds, ['q_read']);
    assert.equal(savedRain(r).events.filter(event => event.type === 'turn').length, 2);
    assert.equal(r.ids['free-input'].value, '今天看看风景');
    assert(!r.ids.transcript.textContent.includes('迟到的句子'));
  });
}

for (const action of ['pack return', 'bfcache return']) {
  test(`a shown paced sentence retains its panel discovery through ${action}`, async () => {
    const locks = syntheticLocks(), r = setup({ store: await seedRain(), reduced: false, navigator: { locks }, model: responder(async () => plan(['请看日志。', '再看记忆。'], [
      { afterLine: 0, operations: [{ type: 'panel.open', panel: 'logs' }] },
      { afterLine: 1, operations: [{ type: 'panel.open', panel: 'memory' }] }
    ])) });
    await selectResponder(r); assert.equal(await r.app.submit('继续说'), true);
    await r.ids['skip-reveal'].emit('click'); assert.equal(r.app.snapshot().activePanel, 'logs');
    if (action === 'pack return') { await switchPack(r, 'lantern-lab'); await switchPack(r, 'rain-lab'); }
    else { await r.event('pagehide', { persisted: true }); await r.event('pageshow', { persisted: true }); }
    await tick();
    assert.equal(savedRain(r).facts.records_seen, true);
    assert.equal(savedRain(r).events.filter(event => event.type === 'turn').length, 3);
  });
}

test('a waiting observation survives repeated immediate departures without accepting stale lock callbacks', async () => {
  const grants = [], locks = { request(name, options, callback) { return new Promise(resolve => { grants.push(() => resolve(callback({ name, mode: options.mode }))); }); } };
  const r = setup({ store: await seedRain(), navigator: { locks }, model: responder() });
  const original = r.store.get(RAIN_KEY);
  await visitLogs(r); assert.equal(grants.length, 1);
  await switchPack(r, 'lantern-lab'); await switchPack(r, 'rain-lab');
  assert.equal(grants.length, 2);
  await switchPack(r, 'lantern-lab'); await switchPack(r, 'rain-lab');
  assert.equal(grants.length, 3);
  grants[0](); grants[1](); await tick();
  assert.equal(r.store.get(RAIN_KEY), original);
  assert.equal(r.app.snapshot().state.facts.records_seen, undefined);
  assert.equal(r.app.snapshot().saving, true);
  grants[2](); await tick();
  assert.equal(savedRain(r).facts.records_seen, true);
  assert.equal(savedRain(r).events.filter(event => event.type === 'panel.viewed').length, 1);
});

test('cancel of a pending ordinary reply still saves exactly the previously viewed question', async () => {
  const locks = syntheticLocks(); let finish;
  const r = setup({ store: await seedRain(), navigator: { locks }, model: responder(() => new Promise(resolve => { finish = resolve; })) });
  await selectResponder(r); const sending = sendInput(r,'稍后再说'); await visitLogs(r);
  await r.ids['cancel-pending'].emit('click'); finish(plan(['迟到的回应。']));
  assert.equal(await sending, false); await tick();
  assert.equal(savedRain(r).facts.records_seen, true);
  assert.equal(savedRain(r).events.length, 3);
  assert.equal(r.ids['free-input'].value, '稍后再说');
});

for (const action of ['cancel', 'reset', 'load latest']) {
  test(`${action} cannot revive a canceled observation on later return`, async () => {
    const locks = syntheticLocks(), r = setup({ store: await seedRain(), navigator: { locks }, model: responder() });
    locks.hold(); await visitLogs(r);
    if (action === 'cancel') await r.ids['cancel-pending'].emit('click');
    else if (action === 'load latest') { await r.ids['load-latest-save'].emit('click'); assert(r.ids['load-latest-dialog'].open); await r.ids['confirm-load-latest'].emit('click'); }
    else {
      await r.ids['reset-button'].emit('click');
      const resetting = r.ids['confirm-reset'].emit('click');
      await tick(); locks.release(); await resetting; locks.hold();
    }
    const raw = r.store.get(RAIN_KEY), requests = locks.calls.length;
    await switchPack(r, 'lantern-lab'); await switchPack(r, 'rain-lab');
    await r.event('pageshow', { persisted: true });
    locks.release(); await tick();
    assert.equal(locks.calls.length, requests);
    assert.equal(r.store.get(RAIN_KEY), raw);
    assert.equal(r.app.snapshot().state.facts.records_seen, undefined);
  });
}

test('foreign progress before return discards the old receipt even if exact old bytes later return', async () => {
  const store = await seedRain(), original = store.get(RAIN_KEY), locks = syntheticLocks(); let finish;
  const r = setup({ store, navigator: { locks }, model: responder(() => new Promise(resolve => { finish = resolve; })) });
  await selectResponder(r); const sending = r.app.submit('等待'); await visitLogs(r);
  await switchPack(r, 'lantern-lab');
  const foreign = setup({ store, model: responder() }); await foreign.offline(); await foreign.say('/新建 长椅');
  const winner = store.get(RAIN_KEY);
  await switchPack(r, 'rain-lab'); await tick();
  assert.equal(store.get(RAIN_KEY), winner);
  assert.equal(r.app.snapshot().state.facts.records_seen, undefined);
  assert.equal(r.app.snapshot().state.world.objects.length, 1);
  await switchPack(r, 'lantern-lab'); store.set(RAIN_KEY, original);
  await switchPack(r, 'rain-lab'); await tick();
  assert.equal(store.get(RAIN_KEY), original);
  assert.equal(r.app.snapshot().state.facts.records_seen, undefined);
  finish(plan(['迟到。'])); assert.equal(await sending, false);
});

for (const notify of [false, true]) {
  test(`foreign progress after replay is queued wins ${notify ? 'with' : 'without'} a storage event`, async () => {
    const store = await seedRain(), locks = syntheticLocks(), r = setup({ store, navigator: { locks }, model: responder() });
    locks.hold(); await visitLogs(r); await switchPack(r, 'lantern-lab'); await switchPack(r, 'rain-lab');
    const foreign = setup({ store, model: responder() }); await foreign.offline(); await foreign.say('/新建 长椅');
    const winner = store.get(RAIN_KEY);
    if (notify) await r.event('storage', { key: RAIN_KEY });
    locks.release(); await tick();
    assert.equal(store.get(RAIN_KEY), winner);
    assert.equal(savedRain(r).facts.records_seen, undefined);
    assert.equal(savedRain(r).world.objects.length, 1);
    assert.equal(r.app.snapshot().saveConflict, true);
  });
}

test('the saved receipt never completes a newly unlocked question on the same panel', async () => {
  const rain = packs.get('rain-lab');
  rain.nodes.push({ id: 'read_again', topic: 'records', requires: { records_seen: true }, question: { id: 'q_read_again', text: '再看下一条记录。', kind: 'open' }, completion: { type: 'ui', panel: 'logs' }, sets: { records_seen_again: true } });
  const customPacks = { list: () => [rain, packs.get('lantern-lab')], get: id => id === rain.id ? rain : packs.get(id) };
  const seed = setup({ packs: customPacks, model: responder() }); await seed.offline(); await seed.say('/回答 雨是水滴'); await seed.say('/回答 夜航');
  const locks = syntheticLocks(), r = setup({ packs: customPacks, store: seed.store, navigator: { locks }, model: responder() });
  locks.hold(); await visitLogs(r); await switchPack(r, 'lantern-lab'); await switchPack(r, 'rain-lab'); locks.release(); await tick();
  assert.equal(r.app.snapshot().state.facts.records_seen, true);
  assert.equal(r.app.snapshot().state.facts.records_seen_again, undefined);
  assert.deepEqual(r.app.snapshot().state.events.at(-1).questionIds, ['q_read']);
});

test('two packs retain independent receipts even with the same question ID and panel', async () => {
  const both = packs.list().map(pack => ({ ...pack, nodes: [{ id: 'inspect', topic: pack.topics[0].id, requires: {}, question: { id: 'q_seen', text: '看看日志。', kind: 'open' }, completion: { type: 'ui', panel: 'logs' }, sets: { [pack.id === 'rain-lab' ? 'rain_seen' : 'lantern_seen']: true } }] }));
  const customPacks = { list: () => both, get: id => both.find(pack => pack.id === id) };
  const locks = syntheticLocks(), r = setup({ packs: customPacks, navigator: { locks }, model: responder() });
  locks.hold(); await visitLogs(r); await switchPack(r, 'lantern-lab'); await visitLogs(r);
  await switchPack(r, 'rain-lab'); locks.release(); await tick();
  assert.equal(r.app.snapshot().state.facts.rain_seen, true);
  assert.equal(r.app.snapshot().state.facts.lantern_seen, undefined);
  await switchPack(r, 'lantern-lab'); await tick();
  assert.equal(r.app.snapshot().state.facts.lantern_seen, true);
  assert.equal(r.app.snapshot().state.facts.rain_seen, undefined);
  for (const pack of both) {
    const saved = runtime.restore(r.store.get('her-world.framework.v4:' + pack.id + ':1.0.0'), pack);
    assert(saved.ok); assert.equal(saved.state.events.length, 1); assert.deepEqual(saved.state.events[0].questionIds, ['q_seen']);
  }
});

for (const shown of [false, true]) {
  test(`background lifecycle ${shown ? 'preserves a previously displayed panel' : 'does not credit an unseen panel'}`, async () => {
    const locks = syntheticLocks(), r = setup({ store: await seedRain(), reduced: false, navigator: { locks }, model: responder(async () => plan(['请看日志。', '再看记忆。'], [
      { afterLine: 0, operations: [{ type: 'panel.open', panel: 'logs' }] },
      { afterLine: 1, operations: [{ type: 'panel.open', panel: 'memory' }] }
    ])) });
    await selectResponder(r); await r.app.submit('继续说');
    if (shown) await r.ids['skip-reveal'].emit('click');
    r.document.visibilityState = 'hidden'; await r.event('visibilitychange');
    await r.event('pagehide', { persisted: true }); await r.event('pageshow', { persisted: true }); await tick();
    r.document.visibilityState = 'visible'; await r.event('visibilitychange'); await tick();
    assert.equal(savedRain(r).facts.records_seen, shown ? true : undefined);
    assert.equal(r.app.snapshot().activePanel, 'memory');
  });
}

test('an earlier panel visit cannot claim a question unlocked by an unshown later sentence after navigation', async () => {
  const locks = syntheticLocks(), r = setup({ store: await seedRain(false), reduced: false, navigator: { locks }, model: responder(async () => plan(['先听你说。', '名字已记下。'], [
    { afterLine: 1, operations: [{ type: 'story.answer', questionId: 'q_name', value: '夜航' }, { type: 'panel.open', panel: 'memory' }] }
  ], 'naming')) });
  await selectResponder(r); await r.app.submit('叫它夜航'); await visitLogs(r);
  await switchPack(r, 'lantern-lab'); await switchPack(r, 'rain-lab'); await tick();
  assert.equal(savedRain(r).facts.rain_named, true);
  assert.equal(savedRain(r).facts.records_seen, undefined);
});

test('a hard close never claims that an unfinished locked observation has been saved', async () => {
  const locks = syntheticLocks(), r = setup({ store: await seedRain(), navigator: { locks }, model: responder() });
  const original = r.store.get(RAIN_KEY); locks.hold(); await visitLogs(r);
  await r.event('pagehide', { persisted: false }); r.app.destroy(); locks.release(); await tick();
  assert.equal(r.store.get(RAIN_KEY), original);
  const fresh = setup({ store: r.store, model: responder() });
  assert.equal(fresh.app.snapshot().state.facts.records_seen, undefined);
});

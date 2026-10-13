'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const R = require('../framework/runtime.js');
const P = require('../framework/packs.js');
const C = require('../framework/capabilities.js');
const policy = require('../framework/memory-policy.js');
const { setup } = require('./helpers/framework-ui-harness.cjs');
const source = fs.readFileSync(path.join(__dirname, '../framework/model.js'), 'utf8');
const KEY = 'INERT_PROXY_DIAGNOSTIC_SENTINEL';
const pairs = { AUTH_REQUIRED: 401, ORIGIN_DENIED: 403, REQUEST_TOO_LARGE: 413, DAILY_LIMIT: 429, RATE_LIMIT: 429, BUSY: 429, UPSTREAM_QUOTA_OR_RATE_LIMIT: 429, UPSTREAM_REJECTED: 502, UPSTREAM_FORMAT: 502, UPSTREAM_TOO_LARGE: 502, UPSTREAM_UNAVAILABLE: 502, BUDGET_UNAVAILABLE: 503, SERVICE_UNAVAILABLE: 503, UPSTREAM_TIMEOUT: 504 };
function harness(fetch, fakeTimers = false) {
  let serial = 0, calls = 0;
  const tasks = new Map();
  const timers = fakeTimers ? {
    setTimeout(fn, delay) { const id = ++serial; tasks.set(id, { fn, delay }); return id; },
    clearTimeout(id) { tasks.delete(id); }
  } : { setTimeout, clearTimeout };
  const window = { HerCapabilities: C, HerMemoryPolicy: policy, addEventListener() {} };
  vm.runInNewContext(source, { window, AbortController, TextEncoder, TextDecoder, ...timers });
  const api = window.HerFrameworkModel.create({ fetch: async (...args) => { calls++; return fetch(...args); } });
  assert(api.connect(KEY));
  return { api, factory: window.HerFrameworkModel, calls: () => calls, tasks, fire(delay) { const entry = [...tasks].find(([, value]) => value.delay === delay); assert(entry, 'timer must be scheduled'); tasks.delete(entry[0]); entry[1].fn(); } };
}
const args = () => ({ context: R.context(R.create(P.get('rain-lab'))), input: '先聊一会儿。' });
const response = (value, status = 502, headers) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers });
const plain = value => JSON.parse(JSON.stringify(value));
const category = status => [401, 403].includes(status) ? 'auth' : status === 429 ? 'quota' : 'upstream';
async function failure(h, input = args()) { try { await h.api.request(input); assert.fail('must reject'); } catch (error) { assert(!JSON.stringify(error).includes(KEY)); assert(!error.message.includes('PRIVATE_RAW')); return error; } }
async function started(h) { const pending = failure(h); for (let i = 0; i < 16 && ![...h.tasks.values()].some(item => item.delay === 200); i++) await Promise.resolve(); assert([...h.tasks.values()].some(item => item.delay === 200)); return { pending }; }

test('known proxy error envelopes retain HTTP status and only fixed matching classifications', async () => {
  for (const [code, status] of Object.entries(pairs)) {
    const h = harness(async () => response({ error: { code } }, status));
    const error = await failure(h);
    assert.equal(error.code, category(status)); assert.equal(error.httpStatus, status);
    assert.deepEqual(plain(error.diagnostic), { stage: 'HTTP', code: 'PROXY_' + code, path: 'response' });
    assert.equal(h.calls(), 1); assert.equal(h.api.calls(), 1);
  }
});

test('unknown, extra, conflicting, malformed and secret-bearing error data never becomes a diagnostic', async () => {
  const bodies = [
    { error: { code: KEY } }, { error: { code: 'UPSTREAM_FORMAT', message: KEY } },
    { error: { code: 'UPSTREAM_FORMAT' }, debug: KEY }, { error: { code: 'AUTH_REQUIRED' } },
    { error: { code: ['UPSTREAM_FORMAT'] } }, { error: { code: null } },
    '{"error":{"code":"PRIVATE_RAW","code":"UPSTREAM_FORMAT"}}',
    '{"error":{"code":"UPSTREAM_FORMAT"},"error":{"code":"UPSTREAM_FORMAT"}}',
    '<html>PRIVATE_RAW</html>', '{"error":', '[{"error":{"code":"UPSTREAM_FORMAT"}}]',
    { constructor: { code: 'UPSTREAM_FORMAT' } }, ' '.repeat(513) + '{"error":{"code":"UPSTREAM_FORMAT"}}'
  ];
  for (const body of bodies) {
    const h = harness(async () => response(body)); const error = await failure(h);
    assert.equal(error.code, 'upstream'); assert.equal(error.httpStatus, 502);
    assert.deepEqual(plain(error.diagnostic), { stage: 'HTTP', path: 'response' });
    assert.equal(h.calls(), 1);
  }
});

test('error-body size and broken optional readers cannot hide known HTTP failures', async () => {
  let cancelled = 0, read = 0;
  const tooLarge = { ok: false, status: 401, headers: { get: () => '513' }, body: { getReader() { read++; throw Error(KEY); }, cancel() { cancelled++; throw Error(KEY); } } };
  const a = await failure(harness(async () => tooLarge)); assert.equal(a.code, 'auth'); assert.equal(a.httpStatus, 401); assert.equal(read, 0); assert.equal(cancelled, 1);
  for (const body of [null, { cancel() { throw Error(KEY); } }, { getReader() { throw Error(KEY); } }]) {
    const h = harness(async () => ({ ok: false, status: 401, body, text() { throw Error('must not use unbounded text fallback'); } }));
    const error = await failure(h); assert.equal(error.code, 'auth'); assert.equal(error.httpStatus, 401);
  }
  const getter = await failure(harness(async () => ({ ok: false, status: 401, get body() { throw Error(KEY); } })));
  assert.equal(getter.code, 'auth'); assert.equal(getter.httpStatus, 401);
  const h = harness(async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(513)); }, cancel() { cancelled++; } }), { status: 502 }));
  assert.equal((await failure(h)).httpStatus, 502); assert(cancelled >= 2);
});

test('optional proxy-body wait is bounded and cannot extend or conceal the existing request deadline', async () => {
  let cancelled = 0;
  const stalled = () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 504 });
  const h = harness(async () => stalled(), true), { pending } = await started(h);
  h.fire(200); const error = await pending;
  assert.equal(error.code, 'upstream'); assert.equal(error.httpStatus, 504); assert.equal(error.diagnostic.stage, 'HTTP');
  assert.equal(h.tasks.size, 0); assert.equal(h.calls(), 1); assert.equal(cancelled, 1);
  const deadline = harness(async () => stalled(), true), active = await started(deadline);
  deadline.fire(30000); const known = await active.pending;
  assert.equal(known.code, 'upstream'); assert.equal(known.httpStatus, 504); assert.equal(known.diagnostic.stage, 'HTTP');
  assert.equal(deadline.tasks.size, 0); assert.equal(deadline.calls(), 1);
});

test('explicit cancellation and disconnect still win over optional error diagnostics', async () => {
  for (const disconnect of [false, true]) {
    const h = harness(async () => new Response(new ReadableStream(), { status: 502 }), true);
    const signal = new AbortController(), pending = failure(h, { ...args(), signal: signal.signal });
    for (let i = 0; i < 16 && ![...h.tasks.values()].some(item => item.delay === 200); i++) await Promise.resolve();
    disconnect ? h.api.disconnect() : signal.abort();
    const error = await pending; assert.equal(error.code, 'cancelled'); assert.equal(error.httpStatus, 502);
    assert.equal(error.diagnostic.stage, 'CANCELLED'); assert.equal(h.tasks.size, 0); assert.equal(h.calls(), 1);
  }
});

test('explicit cancellation wins when the global timeout races the optional HTTP body wait', async () => {
  for (const how of ['abort', 'disconnect']) for (const order of ['before', 'after']) {
    const h = harness(async () => new Response(new ReadableStream(), { status: 502 }), true);
    const signal = new AbortController(), pending = failure(h, { ...args(), signal: signal.signal });
    for (let i = 0; i < 16 && ![...h.tasks.values()].some(item => item.delay === 200); i++) await Promise.resolve();
    const cancel = () => how === 'abort' ? signal.abort() : h.api.disconnect();
    if (order === 'before') cancel(); h.fire(30000); if (order === 'after') cancel();
    const error = await pending;
    assert.equal(error.code, 'cancelled', how + '/' + order); assert.equal(error.httpStatus, 502);
    assert.equal(error.diagnostic.stage, 'CANCELLED'); assert.equal(h.tasks.size, 0); assert.equal(h.calls(), 1);
  }
});

test('optional error reading snapshots a stream and cannot enter a changing text fallback', async () => {
  let bodyReads = 0, textReads = 0;
  const goodBody = response({ error: { code: 'UPSTREAM_FORMAT' } }).body;
  const h = harness(async () => ({ ok: false, status: 502, headers: new Headers(), get body() { bodyReads++; return bodyReads === 1 ? goodBody : null; }, async text() { textReads++; return '{"error":{"code":"UPSTREAM_FORMAT"}}'; } }));
  const error = await failure(h);
  assert.equal(error.diagnostic.code, 'PROXY_UPSTREAM_FORMAT'); assert.equal(bodyReads, 1); assert.equal(textReads, 0);
});

test('proxy classification never changes successful model parsing or allows HTTP200 error envelopes', async () => {
  const plan = { schema: 'her-world-turn-v4', requestedChanges: [], lines: [{ text: '慢慢说。', mode: 'discussion', operations: [] }], topic: null };
  const good = harness(async () => response({ choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: 'stop' }] }, 200));
  assert.equal((await good.api.request(args())).schema, 'her-world-turn-v2');
  const bad = await failure(harness(async () => response({ error: { code: 'UPSTREAM_FORMAT' } }, 200)));
  assert.equal(bad.code, 'format'); assert.equal(bad.httpStatus, 200); assert(!bad.diagnostic.code);
});

test('transport and UI constrain proxy diagnostics to matching HTTP status and fixed response path', async () => {
  const h = harness(async () => response({ error: { code: 'UPSTREAM_FORMAT' } }));
  for (const [status, detail, expected] of [
    [502, { stage: 'HTTP', path: 'response', code: 'PROXY_UPSTREAM_FORMAT' }, true],
    [504, { stage: 'HTTP', path: 'response', code: 'PROXY_UPSTREAM_FORMAT' }, false],
    [502, { stage: 'JSON', path: 'content', code: 'PROXY_UPSTREAM_FORMAT' }, false],
    [502, { stage: 'HTTP', path: 'response', code: 'PROXY_' + KEY }, false]
  ]) {
    const safe = new h.factory.SafeError('upstream', status, detail);
    assert.equal(Boolean(safe.diagnostic?.code), expected);
    const ui = setup({ request: async () => { throw { code: 'upstream', httpStatus: status, diagnostic: detail, message: KEY }; } });
    await ui.online(); const before = JSON.stringify(ui.app.snapshot().state); await ui.say('测试错误分类');
    assert.equal(Boolean(ui.app.snapshot().lastFailure.detail), expected);
    assert.equal(ui.app.snapshot().lastFailure.httpStatus, status);
    assert.equal(JSON.stringify(ui.app.snapshot().state), before); assert(!JSON.stringify(ui.app.snapshot()).includes(KEY));
    assert(!ui.ids['request-error-text'].textContent.includes(KEY));
  }
});

test('error sanitizers never execute accessors or coerce object-valued diagnostic fields', async () => {
  const h = harness(async () => response({ error: { code: 'UPSTREAM_FORMAT' } }));
  let reads = 0;
  const codeObject = { toString() { reads++; return 'PROXY_UPSTREAM_FORMAT'; }, toJSON() { return KEY; } };
  const getterDetail = { stage: 'HTTP', path: 'response', get code() { reads++; return reads === 1 ? 'PROXY_UPSTREAM_FORMAT' : KEY; } };
  for (const detail of [getterDetail, { stage: 'HTTP', path: 'response', code: codeObject }]) {
    const safe = new h.factory.SafeError('upstream', 502, detail);
    assert.equal(safe.diagnostic.code, undefined); assert(!JSON.stringify(safe).includes(KEY)); assert.equal(reads, 0);
    const ui = setup({ request: async () => { throw { code: 'upstream', httpStatus: 502, diagnostic: detail }; } });
    await ui.online(); await ui.say('错误资料测试');
    assert.equal(ui.app.snapshot().lastFailure.detail, undefined); assert.equal(reads, 0);
    assert(!JSON.stringify(ui.app.snapshot()).includes(KEY));
  }
  const safe = new h.factory.SafeError(codeObject, 502, { get stage() { reads++; return 'HTTP'; } });
  assert.equal(safe.code, 'upstream'); assert.equal(safe.diagnostic, undefined); assert.equal(reads, 0);
  const ui = setup({ request: async () => { throw { get code() { reads++; return KEY; }, get httpStatus() { reads++; return 502; }, get diagnostic() { reads++; return getterDetail; } }; } });
  await ui.online(); await ui.say('变化的错误属性测试');
  assert.equal(reads, 0); assert.deepEqual(ui.app.snapshot().lastFailure, { code: 'invalid' });
});

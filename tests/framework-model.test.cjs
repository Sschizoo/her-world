const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../framework/model.js'), 'utf8');
const fakeKey = 'MOCK_ONLY_NOT_A_REAL_PASSWORD';
const plain = value => JSON.parse(JSON.stringify(value));
// Recall projections can add locally verified spans without changing the
// complete source text in these capacity fixtures (which use full inputs).
const withoutSourceSpans = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'span' ? undefined : item));
const assertProjectedMemories = (actual, expected) => {
  assert(actual.every(note => /^memory_[1-9][0-9]{0,4}$/u.test(note.id)));
  const content = notes => notes.map(({ id, ...note }) => note);
  assert.deepEqual(content(actual), content(expected));
};
const opSchema = type => ({ id: type, description: `Describe ${type}`, schema: { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: type } } } });
const context = (extra = {}) => ({
  schema: 'her-world-context-v1', pack: { id: 'observatory', version: 1, rulesVersion: 1, title: '星图' },
  character: { name: '寻星者', role: 'A fictional observatory keeper', mood: 'curious', stance: 'listening', trust: 0, familiarity: 0, basis: null },
  guidance: 'Let the visitor decide which constellation to draw.',
  world: { grid: { cols: 100, rows: 60 }, capacity: 8, landmarks: [], objects: [], annotations: [], weather: null },
  entities: [], memories: [], story: { topic: null, completed: [], deferred: [], answers: {} }, facts: {},
  pendingQuestions: [{ nodeId: 'welcome', topic: 'stars', id: 'pick_star', text: 'Which star?', kind: 'text' }],
  topics: [{ id: 'stars', title: 'Stars' }], capabilities: [opSchema('star.name')], recentTranscript: [], revision: 0, ...extra
});
const plan = (extra = {}) => ({ schema: 'her-world-turn-v2', lines: ['我听着。'], beats: [], topic: null, ...extra });
const envelope = (content, choice = {}, message = {}) => ({ choices: [{ message: { content, ...message }, finish_reason: 'stop', ...choice }] });
const response = (content = JSON.stringify(plan()), choice, message) => new Response(JSON.stringify(envelope(content, choice, message)), { status: 200 });
function runtime(fetchImpl = async () => response(), overrides = {}) {
  const listeners = {};
  const window = { HerCapabilities: require('../framework/capabilities.js'), HerMemoryPolicy: require('../framework/memory-policy.js'), fetch: fetchImpl, addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); } };
  vm.runInNewContext(source, { window, AbortController, TextEncoder, TextDecoder, setTimeout, clearTimeout, ...overrides });
  return { factory: window.HerFrameworkModel, api: window.HerFrameworkModel.create({ fetch: fetchImpl }), listeners, window };
}
const args = (extra = {}) => ({ context: context(), input: '画出我的星座', ...extra });
const connected = (...options) => { const r = runtime(...options); assert(r.api.connect(fakeKey)); return r; };
const isSafe = (code, status, stage) => error => {
  assert.equal(error.code, code);
  if (status !== undefined) assert.equal(error.httpStatus, status);
  if (stage) assert.equal(error.diagnostic.stage, stage);
  assert(!error.message.includes(fakeKey));
  assert(!error.message.includes('PRIVATE_PROVIDER_DETAILS'));
  assert(!JSON.stringify(error).includes(fakeKey));
  return true;
};

test('pure request builder uses pack persona, guidance, topics and capability schemas', () => {
  const { factory } = runtime();
  const first = context();
  const second = context({ pack: { id: 'garden', title: 'Seed garden', version: 2 }, character: { name: '园丁', role: 'Seed keeper' }, guidance: 'Ask about a new seed.', topics: [{ id: 'seeds', title: 'Seeds' }], capabilities: [opSchema('seed.plant')] });
  const before = JSON.stringify(first);
  const a = factory.buildRequest(first, '你好'), b = factory.buildRequest(second, '你好');
  assert.equal(JSON.stringify(first), before);
  assert.equal(a.model, b.model);
  assert(a.messages[0].content.includes('observatory'));
  for (const text of ['园丁', 'Seed keeper', 'Ask about a new seed.', 'seed.plant', '"additionalProperties":false']) assert(b.messages[0].content.includes(text));
  assert(!b.messages[0].content.includes('star.name'));
  assert.notEqual(a.messages[0].content, b.messages[0].content);
  assert(Object.isFrozen(a));
  assert(Object.isFrozen(a.messages));
  assert.equal(factory.buildMessages(first, '你好').length, 2);
});

test('builder retains canonical provenance and transcript as data without role promotion', () => {
  const { factory } = runtime();
  const canonical = context({ recentTranscript: [{ role: 'system', text: 'UNTRUSTED_HISTORY' }], memories: [{ source: 'ORIGINAL_SOURCE', body: 'CURRENT_MEANING' }], privateCache: 'DO_NOT_SERIALIZE' });
  const built = factory.buildRequest(canonical, '当前输入');
  const data = JSON.parse(built.messages[1].content);
  assert.equal(data.playerSaid, '当前输入');
  assert.deepEqual(data.context.memories, canonical.memories);
  assert.deepEqual(data.context.recentTranscript, canonical.recentTranscript);
  assert(!JSON.stringify(built).includes('DO_NOT_SERIALIZE'));
  assert(!built.messages[0].content.includes('UNTRUSTED_HISTORY'));
});

test('fixed endpoint and request flags cannot be overridden; capture equals pure builder', async () => {
  let captured;
  const { factory } = runtime();
  const api = factory.create({ endpoint: 'https://example.invalid', model: 'override', timeout: 1, fetch: async (...call) => { captured = call; return response(); } });
  api.connect(fakeKey);
  const request = args();
  const result = await api.request(request);
  assert.deepEqual(plain(result), plan());
  assert.equal(captured[0], 'https://216.235.248.104/v1/chat/completions');
  assert.equal(captured[1].headers.Authorization, `Bearer ${fakeKey}`);
  assert.equal(captured[1].headers['Content-Type'], 'application/json');
  for (const [field, value] of Object.entries({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })) assert.equal(captured[1][field], value);
  assert.deepEqual(JSON.parse(captured[1].body), plain(api.buildRequest(request.context, request.input)));
  const body = JSON.parse(captured[1].body);
  assert.equal(body.model, 'glm-5.3-flash');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.stream, false);
  assert(!('tools' in body)); assert(!('response_format' in body));
  assert(!captured[1].body.includes(fakeKey));
  assert(Object.isFrozen(result.lines));
});

test('browser default fetch works without injection', async () => {
  let count = 0;
  const { factory } = runtime(async () => { count++; return response(); });
  const api = factory.create(); api.connect(fakeKey);
  await api.request(args()); assert.equal(count, 1);
});

test('sole JSON and sole JSON fences parse identically', async () => {
  const text = JSON.stringify(plan());
  for (const content of [text, ` \n${text}\n `, `\`\`\`json\n${text}\n\`\`\``, `\`\`\`JSON\r\n${text}\r\n\`\`\``, `\`\`\`${text}\`\`\``]) {
    const { api } = connected(async () => response(content));
    assert.deepEqual(plain(await api.request(args())), plan());
  }
});

test('adapter returns proposed operations unchanged and leaves business validation to runtime', async () => {
  const raw = plan({ lines: ['Unvalidated proposed text'], beats: [{ afterLine: 22, operations: [{ type: 'unknown.capability', arbitrary: 123 }] }], topic: 'unknown' });
  const { api } = connected(async () => response(JSON.stringify(raw)));
  assert.deepEqual(plain(await api.request(args())), raw);
  assert(!source.includes('HerFramework.validate'));
  assert(!source.includes('HerCapabilities.validate'));
});

test('final-content arrays select only final text and ignore reasoning channels', async () => {
  const content = [{ type: 'reasoning', text: 'PRIVATE_PROVIDER_DETAILS' }, { type: 'output_text', text: JSON.stringify(plan()) }];
  const { api } = connected(async () => response(content, {}, { reasoning_content: fakeKey }));
  assert.deepEqual(plain(await api.request(args())), plan());
});

test('mixed prose, quoted payloads, multiple objects and malformed JSON never become dialogue', async () => {
  const valid = JSON.stringify(plan());
  for (const content of ['ordinary prose', 'null', '[]', JSON.stringify(valid), `先想一想\n${valid}`, `${valid}\nextra`, `${valid}\n${valid}`, `\`\`\`json\n${valid}\n\`\`\`\nextra`, '{"schema":', '{"lines":["bad\\q"]}', '<think>PRIVATE_PROVIDER_DETAILS</think>' + valid]) {
    const { api } = connected(async () => response(content));
    await assert.rejects(api.request(args()), isSafe('format', 200, 'JSON'));
  }
});

test('nested duplicate keys and escaped duplicate keys are rejected', async () => {
  for (const content of ['{"schema":"a","schema":"b"}', '{"lines":["hi"],"beats":[{"operations":[{"type":"one","type":"two"}]}]}', '{"lines":["hi"],"l\\u0069nes":["other"]}']) {
    const { api } = connected(async () => response(content));
    await assert.rejects(api.request(args()), error => isSafe('format', 200, 'JSON')(error) && error.diagnostic.code === 'JSON_DUPLICATE_KEY');
  }
});

test('reasoning, debug fields, thought tags and encoded control fragments fail anywhere', async () => {
  for (const raw of [plan({ debug: 'private' }), plan({ beats: [{ operations: [{ type: 'world.update', changes: { analysis: 'private' } }] }] }), plan({ lines: ['<analysis>private</analysis>'] }), plan({ lines: ['<scratchpad>private'] }), plan({ lines: ['a {"operations":[]}'] }), JSON.parse('{"schema":"her-world-turn-v2","__proto__":{"x":1}}')]) {
    const { api } = connected(async () => response(JSON.stringify(raw)));
    await assert.rejects(api.request(args()), error => isSafe('format', 200)(error) && error.diagnostic.code === 'OUTPUT_UNSAFE');
  }
});

test('exact password echo is rejected in dialogue, operation values, keys and escaped JSON', async () => {
  for (const raw of [plan({ lines: [fakeKey] }), plan({ beats: [{ operations: [{ type: 'memory.upsert', body: fakeKey }] }] }), plan({ [fakeKey]: 'hidden' })]) {
    const { api } = connected(async () => response(JSON.stringify(raw)));
    await assert.rejects(api.request(args()), isSafe('format', 200));
  }
  const escaped = JSON.stringify(plan({ lines: [fakeKey] })).replace(fakeKey, '\\u004d' + fakeKey.slice(1));
  const { api } = connected(async () => response(escaped));
  await assert.rejects(api.request(args()), isSafe('format', 200));
});

test('malformed provider envelope and duplicate envelope keys are sanitized', async () => {
  for (const raw of ['PRIVATE_PROVIDER_DETAILS', '{}', '{"choices":[]}', '{"choices":[{},{}]}', '{"choices":[],"choices":[]}']) {
    const { api } = connected(async () => new Response(raw));
    await assert.rejects(api.request(args()), isSafe('format', 200, 'ENVELOPE'));
  }
});

test('reasoning-only responses are empty and token-limit replies are truncated', async () => {
  for (const content of [null, '', '   ', [{ type: 'reasoning', text: fakeKey }]]) {
    const { api } = connected(async () => response(content, {}, { reasoning_content: 'PRIVATE_PROVIDER_DETAILS' }));
    await assert.rejects(api.request(args()), isSafe('empty', 200, 'FINAL_CONTENT'));
  }
  const { api } = connected(async () => response(JSON.stringify(plan()), { finish_reason: 'length' }));
  await assert.rejects(api.request(args()), isSafe('truncated', 200, 'FINAL_CONTENT'));
});

test('fixed HTTP error classes never read or expose upstream body', async () => {
  for (const [status, code] of [[401, 'auth'], [403, 'auth'], [429, 'quota'], [404, 'upstream'], [503, 'upstream']]) {
    let read = false;
    const { api } = connected(async () => ({ status, ok: false, text: () => { read = true; throw Error(fakeKey); }, body: { cancel() { throw Error(fakeKey); } } }));
    await assert.rejects(api.request(args()), isSafe(code, status, 'HTTP'));
    assert(!read);
  }
});

test('network and response-read failures preserve only known safe metadata', async () => {
  const { api: network } = connected(async () => { throw Error(fakeKey); });
  await assert.rejects(network.request(args()), isSafe('network', undefined, 'NETWORK'));
  const { api: interrupted } = connected(async () => new Response(new ReadableStream({ start(controller) { controller.error(Error('PRIVATE_PROVIDER_DETAILS')); } })));
  await assert.rejects(interrupted.request(args()), isSafe('response_read', 200, 'RESPONSE_READ'));
});

test('safe diagnostics accept only fixed names, codes, paths and HTTP status range', () => {
  const { factory } = runtime();
  const error = new factory.SafeError(fakeKey, 987654, { stage: 'JSON', code: fakeKey, path: fakeKey });
  assert.equal(error.code, 'upstream');
  assert.equal(error.httpStatus, undefined);
  assert.deepEqual(plain(error.diagnostic), { stage: 'JSON' });
  assert(!error.message.includes(fakeKey));
  assert.equal(new factory.SafeError('format', null, { stage: fakeKey }).diagnostic, undefined);
});

test('invalid passwords, complete headers and non-ASCII do not connect or send', async () => {
  let count = 0;
  const { api } = runtime(async () => { count++; return response(); });
  for (const value of ['', 'short', 'x'.repeat(501), fakeKey + '\n', `Bearer ${fakeKey}`, `Authorization:${fakeKey}`, `"${fakeKey}"`, `'${fakeKey}'`, '`' + fakeKey + '`', fakeKey + ' space', fakeKey + '中文']) assert.equal(api.connect(value), false);
  await assert.rejects(api.request(args()), isSafe('disconnected'));
  assert.equal(count, 0);
  assert(api.connect('  ' + fakeKey + '  '));
  assert.equal(api.connected(), true);
});

test('password is never placed in model context even if pasted into input or saved source', async () => {
  let count = 0;
  const { api } = connected(async () => { count++; return response(); });
  await assert.rejects(api.request(args({ input: fakeKey })), isSafe('format', undefined, 'LOCAL_CONTEXT'));
  await assert.rejects(api.request(args({ context: context({ memories: [{ source: fakeKey }] }) })), isSafe('format', undefined, 'LOCAL_CONTEXT'));
  assert.equal(count, 0);
  assert.equal(api.calls(), 0);
});

test('JSON escaping cannot conceal a pasted password from outbound context checks', async () => {
  let count = 0;
  const password = 'MOCK\\ONLY\\PASSWORD';
  const { api } = runtime(async () => { count++; return response(); });
  assert(api.connect(password));
  for (const current of [args({ input: password }), args({ context: context({ guidance: password }) }), args({ context: context({ facts: { [password]: 'hidden' } }) })]) {
    await assert.rejects(api.request(current), error => error.code === 'format' && !error.message.includes(password));
  }
  assert.equal(count, 0);
});

test('context shape, getters, cycles and non-JSON values fail before network', async () => {
  let count = 0, getterRan = false;
  const { api } = connected(async () => { count++; return response(); });
  const accessor = context(); Object.defineProperty(accessor, 'world', { get() { getterRan = true; return {}; }, enumerable: true });
  const cycle = {}; cycle.self = cycle;
  for (const candidate of [null, {}, context({ schema: 'other' }), accessor, context({ facts: cycle }), context({ facts: { bad: () => fakeKey } }), context({ facts: { bad: Infinity } })]) await assert.rejects(api.request(args({ context: candidate })), isSafe('format', undefined, 'LOCAL_CONTEXT'));
  assert.equal(count, 0); assert.equal(getterRan, false);
});

test('input is exact up to 200 Unicode codepoints and overflow is rejected without truncation', async () => {
  let sent;
  const { api } = connected(async (url, options) => { sent = JSON.parse(JSON.parse(options.body).messages[1].content); return response(); });
  const input = '🌟'.repeat(200);
  await api.request(args({ input })); assert.equal(sent.playerSaid, input);
  for (const invalid of ['🌟'.repeat(201), '', '   ', null, {}, 'bad\u0000text']) await assert.rejects(api.request(args({ input: invalid })), error => isSafe('format', undefined, 'LOCAL_CONTEXT')(error) && error.diagnostic.code === 'INPUT_INVALID');
  assert.equal(api.calls(), 1);
});

test('context is snapshotted before awaiting the provider', async () => {
  let finish, sent;
  const { api } = connected((url, options) => { sent = options.body; return new Promise(resolve => finish = resolve); });
  const current = context(), pending = api.request(args({ context: current }));
  current.character.name = 'CHANGED_AFTER_SEND'; current.capabilities.push(opSchema('changed.after.send'));
  finish(response()); await pending;
  assert(!sent.includes('CHANGED_AFTER_SEND')); assert(!sent.includes('changed.after.send'));
});

test('request has a strict 128 KiB UTF-8 budget', async () => {
  let count = 0;
  const { api } = connected(async () => { count++; return response(); });
  await assert.rejects(api.request(args({ context: context({ facts: { large: '字'.repeat(45000) } }) })), error => isSafe('format', undefined, 'REQUEST')(error) && error.diagnostic.code === 'REQUEST_TOO_LARGE');
  assert.equal(count, 0); assert.equal(api.calls(), 0);
});

test('response byte cap is enforced from headers without reading', async () => {
  let read = false, cancelled = false;
  const { api } = connected(async () => ({ status: 200, ok: true, headers: { get: () => '65537' }, body: { cancel: () => { cancelled = true; } }, text() { read = true; return ''; } }));
  await assert.rejects(api.request(args()), error => isSafe('format', 200, 'RESPONSE_READ')(error) && error.diagnostic.code === 'RESPONSE_TOO_LARGE');
  assert.equal(read, false); assert.equal(cancelled, true);
});

test('stream cap counts UTF-8 bytes and cancels without trusting Content-Length', async () => {
  let cancelled = false;
  const chunk = new TextEncoder().encode('界'.repeat(22000));
  const { api } = connected(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(chunk); }, cancel() { cancelled = true; } }), { headers: { 'Content-Length': '1' } }));
  await assert.rejects(api.request(args()), isSafe('format', 200, 'RESPONSE_READ'));
  assert(cancelled);
});

test('nonstream response fallback still enforces byte cap', async () => {
  const { api } = connected(async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => '界'.repeat(22000) }));
  await assert.rejects(api.request(args()), isSafe('format', 200, 'RESPONSE_READ'));
});

test('valid envelope at exactly 64 KiB succeeds, one byte more fails', async () => {
  const base = JSON.stringify(envelope(JSON.stringify(plan())));
  for (const [size, accepted] of [[65536, true], [65537, false]]) {
    const raw = base + ' '.repeat(size - new TextEncoder().encode(base).byteLength);
    const { api } = connected(async () => new Response(raw));
    if (accepted) assert.deepEqual(plain(await api.request(args())), plan());
    else await assert.rejects(api.request(args()), isSafe('format', 200));
  }
});

test('one pending request rejects concurrent submission', async () => {
  let finish;
  const { api } = connected(() => new Promise(resolve => finish = resolve));
  const pending = api.request(args());
  await assert.rejects(api.request(args()), isSafe('busy'));
  finish(response()); await pending; assert.equal(api.calls(), 1);
});

test('pre-aborted request makes no network call or budget charge', async () => {
  let count = 0;
  const { api } = connected(async () => { count++; return response(); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.request(args({ signal: controller.signal })), isSafe('cancelled'));
  assert.equal(count, 0); assert.equal(api.calls(), 0);
});

test('external abort rejects promptly even when fetch ignores the signal', async () => {
  let finish;
  const { api } = connected(() => new Promise(resolve => finish = resolve));
  const controller = new AbortController(), pending = api.request(args({ signal: controller.signal }));
  controller.abort(); await assert.rejects(pending, isSafe('cancelled'));
  assert.equal(api.connected(), true);
  finish(response(JSON.stringify(plan({ lines: ['STALE_RESULT'] }))));
  await Promise.resolve();
});

test('abort while reading response retains HTTP status and releases the body', async () => {
  let bodyCancelled = false, notifyRead;
  const readStarted = new Promise(resolve => notifyRead = resolve);
  const { api } = connected(async () => ({ status: 200, ok: true, headers: { get: () => null }, body: { getReader: () => ({ read() { notifyRead(); return new Promise(() => {}); }, cancel() { bodyCancelled = true; }, releaseLock() {} }) } }));
  const controller = new AbortController(), pending = api.request(args({ signal: controller.signal }));
  await readStarted; controller.abort();
  await assert.rejects(pending, isSafe('cancelled', 200, 'CANCELLED'));
  assert(bodyCancelled);
});

test('reconnect cancels stale request without clearing a newer in-flight request', async () => {
  const requests = [];
  const { api } = connected(() => new Promise(resolve => requests.push(resolve)));
  const old = api.request(args());
  api.disconnect(); assert.equal(api.connected(), false);
  assert(api.connect('SECOND_MOCK_PASSWORD'));
  const newer = api.request(args());
  await assert.rejects(old, isSafe('cancelled'));
  await assert.rejects(api.request(args()), isSafe('busy'));
  requests[0](response(JSON.stringify(plan({ lines: ['STALE_RESULT'] }))));
  requests[1](response());
  assert.deepEqual(plain(await newer), plan()); assert.equal(api.calls(), 1);
});

test('disconnect and pagehide clear volatile connection for every instance', async () => {
  const { api, factory, listeners } = connected();
  const second = factory.create(); second.connect('SECOND_MOCK_PASSWORD');
  for (const listener of listeners.pagehide) listener();
  assert(!api.connected()); assert(!second.connected());
  await assert.rejects(api.request(args()), isSafe('disconnected'));
});

test('30 second timeout aborts ignored fetch, with no retry', async () => {
  let timer, delay, count = 0, clearCount = 0;
  const { api } = connected(() => { count++; return new Promise(() => {}); }, { setTimeout(fn, ms) { timer = fn; delay = ms; return 7; }, clearTimeout() { clearCount++; } });
  const pending = api.request(args());
  assert.equal(delay, 30000); timer();
  await assert.rejects(pending, isSafe('timeout', undefined, 'CANCELLED'));
  assert.equal(count, 1); assert.equal(clearCount, 1);
});

test('20-call limit includes failed requests and resets only on valid reconnect', async () => {
  let count = 0;
  const { api } = connected(async () => { count++; return new Response('PRIVATE_PROVIDER_DETAILS', { status: 429 }); });
  for (let i = 0; i < 20; i++) await assert.rejects(api.request(args()), isSafe('quota', 429));
  assert.equal(api.connect('bad'), false);
  await assert.rejects(api.request(args()), isSafe('limit'));
  assert.equal(count, 20); assert.equal(api.calls(), 20);
  api.connect(fakeKey); assert.equal(api.calls(), 0);
  await assert.rejects(api.request(args()), isSafe('quota', 429)); assert.equal(count, 21);
});

test('model adapter does not persist secrets or embed content-pack progression', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
  assert.doesNotMatch(source, /rain_taught|rain_created|teach_rain|rain_name|visitor_reference|DMXAPI.*https?:/);
});

test('actual runtime contexts for both content packs build bounded, distinct prompts', () => {
  const Framework = require('../framework/runtime.js');
  const Packs = require('../framework/packs.js');
  const Model = require('../framework/model.js');
  const requests = Packs.list().map(pack => {
    const current = Framework.context(Framework.create(pack));
    const built = Model.buildRequest(current, '你好');
    assert(Buffer.byteLength(JSON.stringify(built)) < 131072);
    assert(built.messages[0].content.includes(pack.guidance));
    assert.equal(JSON.parse(built.messages[1].content).context.capabilities.length, pack.capabilities.length);
    return built;
  });
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].messages[0].content, requests[1].messages[0].content);
});

test('mocked adapter proposal reaches real runtime validation and atomically preserves original state', async () => {
  const Framework = require('../framework/runtime.js');
  const Packs = require('../framework/packs.js');
  const Model = require('../framework/model.js');
  const current = Framework.create(Packs.list()[0]), input = '在天上画一颗星';
  const create = { type: 'world.create', object: { label: '星', glyphs: '*', scale: 1 }, placement: { anchor: 'sky' } };
  let proposed = plan({ beats: [{ afterLine: 0, operations: [create] }] });
  const api = Model.create({ fetch: async () => response(JSON.stringify(proposed)) }); api.connect(fakeKey);
  const first = await api.request({ context: Framework.context(current), input });
  const accepted = Framework.commit(current, Framework.propose(current, { text: input }), first);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.state.world.objects.length, 1);
  assert.equal(current.world.objects.length, 0);
  proposed = plan({ beats: [{ afterLine: 0, operations: [create, { type: 'unregistered.operation' }] }] });
  const invalid = await api.request({ context: Framework.context(current), input });
  const rejected = Framework.commit(current, Framework.propose(current, { text: input }), invalid);
  assert.equal(rejected.ok, false);
  assert.equal(current.world.objects.length, 0);
  assert.equal(current.transcript.length, 0);
});

test('maximum accepted world context preserves sources, stays requestable and can remove a note', async () => {
  const Framework = require('../framework/runtime.js');
  const Packs = require('../framework/packs.js');
  const Model = require('../framework/model.js');
  let capacityPressure = false;
  for (const unicode of ['天', '🌟']) {
    let state = Framework.create(Packs.list()[0]), rejected = 0, trimmed = false;
    const seeded = Framework.commit(state, Framework.propose(state, { text: '在角落放一点光' }), plan({ beats: [{ afterLine: 0, operations: [{ type: 'world.create', object: { label: '光', glyphs: '*', x: 99, y: 59, scale: 1 } }] }] }));
    assert.equal(seeded.ok, true);
    state = seeded.state;
    const input = unicode.repeat(200), lines = Array(4).fill(unicode.repeat(500));
    const verifyRequestable = () => {
      const current = Framework.context(state), built = Model.buildRequest(current, input);
      assert(Buffer.byteLength(JSON.stringify(built)) <= 131072);
      assert.deepEqual(current.facts, state.facts);
      assert.deepEqual(withoutSourceSpans(current.world), withoutSourceSpans(state.world));
      assertProjectedMemories(current.memories, state.memories);
      assert.deepEqual(current.story, state.story);
      if (current.recentTranscript.length < Math.min(12, state.transcript.length)) trimmed = true;
    };
    const attempt = operations => {
      const previous = state;
      const result = Framework.commit(state, Framework.propose(state, { text: input }), plan({ lines, beats: operations.length ? [{ afterLine: 0, operations }] : [] }));
      if (result.ok) state = result.state;
      else {
        assert.equal(result.error.code, 'CONTEXT_CAPACITY');
        assert.equal(state, previous); rejected++;
      }
      verifyRequestable();
      return result.ok;
    };
    const notes = Array.from({ length: 14 }, (_, i) => ({ type: 'memory.upsert', id: 'note_budget_' + i, title: unicode.repeat(60), body: unicode.repeat(240) }));
    if (!attempt(notes.slice(0, 12))) for (const note of notes.slice(0, 12)) attempt([note]);
    if (!attempt(notes.slice(12))) for (const note of notes.slice(12)) attempt([note]);
    const acceptedNotes = notes.filter(note => state.memories.some(memory => memory.id === note.id));
    // Each note retains both its original source and a distinct current revision.
    assert(attempt(acceptedNotes.slice(0, 12)));
    if (acceptedNotes.length > 12) attempt(acceptedNotes.slice(12));
    const glyphs = Array(10).fill('*'.repeat(24)).join('\n');
    const objects = Array.from({ length: 7 }, (_, i) => ({ type: 'world.create', object: { label: unicode.repeat(40), glyphs, x: i, y: i, scale: 1 } }));
    // Individual limits are not a promise that all maximum-sized fields fit together.
    // If the atomic batch exceeds the combined context budget, fill only legal slots.
    if (!attempt(objects)) for (const object of objects) attempt([object]);
    attempt(state.world.objects.map(object => ({ type: 'world.update', target: object.id, changes: { x: Math.min(99, object.x + 1) } })));
    for (const target of [...state.world.objects, ...state.pack.entities].map(item => item.id)) {
      for (const field of ['meaning', 'interpretation']) attempt([{ type: 'world.annotate', target, field, value: unicode.repeat(120) }]);
    }
    attempt([{ type: 'weather.set', changes: { name: unicode.repeat(40), kind: 'snow', intensity: 3, paused: false } }, { type: 'character.update', changes: { mood: unicode.repeat(80), stance: unicode.repeat(160) } }]);
    // Twelve recent entries would include maximum-length character lines and sources.
    for (let i = 0; i < 3; i++) assert(attempt([]));
    assert(state.world.objects.length > 0 && state.world.objects.length <= 8);
    assert(state.memories.length > 0 && state.memories.length <= 14);
    for (const memory of state.memories) {
      assert.equal([...memory.source.text].length, 200);
      assert.equal([...memory.currentRevision.text].length, 200);
      assert.equal([...memory.body].length, 240);
    }
    capacityPressure ||= trimmed || rejected > 0;
    const id = state.memories[0].id, memoryCount = state.memories.length;
    const api = Model.create({ fetch: async () => response(JSON.stringify(plan({ beats: [{ afterLine: 0, operations: [{ type: 'memory.remove', id }] }] }))) });
    api.connect(fakeKey);
    const removalInput = '删除第一条记忆';
    const proposed = await api.request({ context: Framework.context(state), input: removalInput });
    const removed = Framework.commit(state, Framework.propose(state, { text: removalInput }), proposed);
    assert.equal(removed.ok, true);
    assert.equal(removed.state.memories.length, memoryCount - 1);
    assert.equal(state.memories.length, memoryCount);
    assert(Buffer.byteLength(JSON.stringify(Model.buildRequest(Framework.context(removed.state), '继续'))) <= 131072);
  }
  assert(capacityPressure, 'capacity pressure must be exercised');
});

test('maximum structural pack is rejected and near-budget pack states remain within fixed transport cap', async () => {
  const Framework = require('../framework/runtime.js');
  const Packs = require('../framework/packs.js');
  const Model = require('../framework/model.js');
  const maxPack = Packs.list()[0];
  maxPack.guidance = '🌟'.repeat(3000);
  maxPack.title = '🌟'.repeat(120);
  maxPack.character.name = '🌟'.repeat(60);
  maxPack.character.role = '🌟'.repeat(800);
  maxPack.topics = Array.from({ length: 32 }, (_, i) => ({ id: 'topic_' + i, title: '🌟'.repeat(100) }));
  maxPack.entities = Array.from({ length: 32 }, (_, i) => ({ id: 'entity_' + i, label: '🌟'.repeat(60), kind: '🌟'.repeat(40) }));
  maxPack.nodes = Array.from({ length: 64 }, (_, i) => ({ id: 'node_' + i, topic: 'topic_0', requires: {}, question: { id: 'question_' + i, text: '🌟'.repeat(500), kind: 'open' }, completion: { type: 'answer' }, sets: {} }));
  const tooLarge = Framework.validatePack(maxPack);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.error.code, 'PACK_CAPACITY');
  assert.throws(() => Framework.create(maxPack));
  // Maximize the definitions duplicated into the system prompt, within pack admission.
  const admitted = plain(maxPack); admitted.entities = []; admitted.nodes = [];
  while (!Framework.validatePack(admitted).ok && admitted.topics.length > 1) admitted.topics.pop();
  assert.equal(Framework.validatePack(admitted).ok, true);
  const packBytes = Buffer.byteLength(JSON.stringify(admitted));
  assert(packBytes <= 24 * 1024 && packBytes > 23 * 1024);
  let state = Framework.create(admitted), rejected = 0;
  const input = '🌟'.repeat(200), lines = Array(4).fill('🌟'.repeat(500));
  const verify = () => {
    const current = Framework.context(state);
    assert(Buffer.byteLength(JSON.stringify(current)) <= 96 * 1024);
    assert(Buffer.byteLength(JSON.stringify(Model.buildRequest(current, input))) <= 128 * 1024);
    assertProjectedMemories(current.memories, state.memories);
    assert.deepEqual(current.facts, state.facts);
    assert.equal(current.guidance, admitted.guidance);
    assert.equal(current.character.role, admitted.character.role);
    assert.equal(current.activeQuestionId, null);
  };
  verify();
  // A nearly full content definition may leave no room for a maximum-size
  // memory's source, support and revision. Keep one small real memory so
  // removal remains exercised even when all maximum-size attempts reject.
  const baseline = Framework.commit(state, Framework.propose(state, { text: '短记忆' }), plan({ beats: [{ afterLine: 0, operations: [{ type: 'memory.upsert', id: 'note_baseline', title: '基线', body: '短记忆' }] }] }));
  assert.equal(baseline.ok, true, JSON.stringify(baseline.error));
  state = baseline.state;
  verify();
  const attempt = operations => {
    const result = Framework.commit(state, Framework.propose(state, { text: input }), plan({ lines, beats: [{ afterLine: 0, operations }] }));
    if (result.ok) state = result.state;
    else { assert.equal(result.error.code, 'CONTEXT_CAPACITY'); rejected++; }
    verify();
  };
  for (let i = 0; i < 14; i++) attempt([{ type: 'memory.upsert', id: 'note_largepack_' + i, title: '🌟'.repeat(60), body: '🌟'.repeat(240) }]);
  for (let i = 0; i < 8; i++) attempt([{ type: 'world.create', object: { label: '🌟'.repeat(40), glyphs: Array(10).fill('*'.repeat(24)).join('\n'), scale: 1, x: i, y: i } }]);
  assert(rejected > 0, 'test must reach canonical context capacity');
  assert(state.memories.length > 0);
  const id = state.memories[0].id;
  const api = Model.create({ fetch: async () => response(JSON.stringify(plan({ beats: [{ afterLine: 0, operations: [{ type: 'memory.remove', id }] }] }))) });
  api.connect(fakeKey);
  const proposed = await api.request({ context: Framework.context(state), input: '删掉这条记忆' });
  const removal = Framework.commit(state, Framework.propose(state, { text: '删掉这条记忆' }), proposed);
  assert.equal(removal.ok, true);
  assert.equal(removal.state.memories.length, state.memories.length - 1);
});

test('nested JSON escaping is budgeted before accepting state and removal remains requestable', async () => {
  const Framework = require('../framework/runtime.js');
  const Packs = require('../framework/packs.js');
  const Model = require('../framework/model.js');
  const Caps = require('../framework/capabilities.js');
  for (const character of ['\\', '"']) {
    const pack = Packs.get('rain-lab');
    pack.initialFacts = Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['escaped_' + i, character.repeat(800)]));
    assert.equal(Framework.validatePack(pack).ok, true);
    let state = Framework.create(pack), rejected = 0;
    const input = character.repeat(200), lines = Array(4).fill(character.repeat(500));
    const verify = (compareRecall = true) => {
      const current = Framework.context(state);
      assert(Caps.requestContextBytes(current) <= 96 * 1024);
      const built = Model.buildRequest(current, input);
      assert(Buffer.byteLength(JSON.stringify(built)) <= 128 * 1024);
      assert.deepEqual(current.facts, state.facts);
      if (compareRecall) {
        assert.deepEqual(withoutSourceSpans(current.world), withoutSourceSpans(state.world));
        assertProjectedMemories(current.memories, state.memories);
      }
      for (const value of Object.values(current.facts)) assert.equal(value, character.repeat(800));
      return built;
    };
    verify();
    const attempt = operations => {
      const before = JSON.stringify(Framework.serialize(state));
      const result = Framework.commit(state, Framework.propose(state, { text: input }), plan({ lines, beats: operations.length ? [{ afterLine: 0, operations }] : [] }));
      if (result.ok) state = result.state;
      else {
        assert.equal(result.error.code, 'CONTEXT_CAPACITY');
        assert.equal(JSON.stringify(Framework.serialize(state)), before);
        rejected++;
      }
      verify();
      return result.ok;
    };
    // Preserve the reviewer's failing batch sequence, then try each remaining slot.
    const notes = Array.from({ length: 14 }, (_, i) => ({ type: 'memory.upsert', id: 'note_escaped_' + i, title: character.repeat(60), body: character.repeat(240) }));
    attempt(notes.slice(0, 12)); attempt(notes.slice(12));
    const objects = Array.from({ length: 8 }, (_, i) => ({ type: 'world.create', object: { label: character.repeat(40), glyphs: Array(10).fill(character.repeat(24)).join('\n'), x: i, y: i, scale: 1 } }));
    attempt(objects);
    for (const target of [...state.world.objects, ...state.pack.entities].map(item => item.id)) {
      attempt(['meaning', 'interpretation'].map(field => ({ type: 'world.annotate', target, field, value: character.repeat(120) })));
    }
    for (const note of notes) if (!state.memories.some(item => item.id === note.id)) attempt([note]);
    assert(rejected > 0);
    assert(state.memories.length > 0);
    for (const memory of state.memories) {
      assert.equal(memory.source.text, input);
      assert.equal(memory.currentRevision.text, input);
      assert.equal(memory.body, character.repeat(240));
    }
    const id = state.memories[0].id, initialCount = state.memories.length;
    const api = Model.create({ fetch: async () => response(JSON.stringify(plan({ beats: [{ afterLine: 0, operations: [{ type: 'memory.remove', id }] }] }))) });
    api.connect(fakeKey);
    const raw = await api.request({ context: Framework.context(state), input });
    const removal = Framework.commit(state, Framework.propose(state, { text: input }), raw);
    assert.equal(removal.ok, true);
    assert.equal(removal.state.memories.length, initialCount - 1);
    state = removal.state; verify(false);
  }
});

test('shared definition preserves the exact existing dynamic prompt shape and field order', () => {
  const Caps = require('../framework/capabilities.js');
  const { factory } = runtime();
  const current = context({ activeQuestionId: 'pick_star', guidance: 'A "quote" and \\ slash' });
  const expected = { pack: current.pack, persona: { name: current.character.name, role: current.character.role }, guidance: current.guidance, topics: current.topics, capabilities: current.capabilities };
  assert.equal(JSON.stringify(Caps.modelDefinition(current)), JSON.stringify(expected));
  const built = factory.buildRequest(current, '继续');
  assert(built.messages[0].content.endsWith('\n本轮内容与能力定义：\n' + JSON.stringify(expected)));
});

test('96 KiB encoded contexts retain a proven request reserve for maximum nested-escaped input', () => {
  const Framework = require('../framework/runtime.js');
  const Packs = require('../framework/packs.js');
  const Model = require('../framework/model.js');
  const Caps = require('../framework/capabilities.js');
  const contextBudget = 96 * 1024, transportBudget = 128 * 1024;
  const requestBytes = (current, input) => Buffer.byteLength(JSON.stringify(Model.buildRequest(current, input)));
  const inputs = [
    'x'.repeat(200), '"'.repeat(200), '\\'.repeat(200), '🌧'.repeat(200),
    '\ud800'.repeat(200), '\udfff'.repeat(200), 'x' + '\t'.repeat(199), 'x' + '\n'.repeat(199)
  ];
  let fixedOverhead;
  for (const pack of Packs.list()) {
    const current = Framework.context(Framework.create(pack));
    const encodedContext = Caps.requestContextBytes(current);
    const overhead = requestBytes(current, 'x') - encodedContext - 1;
    if (fixedOverhead === undefined) fixedOverhead = overhead;
    else assert.equal(overhead, fixedOverhead);
    // One accepted Unicode scalar needs at most four UTF-8 bytes. A lone
    // surrogate is also accepted by the adapter and needs six JSON escape
    // characters plus one enclosing-string escape: seven bytes, the maximum.
    const maximumInputBytes = 200 * 7;
    for (const input of inputs) assert(requestBytes(current, input) - encodedContext <= overhead + maximumInputBytes);
    assert.equal(requestBytes(current, '\ud800'.repeat(200)) - encodedContext, overhead + maximumInputBytes);
    assert(overhead + maximumInputBytes <= transportBudget - contextBudget);
    // Fill a synthetic data-only context to the exact encoded reserve. This
    // stresses transport independently of any particular admitted pack shape.
    const full = plain(current);
    full.recentTranscript = [{ eventId: 'event_budget', role: 'user', text: '' }];
    full.recentTranscript[0].text = 'x'.repeat(contextBudget - Caps.requestContextBytes(full));
    assert.equal(Caps.requestContextBytes(full), contextBudget);
    assert.equal(requestBytes(full, '\ud800'.repeat(200)), contextBudget + overhead + maximumInputBytes);
    assert(requestBytes(full, '\ud800'.repeat(200)) <= transportBudget);
  }
});

'use strict';
// Real transport/parser + UI, with synthetic responses only. No browser or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('../framework/model.js');
const { setup } = require('./helpers/framework-ui-harness.cjs');

const expected = {
  unverified: ['在线待验证 · 本页临时设置', 'UNVERIFIED / AI'],
  responded: ['AI 已回应 · 本页临时连接', 'RESPONSE RECEIVED / AI'],
  rejected: ['认证或权限被拒 · 检查连接', 'AUTH REJECTED / AI'],
  failed: ['在线请求未完成 · 未自动重试', 'REQUEST FAILED / AI']
};
const turn = () => ({ schema: 'her-world-turn-v4', requestedChanges: [], lines: [{ text: '我听着。', mode: 'discussion', operations: [] }], topic: null });
const response = (content = JSON.stringify(turn())) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
const rejected = (status = 401) => new Response(JSON.stringify({ error: { code: status === 401 ? 'AUTH_REQUIRED' : 'ORIGIN_DENIED' } }), { status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const status = (ui, name) => {
  assert.equal(ui.ids['connection-button'].textContent, expected[name][0]);
  assert.equal(ui.ids['connection-label'].textContent, expected[name][1]);
  assert.doesNotMatch(ui.ids['connection-button'].textContent, /AI 已连接/);
};
function harness(fetch, options = {}) {
  let requests = 0;
  const model = Model.create({ fetch: (...args) => { requests++; return fetch(...args); } });
  const ui = setup({ ...options, model });
  return { ...ui, requests: () => requests };
}

test('setting locally valid credentials is visibly unverified and sends no request', async () => {
  const r = harness(() => assert.fail('setup must not request validation'));
  const before = JSON.stringify(r.app.snapshot().state);
  await r.online();
  status(r, 'unverified');
  assert.match(r.ids['input-note'].textContent, /尚未验证服务/);
  assert.equal(r.requests(), 0); assert.equal(r.model.calls(), 0);
  assert.equal(r.ids['api-key'].value, ''); assert(r.model.connected());
  assert.equal(JSON.stringify(r.app.snapshot().state), before); assert.equal(r.store.size, 0);
  const html = fs.readFileSync(path.join(__dirname, '../framework.html'), 'utf8');
  assert.match(html, /设置密码不会发送验证请求；本地格式检查不代表服务认证通过/);
  assert.match(html, /id="connect-button">设置在线模式/);
});

test('a pending request stays unverified until its real parser accepts a response', async () => {
  const gate = deferred(), r = harness(() => gate.promise);
  await r.online(); const sending = r.app.submit('先聊一会儿。');
  assert.equal(r.ids['connection-button'].textContent, expected.unverified[0]);
  assert.equal(r.ids['connection-label'].textContent, 'WAITING FOR RESPONSE');
  assert.equal(r.app.snapshot().state.events.length, 0);
  gate.resolve(response()); assert.equal(await sending, true);
  status(r, 'responded'); assert.equal(r.requests(), 1); assert.equal(r.model.calls(), 1);
  assert.equal(r.app.snapshot().state.events.length, 1);
});

test('401 and 403 replace unverified setup with fixed authentication/permission rejection', async () => {
  for (const httpStatus of [401, 403]) {
    const r = harness(() => rejected(httpStatus)); await r.online();
    const before = JSON.stringify(r.app.snapshot().state);
    assert.equal(await r.app.submit('先聊一会儿。'), false);
    status(r, 'rejected');
    assert.match(r.ids['input-note'].textContent, /不能仅凭此判断密码有误/);
    assert.equal(r.app.snapshot().lastFailure.httpStatus, httpStatus);
    assert.equal(r.app.snapshot().lastFailure.detail, httpStatus === 401 ? 'PROXY_AUTH_REQUIRED' : 'PROXY_ORIGIN_DENIED');
    assert.equal(JSON.stringify(r.app.snapshot().state), before);
    assert.equal(r.requests(), 1); assert.equal(r.model.calls(), 1); assert(r.model.connected());
    assert.equal(r.store.size, 0); assert.equal(r.ids['retry-button'].disabled, false);
  }
});

test('authentication rejection supersedes earlier success and a manual retry can recover', async () => {
  const queue = [() => response(), () => rejected(), () => response()];
  const r = harness(() => queue.shift()()); await r.online();
  await r.say('第一句。'); status(r, 'responded');
  const before = JSON.stringify(r.app.snapshot().state);
  await r.say('第二句。'); status(r, 'rejected');
  assert.equal(JSON.stringify(r.app.snapshot().state), before); assert.equal(r.requests(), 2);
  await r.ids['retry-button'].emit('click'); status(r, 'responded');
  assert.equal(r.requests(), 3); assert.equal(r.app.snapshot().state.events.length, 2);
  assert(r.ids['request-error'].hidden);
});

test('reconnecting resets all prior outcomes to unverified without an extra request', async () => {
  for (const fetch of [() => response(), () => rejected(), () => { throw Error('synthetic network interruption'); }]) {
    const r = harness(fetch); await r.online(); await r.say('先聊一会儿。');
    assert.notEqual(r.ids['connection-label'].textContent, expected.unverified[1]);
    const before = JSON.stringify(r.app.snapshot().state);
    await r.online(); status(r, 'unverified');
    assert.equal(r.requests(), 1); assert.equal(r.model.calls(), 0);
    assert.equal(JSON.stringify(r.app.snapshot().state), before); assert(r.ids['request-error'].hidden);
  }
});

test('an invalid reconnect and dismissing the connection dialog preserve the prior outcome', async () => {
  const r = harness(() => response()); await r.online(); await r.say('先聊一会儿。');
  await r.ids['connection-button'].emit('click');
  r.ids['api-key'].value = 'short'; await r.ids['connect-form'].emit('submit');
  assert.equal(r.ids['connection-error'].hidden, false); status(r, 'responded');
  r.ids['connect-dialog'].close(); status(r, 'responded');
  assert.equal(r.requests(), 1); assert.equal(r.model.calls(), 1); assert(r.model.connected());
});

test('other transport failures neither verify setup nor masquerade as authentication rejection', async () => {
  const cases = [
    [() => { throw Error('synthetic network interruption'); }, 'network'],
    [() => new Response('{}', { status: 429 }), 'quota'],
    [() => new Response('{}', { status: 502 }), 'upstream'],
    [() => response('invalid JSON'), 'format'],
    [() => new Response(new ReadableStream({ start(controller) { controller.error(Error('synthetic body interruption')); } }), { status: 200 }), 'response_read']
  ];
  for (const [fetch, code] of cases) {
    const r = harness(fetch); await r.online(); const before = JSON.stringify(r.app.snapshot().state);
    await r.say('先聊一会儿。'); status(r, 'failed');
    assert.equal(r.app.snapshot().lastFailure.code, code);
    assert.equal(JSON.stringify(r.app.snapshot().state), before); assert.equal(r.requests(), 1);
    assert.match(r.ids['input-note'].textContent, /不会自动重试/);
  }
});

test('a later non-authentication failure replaces either successful or rejected status', async () => {
  for (const first of [() => response(), () => rejected()]) {
    const queue = [first, () => { throw Error('synthetic network interruption'); }];
    const r = harness(() => queue.shift()()); await r.online();
    await r.say('第一句。'); await r.say('第二句。');
    status(r, 'failed'); assert.equal(r.requests(), 2);
  }
});

test('dismissing a request error leaves accurate neutral status without pointing to a hidden error', async () => {
  const r = harness(() => { throw Error('synthetic network interruption'); }); await r.online();
  const before = JSON.stringify(r.app.snapshot().state);
  await r.say('先聊一会儿。'); status(r, 'failed'); assert.equal(r.ids['request-error'].hidden, false);
  await r.ids['cancel-request-button'].emit('click'); status(r, 'failed');
  assert.equal(r.ids['request-error'].hidden, true); assert.equal(r.app.snapshot().lastFailure, null);
  assert.doesNotMatch(r.ids['connection-button'].textContent + r.ids['input-note'].textContent, /查看.*提示/);
  assert.match(r.ids['input-note'].textContent, /上次请求未完成。不会自动重试/);
  assert.equal(r.ids['retry-button'].disabled, true); assert.equal(r.ids['fallback-button'].disabled, true);
  assert.equal(JSON.stringify(r.app.snapshot().state), before); assert.equal(r.requests(), 1);
});

test('the observed proxy 504 after success uses a neutral service-error label and manual retry can recover', async () => {
  const queue = [() => response(), () => new Response(JSON.stringify({ error: { code: 'UPSTREAM_TIMEOUT' } }), { status: 504 }), () => response()];
  const r = harness(() => queue.shift()()); await r.online(); await r.say('第一句。'); status(r, 'responded');
  const before = JSON.stringify(r.app.snapshot().state);
  await r.say('第二句。'); status(r, 'failed');
  assert.equal(r.app.snapshot().lastFailure.code, 'upstream');
  assert.equal(r.app.snapshot().lastFailure.httpStatus, 504);
  assert.equal(r.app.snapshot().lastFailure.detail, 'PROXY_UPSTREAM_TIMEOUT');
  assert.equal(JSON.stringify(r.app.snapshot().state), before); assert.equal(r.requests(), 2);
  await r.ids['retry-button'].emit('click'); status(r, 'responded');
  assert.equal(r.requests(), 3); assert.equal(r.app.snapshot().state.events.length, 2);
});

test('local rule rejection does not misreport a received service response as failed authentication', async () => {
  const plan = { schema: 'her-world-turn-v2', lines: ['先聊一会儿。'], beats: [], topic: 'unknown_topic' };
  const r = harness(() => response(JSON.stringify(plan))); await r.online();
  const before = JSON.stringify(r.app.snapshot().state);
  assert.equal(await r.app.submit('先聊一会儿。'), false); status(r, 'responded');
  assert.equal(r.app.snapshot().lastFailure.code, 'invalid');
  assert.equal(JSON.stringify(r.app.snapshot().state), before); assert.equal(r.requests(), 1);
  assert.equal(r.ids['request-error'].hidden, false);
});

test('cancelled late responses cannot verify setup or replace an earlier known outcome', async () => {
  for (const initial of [null, () => response(), () => rejected()]) for (const late of [() => response(), () => rejected()]) {
    const gate = deferred(); let first = true;
    const r = harness(() => initial && first ? (first = false, initial()) : gate.promise);
    await r.online(); if (initial) await r.say('第一句。');
    const priorButton = r.ids['connection-button'].textContent, priorLabel = r.ids['connection-label'].textContent;
    const before = JSON.stringify(r.app.snapshot().state), sending = r.app.submit('稍后回应。');
    await r.ids['cancel-pending'].emit('click'); gate.resolve(late());
    assert.equal(await sending, false);
    assert.equal(r.ids['connection-button'].textContent, priorButton);
    assert.equal(r.ids['connection-label'].textContent, priorLabel);
    assert.equal(JSON.stringify(r.app.snapshot().state), before);
    assert.equal(r.requests(), initial ? 2 : 1);
  }
});

test('reconnect during a request ignores late success and rejection from the old session', async () => {
  for (const late of [() => response(), () => rejected()]) {
    const gate = deferred(), r = harness(() => gate.promise); await r.online();
    const sending = r.app.submit('稍后回应。'); await r.online(); status(r, 'unverified');
    gate.resolve(late()); assert.equal(await sending, false); status(r, 'unverified');
    assert.equal(r.requests(), 1); assert.equal(r.model.calls(), 0);
    assert.equal(r.app.snapshot().state.events.length, 0);
  }
});

test('timeout shows request failure with the existing single-call deadline and no retry', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../framework/model.js'), 'utf8');
  let serial = 0, requests = 0; const timers = new Map();
  const window = { HerCapabilities: require('../framework/capabilities.js'), HerMemoryPolicy: require('../framework/memory-policy.js'), addEventListener() {} };
  vm.runInNewContext(source, { window, AbortController, TextEncoder, TextDecoder,
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
  const model = window.HerFrameworkModel.create({ fetch: () => { requests++; return new Promise(() => {}); } });
  const r = setup({ model }); await r.online(); const sending = r.app.submit('稍后回应。');
  const deadline = [...timers.values()].find(timer => timer.delay === 30000); assert(deadline); deadline.fn();
  assert.equal(await sending, false); status(r, 'failed');
  assert.equal(r.app.snapshot().lastFailure.code, 'timeout'); assert.equal(requests, 1); assert.equal(model.calls(), 1);
  assert.equal(timers.size, 0); assert.equal(r.app.snapshot().state.events.length, 0);
});

test('the existing 20-call limit still counts failures and status never triggers a probe or retry', async () => {
  const r = harness(() => rejected()); await r.online();
  for (let i = 0; i < 20; i++) await r.say('先聊一会儿。');
  status(r, 'rejected'); assert.equal(r.requests(), 20); assert.equal(r.model.calls(), 20);
  await r.say('再说一句。'); status(r, 'failed');
  assert.equal(r.app.snapshot().lastFailure.code, 'limit'); assert.equal(r.requests(), 20); assert.equal(r.model.calls(), 20);
  assert.equal(r.app.snapshot().state.events.length, 0);
});

test('offline fallback, explicit disconnect and pagehide clear online presentation without new requests', async () => {
  for (const leave of ['fallback', 'disconnect', 'pagehide']) {
    const r = harness(() => rejected()); await r.online(); await r.say('先聊一会儿。'); status(r, 'rejected');
    if (leave === 'fallback') await r.ids['fallback-button'].emit('click');
    else if (leave === 'disconnect') await r.ids['disconnect-button'].emit('click');
    else await r.event('pagehide');
    assert.equal(r.model.connected(), false); assert.equal(r.requests(), 1);
    assert.equal(r.app.snapshot().mode, leave === 'fallback' ? 'offline' : null);
    assert.equal(r.ids['connection-label'].textContent, leave === 'fallback' ? 'OFFLINE / RULES' : 'WAITING FOR YOU');
    await r.online(); status(r, 'unverified'); assert.equal(r.requests(), 1);
  }
});

test('a restored accepted turn never restores the prior connection claim or sends a request', async () => {
  const r = harness(() => response()); await r.online(); await r.say('先聊一会儿。'); status(r, 'responded');
  const next = harness(() => assert.fail('restore must not request a response'), { store: r.store });
  assert.equal(next.app.snapshot().state.events.length, 1); assert.equal(next.app.snapshot().mode, null);
  assert.equal(next.ids['connection-button'].textContent, '未连接 · 选择试玩模式');
  assert.equal(next.requests(), 0); assert.equal(next.model.connected(), false);
  await next.online(); status(next, 'unverified'); assert.equal(next.requests(), 0);
});

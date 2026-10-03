'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectSources, localName } = require('./surrogate-sources.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const escapeAttribute = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// This function is serialized as trusted test code. Fixture text is only ever
// decoded into strings and returned in an OpenAI-shaped JSON response.
function installFixtureTransport(fixtures) {
  'use strict';
  const memory = new Map();
  const storage = Object.freeze({ getItem: key => memory.get(String(key)) ?? null, setItem: (key, value) => { memory.set(String(key), String(value)); }, removeItem: key => { memory.delete(String(key)); }, clear: () => memory.clear(), key: index => [...memory.keys()][index] ?? null, get length() { return memory.size; } });
  const qa = { fixtures, armed: null, responseCount: 0, failure: null, memory, allowedUI: false };
  const blocked = () => { throw new Error('Network disabled in GPT surrogate playback'); };
  try {
    // The iframe also lacks allow-same-origin: access to the real origin's saved
    // game is impossible even if this explicit storage isolation fails.
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: false, writable: false });
    Object.defineProperty(window, 'sessionStorage', { value: storage, configurable: false, writable: false });
    Object.defineProperty(window, 'fetch', { configurable: false, writable: false, value: async (_url, options) => {
      const item = qa.armed; qa.armed = null;
      if (!item) { qa.failure = 'No recorded response is armed. No network request was made.'; throw new Error(qa.failure); }
      const body = JSON.parse(options.body);
      if (JSON.stringify(body) !== JSON.stringify(item.request)) { qa.failure = 'Request differs from the recorded production prompt. Playback stopped.'; throw new Error(qa.failure); }
      qa.responseCount++;
      const bytes = Uint8Array.from(atob(item.rawBase64), character => character.charCodeAt(0));
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });
    for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource']) Object.defineProperty(window, name, { value: blocked, configurable: false, writable: false });
    window.__surrogate = qa;
    window.__surrogateReady = true;
  } catch (error) { window.__surrogateReady = false; window.__surrogateSetupError = String(error.message); }
}

function installPlaybackControls() {
  'use strict';
  const byId = id => document.getElementById(id), qa = window.__surrogate;
  const status = byId('qa-status'), next = byId('qa-next'), reset = byId('qa-reset'), details = byId('qa-details');
  let cursor = 0, busy = false;
  const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  if (!window.__surrogateReady) { status.textContent = 'Isolation setup failed. Production scripts did not run: ' + window.__surrogateSetupError; next.disabled = true; return; }
  const dummy = 'GPT_SURROGATE_DUMMY_NEVER_A_REAL_KEY';
  byId('api-key').readOnly = true; byId('api-key').disabled = true; byId('free-input').readOnly = true;
  const blockedControls = '#start-button,#ai-status-button,#connect-button,#offline-button,#disconnect-button,#free-send,#reset-button,#confirm-reset,#retry-button,#fallback-button,#cancel-request-button,[data-choice],[data-topic],[data-skill],#object-example,.object-talk';
  document.addEventListener('click', event => {
    if (qa.allowedUI) return;
    const link = event.target.closest('a[href]');
    if ((link && !link.getAttribute('href').startsWith('#')) || event.target.closest(blockedControls) || (cursor < qa.fixtures.length && event.target.closest('#tab-logs,#drawer-toggle,#memory-invitation'))) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('submit', event => { if (!qa.allowedUI) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  function labels() {
    const values = [['ai-status-button', 'GPT surrogate · 固定原始输出回放'], ['save-status', 'TEST SESSION · 只在隔离内存中']];
    for (const [id, text] of values) if (byId(id).textContent !== text) byId(id).textContent = text;
  }
  new MutationObserver(labels).observe(byId('ai-status-button').parentElement, { subtree: true, childList: true, characterData: true });
  labels();
  if (byId('motion-toggle').getAttribute('aria-pressed') !== 'true') byId('motion-toggle').click();
  function update() {
    const item = qa.fixtures[cursor];
    next.disabled = busy || !item;
    next.textContent = !item ? '所有记录已回放' : item.opening ? '回放真实开场输出' : '回放下一条玩家输入';
    byId('qa-input').textContent = item ? (item.opening ? '[开场请求]' : item.input) : '已到记录结尾。重新开始会清空这个隔离页面的内存。';
  }
  async function replay() {
    if (busy || cursor >= qa.fixtures.length) return;
    busy = true; update(); const item = qa.fixtures[cursor];
    qa.failure = null; qa.armed = item; const before = qa.memory.get('her-world.prologue.v3'); const count = qa.responseCount;
    qa.allowedUI = true;
    try {
      if (!byId('request-error').hidden) byId('cancel-request-button').click();
      const wasConnected = window.HerAI.connected();
      if (!wasConnected) {
        byId('ai-status-button').click(); byId('api-key').value = dummy;
        byId('connect-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
      if (item.opening && wasConnected) byId('start-button').click();
      if (!item.opening) {
        byId('free-input').value = item.input;
        byId('free-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    } finally { qa.allowedUI = false; }
    // Production event handlers perform their own asynchronous parser/commit.
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline && !qa.failure && byId('request-error').hidden && qa.memory.get('her-world.prologue.v3') === before) await new Promise(resolve => setTimeout(resolve, 10));
    const changed = qa.memory.get('her-world.prologue.v3') !== before;
    const accepted = changed && byId('request-error').hidden;
    const error = byId('request-error').hidden ? null : byId('request-error-text').textContent;
    const state = JSON.parse(qa.memory.get('her-world.prologue.v3'));
    const view = window.HerEngine.view(state);
    const verdictMatch = accepted === item.accepted && error === item.error;
    const stateMatch = !item.stateAfter || JSON.stringify(canonical(state)) === JSON.stringify(canonical(item.stateAfter));
    const success = !qa.failure && qa.responseCount === count + 1 && verdictMatch && stateMatch;
    status.textContent = `${cursor + 1}/${qa.fixtures.length} · ${accepted ? '生产解析器已接受' : '生产解析器已拒绝'} · ${success ? '与 CLI 记录一致' : '回放不一致，已停止'}${error ? ' · ' + error : ''}`;
    details.textContent = JSON.stringify({ fixture: cursor, rawSha256: item.rawSha256, accepted, verdictMatch, stateMatch, error, harnessError: qa.failure, rain: view.rain, objects: view.scene?.objects, annotations: view.scene?.annotations }, null, 2);
    qa.armed = null;
    if (success) cursor++;
    busy = !success; update(); labels();
  }
  next.addEventListener('click', replay);
  reset.addEventListener('click', () => location.reload());
  status.textContent = `${qa.fixtures.length} 条原始 GPT surrogate 输出 · 请求逐项核对 · 零上游网络 · 隔离存档`;
  update();
}

function buildPage(dir, session) {
  const production = path.join(dir, 'production');
  const read = name => fs.readFileSync(path.join(production, name), 'utf8');
  const fixtures = session.records.map(record => {
    const bytes = fs.readFileSync(path.join(dir, record.rawFile));
    if (sha(bytes) !== record.rawSha256) throw new Error(`Raw fixture changed: ${record.rawFile}`);
    return { ...record, request: JSON.parse(fs.readFileSync(path.join(dir, record.requestFile), 'utf8')), rawBase64: bytes.toString('base64') };
  });
  const safeData = JSON.stringify(fixtures).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const bootstrap = `(${installFixtureTransport.toString()})(${safeData});`;
  const scripts = [];
  let inner = read('index.html').replace(/<script\b[^>]*src="\.\/([^"?]+)(?:\?[^\"]*)?"[^>]*><\/script>/g, (_tag, name) => { scripts.push(name); return ''; });
  if (scripts.join(',') !== inspectSources(production).scripts.join(',')) throw new Error('Unexpected production script ordering');
  inner = inner.replace(/<link\b[^>]*rel="icon"[^>]*>/g, '').replace(/<link\b(?=[^>]*rel="stylesheet")(?=[^>]*href="([^"]+)")[^>]*>/g, (_tag, url) => `<style>${read(localName(url))}</style>`);
  inner = inner.replace('<head>', () => `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script>${bootstrap}</script>`);
  inner = inner.replace('<title>她的世界 · HER WORLD</title>', '<title>GPT surrogate playback · 她的世界 · 隔离测试页</title>');
  const panel = `<aside id="qa-bar"><strong>GPT SURROGATE PLAYBACK · 独立测试页</strong><p>固定 GPT 原始输出 → 真实生产解析器、状态与字符画渲染。不是实时 GLM/DMXAPI 结果。请使用下方回放按钮；无需真实访问密码。</p><div><button id="qa-next" type="button">回放</button><button id="qa-reset" type="button">重新从开场回放</button></div><p id="qa-input"></p><p id="qa-status" role="status"></p><details><summary>解析与状态检查</summary><pre id="qa-details"></pre></details></aside>`;
  inner = inner.replace('<body>', () => `<body>${panel}`);
  inner = inner.replace('</head>', `<style>html,body{height:auto;min-height:100%;overflow:auto}#qa-bar{position:relative;z-index:80;margin:12px;padding:14px;border:2px solid #e4b259;background:#122431;color:#f4e6bf;font:13px/1.5 system-ui}#qa-bar p{margin:7px 0}#qa-bar button{padding:9px 12px;margin:4px 8px 4px 0;border:1px solid #e4b259;background:#213945;color:#fff}#qa-bar button:disabled{opacity:.45}#qa-bar pre{white-space:pre-wrap;max-height:230px;overflow:auto}#qa-input{white-space:pre-wrap}#connect-dialog{visibility:hidden}body>.app{min-height:700px}</style></head>`);
  const sourceTags = scripts.map(name => { const source = read(name); if (/<\/script/i.test(source)) throw new Error(`Unsafe inline script terminator in ${name}`); return `<script data-production-file="${name}" data-sha256="${session.productionHashes[name]}">if(window.__surrogateReady){\n${source}\n}</script>`; }).join('\n');
  // A replacement string interprets $&, $` and $' from embedded source. Use a
  // callback so every production byte remains literal, including JSON paths.
  inner = inner.replace('</body>', () => `${sourceTags}<script>(${installPlaybackControls.toString()})();</script></body>`);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self' about:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>GPT surrogate playback · 隔离测试页</title><style>html,body{margin:0;width:100%;height:100%;background:#0a151b}iframe{width:100%;height:100%;border:0}</style></head><body><iframe title="GPT surrogate isolated production playback" sandbox="allow-scripts" srcdoc="${escapeAttribute(inner)}"></iframe></body></html>`;
}
module.exports = { buildPage };

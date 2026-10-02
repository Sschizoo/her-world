'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { run } = require('./surrogate-vm.cjs');
const { buildPage } = require('./surrogate-page.cjs');
const { inspectSources } = require('./surrogate-sources.cjs');
const root = path.resolve(__dirname, '../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

test('capture executes real opening UI and emits body without headers or credentials', async () => {
  const result = await run({ sourceDir: root, state: null, pending: { opening: true, input: '' } });
  assert.equal(result.body.model, 'glm-5.3-flash');
  assert.equal(result.body.messages.length, 2);
  assert.equal(result.body.messages[0].role, 'system');
  const payload = JSON.parse(result.body.messages[1].content);
  assert.equal(payload.world.rain.created, false);
  assert.equal(payload.guidance.id, 'rain_description');
  assert.equal(payload.playerSaid, '');
  assert.equal(result.state.started, false);
  assert.deepEqual(result.state.events, []);
  assert.equal(result.accepted, false);
  assert(!JSON.stringify(result.body).includes('DUMMY'));
  assert(!Object.hasOwn(result.body, 'headers'));
  assert(!JSON.stringify(result.state).includes('DUMMY'));
});

test('actual app submit supplies the unified turn context without legacy request mapping', async () => {
  const engine = require(path.join(root, 'engine.js'));
  // An empty opening is engine-created setup, never a fabricated model output.
  const state = engine.start(engine.create());
  const input = '在窗边放一张能坐两个人的长椅';
  const result = await run({ sourceDir: root, state, pending: { opening: false, input } });
  const payload = JSON.parse(result.body.messages.at(-1).content);
  assert.deepEqual(Object.keys(payload), ['task', 'playerSaid', 'context']);
  assert.equal(payload.playerSaid, input);
  assert(payload.context.sceneContext);
  assert(payload.context.memoryContext);
  assert.equal(payload.context.rain.created, false);
  assert(!Object.hasOwn(payload, 'allowedActions'));
  assert.equal(result.accepted, false);
  assert.deepEqual(result.state, state);
});

test('standalone page contains exact trusted sources inside isolated network-blocked frame', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'her-world-harness-'));
  try {
    fs.mkdirSync(path.join(dir, 'production'));
    const names = inspectSources(root).files;
    const productionHashes = {};
    for (const name of names) { const bytes = fs.readFileSync(path.join(root, name)); fs.writeFileSync(path.join(dir, 'production', name), bytes); productionHashes[name] = sha(bytes); }
    const html = buildPage(dir, { productionHashes, records: [] });
    assert.match(html, /sandbox="allow-scripts"/);
    assert.equal(html.match(/sandbox="([^"]+)"/)[1], 'allow-scripts');
    const srcdoc = html.match(/srcdoc="([\s\S]*)"><\/iframe>/)[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.match(srcdoc, /connect-src 'none'/);
    assert(!/<script\b[^>]*src=/.test(srcdoc));
    assert(!/<link\b/.test(srcdoc));
    assert.match(srcdoc, /Object\.defineProperty\(window, 'localStorage'/);
    assert.match(srcdoc, /Object\.defineProperty\(window, 'fetch'/);
    assert.match(srcdoc, /readOnly = true/);
    const scripts = [...srcdoc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, inspectSources(root).scripts.length + 2);
    for (const [, attributes, source] of scripts) {
      new vm.Script(source);
      const file = attributes.match(/data-production-file="([^"]+)"/)?.[1];
      if (file) assert(source.includes(fs.readFileSync(path.join(root, file), 'utf8')), `${file} must be unchanged`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

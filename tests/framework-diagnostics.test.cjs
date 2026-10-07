'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../framework/runtime.js');
const PACKS = require('../framework/packs.js');
const VALIDATOR = require('../framework/pack-validator.js');
const UI = require('../framework/app.js');
const clone = value => JSON.parse(JSON.stringify(value));
const secret = 'sk-TEST_ONLY_NEVER_ECHO_987654321';
const panel = () => ({ type: 'panel.open', panel: 'world' });
const beat = (afterLine = 0, operations = [panel()]) => ({ afterLine, operations });
const plan = (beats = [beat()], lines = ['第一句。', '第二句。', '第三句。', '第四句。']) => ({ schema: 'her-world-turn-v2', lines, beats, topic: null });
const fresh = () => R.create(PACKS.get('rain-lab'));
const commit = (value, state = fresh(), input = '请在窗边放一盏灯。') => R.commit(state, R.propose(state, { text: input }), value);
const expected = (reason, path, more = {}) => ({ stage: 'RUNTIME', reason, path, ...more });

const beatCases = [
  ['array required', { [secret]: secret }, 'BEATS_ARRAY_REQUIRED', 'beats'],
  ['array limit', Array.from({ length: 5 }, () => beat()), 'BEATS_LIMIT', 'beats'],
  ['unknown field', [{ ...beat(), [secret]: secret }], 'BEAT_FIELDS', 'beats[0]', 0],
  ['missing field', [{ afterLine: 0 }], 'BEAT_FIELDS', 'beats[0]', 0],
  ['null beat', [null], 'BEAT_FIELDS', 'beats[0]', 0],
  ['index type', [beat(secret)], 'BEAT_LINE_INTEGER', 'beats[0].afterLine', 0],
  ['index fraction', [beat(0.5)], 'BEAT_LINE_INTEGER', 'beats[0].afterLine', 0],
  ['index negative', [beat(-1)], 'BEAT_LINE_RANGE', 'beats[0].afterLine', 0],
  ['index beyond lines', [beat(4)], 'BEAT_LINE_RANGE', 'beats[0].afterLine', 0],
  ['duplicate line', [beat(0), beat(0)], 'BEAT_LINE_ORDER', 'beats[1].afterLine', 1],
  ['descending line', [beat(1), beat(0)], 'BEAT_LINE_ORDER', 'beats[1].afterLine', 1],
  ['operations type', [beat(0, { [secret]: secret })], 'BEAT_OPERATIONS_ARRAY', 'beats[0].operations', 0],
  ['empty operations', [beat(0, [])], 'BEAT_OPERATIONS_EMPTY', 'beats[0].operations', 0],
  ['last beat index', [beat(0), beat(1), beat(2), beat(3, [])], 'BEAT_OPERATIONS_EMPTY', 'beats[3].operations', 3]
];
for (const [name, beats, reason, at, beatIndex] of beatCases) test('safe beat diagnostic: ' + name, () => {
  const state = fresh(), value = plan(beats), stateBefore = JSON.stringify(state), planBefore = JSON.stringify(value);
  const result = commit(value, state);
  assert.deepEqual(result, { ok: false, error: { code: 'BEATS_INVALID', path: '$', diagnostic: expected(reason, at, beatIndex === undefined ? {} : { beatIndex }) } });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(state), stateBefore);
  assert.equal(JSON.stringify(value), planBefore);
});

test('beat diagnostics preserve the original acceptance predicate over malformed and boundary inputs', () => {
  // Independent reference: the complete pre-diagnostic beat gate, unchanged.
  function acceptedBefore(value) {
    if (!(Array.isArray(value.beats) && value.beats.length <= 4)) return false;
    const lines = new Set(); let count = 0, last = -1;
    for (const item of value.beats) {
      if (!(VALIDATOR.fields(item, ['afterLine', 'operations']) && Number.isInteger(item.afterLine) && item.afterLine >= 0 && item.afterLine < value.lines.length && item.afterLine > last && !lines.has(item.afterLine) && Array.isArray(item.operations) && item.operations.length > 0)) return false;
      lines.add(item.afterLine); last = item.afterLine; count += item.operations.length;
    }
    return count <= 12;
  }
  const candidates = [[], null, {}, secret, ...beatCases.map(item => item[1])];
  for (const line of [-1, 0, 1, 2, 3, 4, 0.5, '0', null, false]) {
    candidates.push([beat(line)]);
    for (const other of [0, 1, 2, 3]) candidates.push([beat(line), beat(other)]);
  }
  for (const count of [0, 1, 11, 12, 13]) candidates.push([beat(0, Array.from({ length: count }, panel))]);
  const state = fresh(), before = JSON.stringify(state);
  for (let lineCount = 1; lineCount <= 4; lineCount++) for (const beats of candidates) {
    const value = plan(beats, Array.from({ length: lineCount }, () => '一句话。'));
    assert.equal(commit(value, state).ok, acceptedBefore(value), JSON.stringify(value));
    assert.equal(JSON.stringify(state), before);
  }
});

test('operation diagnostics only expose bounded coordinates and registered type names', () => {
  const state = fresh(), before = JSON.stringify(state);
  for (const [op, code, type] of [
    [{ ...panel(), [secret]: secret }, 'OPERATION_INVALID', 'panel.open'],
    [{ type: secret, [secret]: secret }, 'OPERATION_INVALID', undefined],
    [{ type: 'constructor', [secret]: secret }, 'OPERATION_INVALID', undefined],
    [null, 'PLAN_INVALID', undefined],
    [{ type: 'world.remove', target: secret }, 'TARGET_MISSING', 'world.remove'],
    [{ type: 'memory.remove', id: 'memory_999' }, 'MEMORY_HANDLE_INVALID', 'memory.remove']
  ]) {
    const value = plan([beat(0, [panel(), op])]), original = JSON.stringify(value), result = commit(value, state);
    assert.equal(result.ok, false); assert.equal(result.error.code, code);
    assert.deepEqual(result.error.diagnostic, expected('OPERATION_REJECTED', 'beats[0].operations[1]', { beatIndex: 0, operationIndex: 1, ...(type ? { operationType: type } : {}) }));
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(value), original); assert.equal(JSON.stringify(state), before);
  }
  const atLimit = commit(plan([beat(0), beat(1), beat(2), beat(3, [...Array.from({ length: 8 }, panel), { type: secret }])]), state);
  assert.equal(atLimit.error.diagnostic.beatIndex, 3); assert.equal(atLimit.error.diagnostic.operationIndex, 8);
  const last = commit(plan([beat(0, [...Array.from({ length: 11 }, panel), { type: secret }])]), state);
  assert.equal(last.error.diagnostic.operationIndex, 11);
  const tooMany = commit(plan([beat(0, [...Array.from({ length: 12 }, panel), { type: secret }])]), state);
  assert.deepEqual(tooMany, { ok: false, error: { code: 'OPERATION_CAPACITY', path: '$' } });
});

test('evidence reasons distinguish a current-input excerpt without exposing or accepting it', () => {
  const input = '请在窗边放一盏灯。', state = fresh(), before = JSON.stringify(state);
  for (const [evidence, reason] of [['窗边', 'EVIDENCE_INPUT_EXCERPT'], [secret, 'EVIDENCE_INPUT_MISMATCH'], ['请在窗边放一盏灯', 'EVIDENCE_INPUT_EXCERPT']]) {
    const value = plan([beat(0, [{ type: 'character.update', changes: { mood: secret }, evidence }])]);
    const result = commit(value, state, input);
    assert.equal(result.error.code, 'EVIDENCE_INVALID');
    assert.deepEqual(result.error.diagnostic, expected(reason, 'beats[0].operations[0].evidence', { beatIndex: 0, operationIndex: 0, operationType: 'character.update' }));
    assert.equal(JSON.stringify(result).includes(secret), false); assert.equal(JSON.stringify(result).includes(input), false);
    assert.equal(JSON.stringify(state), before);
  }
  for (const evidence of [undefined, input]) {
    const op = { type: 'character.update', changes: { mood: '安静' }, ...(evidence === undefined ? {} : { evidence }) };
    const value = plan([beat(0, [op])]), unchanged = clone(value), result = commit(value, state, input);
    assert.equal(result.ok, true); assert.equal(result.diagnostic, undefined); assert.deepEqual(value, unchanged);
    const saved = R.serialize(result.state), restored = R.restore(saved, PACKS.get('rain-lab'));
    assert.equal(restored.ok, true); assert.deepEqual(R.serialize(restored.state), saved);
    assert.deepEqual(R.view(restored.state), R.view(result.state));
    assert.deepEqual(R.view(restored.state, { event: 0, line: 0 }), result.frames[0]);
    assert.equal(JSON.stringify(saved).includes('diagnostic'), false);
  }
});

test('a later invalid operation leaves world, memory, logs, transcript, recall and save unchanged', () => {
  const state = fresh(), before = JSON.stringify(state), saveBefore = JSON.stringify(R.serialize(state));
  const value = plan([beat(0, [{ type: 'world.create', object: { label: '灯', glyphs: '[]', x: 5, y: 10, scale: 1 } }]), beat(2, [{ type: 'memory.upsert', id: 'note_lamp', title: '灯', body: '看灯' }, { type: 'world.remove', target: secret }])]);
  const result = commit(value, state);
  assert.equal(result.ok, false); assert.equal(result.state, undefined); assert.equal(result.frames, undefined);
  assert.deepEqual(result.error.diagnostic, expected('OPERATION_REJECTED', 'beats[1].operations[1]', { beatIndex: 1, operationIndex: 1, operationType: 'world.remove' }));
  assert.equal(JSON.stringify(state), before); assert.equal(JSON.stringify(R.serialize(state)), saveBefore);
});

// Small DOM harness for the real app boundary; no browser, storage or network IO.
class Element {
  constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), children: [], dataset: {}, style: {}, attrs: {}, events: {}, value: '', hidden: false, disabled: false, open: false, _text: '', className: '', scrollHeight: 100 }); this.classList = { toggle() {} }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  async emit(name) { for (const fn of this.events[name] || []) await fn({ preventDefault() {}, target: this }); }
}
function ui(request, runtime = R) {
  const ids = {}, all = [], html = fs.readFileSync(path.join(__dirname, '../framework.html'), 'utf8'), store = new Map();
  for (const match of html.matchAll(/<(\w+)\b([^>]*)>/g)) {
    const node = new Element(match[1]);
    for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) { if (attr[1] === 'id') ids[attr[2]] = node; if (attr[1].startsWith('data-')) node.dataset[attr[1].slice(5)] = attr[2]; }
    all.push(node);
  }
  const document = { getElementById: id => ids[id], createElement: tag => new Element(tag), querySelectorAll: () => all.filter(node => node.dataset.close) };
  let connected = false;
  const model = { connect: () => connected = true, connected: () => connected, disconnect: () => connected = false, calls: () => 0, request };
  const window = { document, location: { search: '', href: 'http://localhost/framework.html' }, matchMedia: () => ({ matches: true, addEventListener() {} }), setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {} };
  const app = UI.create({ window, document, runtime, packs: PACKS, model, storage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) } });
  return { app, ids, store, async send() { ids['api-key'].value = 'TEST_ONLY_PASSWORD'; await ids['connect-form'].emit('submit'); const before = app.snapshot().state; await app.submit('请在窗边放一盏灯。'); assert.equal(app.snapshot().state, before); assert.equal(store.size, 0); return app.snapshot().lastFailure; } };
}

test('runtime failure detail reaches the developer view without displaying rejected response content', async () => {
  const value = plan([beat(0, [{ type: 'character.update', changes: { mood: secret }, evidence: '窗边' }])], [secret]);
  const r = ui(async () => value), failure = await r.send();
  assert.deepEqual(failure, { code: 'invalid', rule: 'EVIDENCE_INVALID', ...expected('EVIDENCE_INPUT_EXCERPT', 'beats[0].operations[0].evidence', { beatIndex: 0, operationIndex: 0, operationType: 'character.update' }) });
  assert.match(r.ids['developer-content'].textContent, /EVIDENCE_INPUT_EXCERPT/);
  for (const id of ['developer-content', 'request-error-text', 'transcript']) assert.equal(r.ids[id].textContent.includes(secret), false);
  assert.match(r.ids['request-error-text'].textContent, /没有保存或改变/);
});

test('app independently whitelists runtime reason, bounded path, coordinates and operation type', async () => {
  const safe = expected('OPERATION_REJECTED', 'beats[3].operations[11]', { beatIndex: 3, operationIndex: 11, operationType: 'world.create' });
  for (const change of [
    { stage: secret }, { reason: secret }, { reason: 'constructor' }, { path: secret },
    { path: 'beats[03].operations[11]' }, { path: 'beats[3].operations[11].' + secret },
    { beatIndex: '3' }, { beatIndex: -1 }, { beatIndex: 4 }, { beatIndex: 0.5 },
    { operationIndex: '11' }, { operationIndex: -1 }, { operationIndex: 12 }, { operationIndex: Infinity },
    { reason: 'BEAT_FIELDS' }, { reason: 'EVIDENCE_INPUT_MISMATCH' }
  ]) {
    const diagnostic = { ...safe, ...change, [secret]: secret };
    const r = ui(async () => { throw { code: 'invalid', ruleCode: 'OPERATION_INVALID', diagnostic, message: secret }; });
    assert.deepEqual(await r.send(), { code: 'invalid', rule: 'OPERATION_INVALID' });
    assert.equal(r.ids['developer-content'].textContent.includes(secret), false);
  }
  for (const operationType of [secret, 'constructor', null, {}, ['world.create']]) {
    const r = ui(async () => { throw { code: 'invalid', ruleCode: 'OPERATION_INVALID', diagnostic: { ...safe, operationType, [secret]: secret } }; });
    const failure = await r.send();
    assert.equal(failure.reason, 'OPERATION_REJECTED'); assert.equal(failure.operationType, undefined);
    assert.equal(JSON.stringify(failure).includes(secret), false);
  }
  const r = ui(async () => { throw { code: 'invalid', ruleCode: secret, diagnostic: safe }; });
  assert.deepEqual(await r.send(), { code: 'invalid' });
});

test('app accepts only internally consistent beat diagnostic paths and ignores extra metadata', async () => {
  for (const [, , reason, at, beatIndex] of beatCases) {
    const diagnostic = expected(reason, at, beatIndex === undefined ? {} : { beatIndex });
    const r = ui(async () => { throw { code: 'invalid', ruleCode: 'BEATS_INVALID', diagnostic: { ...diagnostic, [secret]: secret, operationType: secret, message: secret } }; });
    assert.deepEqual(await r.send(), { code: 'invalid', rule: 'BEATS_INVALID', ...diagnostic });
    assert.equal(r.ids['developer-content'].textContent.includes(secret), false);
  }
  for (const diagnostic of [expected('BEAT_FIELDS', 'beats[0]', { beatIndex: 1 }), expected('BEAT_LINE_RANGE', 'beats[0].operations', { beatIndex: 0 }), expected('EVIDENCE_INPUT_EXCERPT', 'beats[0].operations[0]', { beatIndex: 0, operationIndex: 0 })]) {
    const r = ui(async () => { throw { code: 'invalid', ruleCode: diagnostic.reason.startsWith('EVIDENCE') ? 'EVIDENCE_INVALID' : 'BEATS_INVALID', diagnostic }; });
    const failure = await r.send(); assert.equal(failure.reason, undefined); assert.equal(failure.path, undefined);
  }
});

test('injected runtime error metadata is filtered again before the app displays it', async () => {
  const runtime = { ...R, commitModel: () => ({ ok: false, error: { code: 'BEATS_INVALID', path: secret, diagnostic: expected(secret, secret, { [secret]: secret }) } }) };
  const r = ui(async () => plan(), runtime);
  assert.deepEqual(await r.send(), { code: 'invalid', rule: 'BEATS_INVALID' });
  assert.equal(r.ids['developer-content'].textContent.includes(secret), false);
});

test('sentence adapter diagnostics display only the six fixed transport codes and existing paths', async () => {
  for (const code of ['TURN_ROOT_FIELDS', 'TURN_LINES_INVALID', 'TURN_ROW_FIELDS', 'TURN_ROW_TEXT', 'TURN_ROW_OPERATIONS', 'TURN_OPERATION_LIMIT']) {
    const r = ui(async () => { throw { code: 'format', diagnostic: { stage: 'FINAL_CONTENT', code, path: 'root', reason: secret, [secret]: secret }, message: secret }; });
    assert.deepEqual(await r.send(), { code: 'format', stage: 'FINAL_CONTENT', detail: code, path: 'root' });
    assert.equal(r.ids['developer-content'].textContent.includes(secret), false);
  }
});

test('app accepts row location only with a matching fixed JSON row diagnostic', async () => {
  for (const rowIndex of [0,1,2,3]) {
    const r=ui(async()=>{throw {code:'format',diagnostic:{stage:'JSON',code:'TURN_ROW_FIELDS',path:'content',rowIndex,detail:secret}};});
    assert.deepEqual(await r.send(),{code:'format',stage:'JSON',detail:'TURN_ROW_FIELDS',path:'content',rowIndex});
  }
  for (const change of [{rowIndex:'0'},{rowIndex:-1},{rowIndex:4},{rowIndex:Infinity},{rowIndex:secret},{code:'ROOT_INVALID'},{path:'root'},{stage:'FINAL_CONTENT'}]) {
    const r=ui(async()=>{throw {code:'format',diagnostic:{stage:'JSON',code:'TURN_ROW_FIELDS',path:'content',rowIndex:1,...change}};});
    const result=await r.send();assert.equal(result.rowIndex,undefined);assert(!JSON.stringify(result).includes(secret));
  }
});

test('report-source diagnostics expose only fixed categories and bounded row positions', async () => {
  for(const code of ['REPORT_SUPPORT_REQUIRED','REPORT_SUPPORT_INVALID','REPORT_SUPPORT_AMBIGUOUS']){
    const r=ui(async()=>{throw {code:'format',diagnostic:{stage:'JSON',code,path:'content',rowIndex:1,quote:secret},message:secret};});
    assert.deepEqual(await r.send(),{code:'format',stage:'JSON',detail:code,path:'content',rowIndex:1});
    assert(!r.ids['developer-content'].textContent.includes(secret));
    for(const rowIndex of [-1,4,'1',secret]){
      const forged=ui(async()=>{throw {code:'format',diagnostic:{stage:'JSON',code,path:'content',rowIndex}};});
      const value=await forged.send();assert.equal(value.rowIndex,undefined);assert(!JSON.stringify(value).includes(secret));
    }
  }
});

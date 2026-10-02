/* Test-only UI adapter: executes unchanged production app.js and ai.js.
 * The canvas is observed through setObjects here; the generated playback page
 * executes the real world.js canvas renderer in an ordinary browser document.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { inspectSources } = require('./surrogate-sources.cjs');

class Element {
  constructor(tag = 'div') {
    Object.assign(this, { tagName: tag.toUpperCase(), children: [], dataset: {}, events: {}, style: {}, attrs: {}, hidden: false, disabled: false, value: '', _text: '', className: '', scrollHeight: 1000, open: false });
    this.classList = { toggle: (name, on) => { const names = new Set(this.className.split(' ').filter(Boolean)); on ? names.add(name) : names.delete(name); this.className = [...names].join(' '); } };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (let child of nodes) { if (typeof child === 'string') child = Object.assign(new Element('text'), { textContent: child }); if (child.parent) child.remove(); child.parent = this; this.children.push(child); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  querySelector(selector) { return selector === 'button:not(:disabled)' ? this.children.flatMap(child => [child, ...child.children]).find(child => child.tagName === 'BUTTON' && !child.disabled) : null; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  focus() { this.focused = true; }
  async emit(name, event = {}) { if (name === 'click' && this.disabled) return; await Promise.all((this.events[name] || []).map(callback => callback({ preventDefault() {}, ...event }))); await new Promise(resolve => setImmediate(resolve)); }
  showModal() { this.open = true; }
  close() { this.open = false; for (const callback of this.events.close || []) callback({}); }
}

async function run({ sourceDir, state, pending, raw }) {
  const read = name => fs.readFileSync(path.join(sourceDir, name), 'utf8');
  const sources = inspectSources(sourceDir);
  const ids = {}, all = [];
  for (const match of read('index.html').matchAll(/<(\w+)\b([^>]*)>/g)) {
    const node = new Element(match[1]), attributes = match[2];
    for (const attribute of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) {
      const [, name, value] = attribute;
      node.attrs[name] = value;
      if (name === 'id') { node.id = value; ids[value] = node; }
      if (name === 'class') node.className = value;
      if (name.startsWith('data-')) node.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    node.hidden = /\bhidden\b/.test(attributes); all.push(node);
  }
  const walk = node => [node, ...node.children.flatMap(walk)];
  const document = {
    documentElement: new Element('html'), getElementById: id => ids[id], createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }),
    querySelectorAll(selector) { const pool = [...new Set([...all, ...Object.values(ids).flatMap(walk)])]; return pool.filter(node => selector === '[data-close]' ? node.dataset.close : selector === '[data-topic]' ? node.dataset.topic : selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : false); },
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  };
  const storage = new Map(state ? [['her-world.prologue.v3', JSON.stringify(state)]] : []);
  let requestBody = null, requestCount = 0, worldObjects = [], settled = false;
  const timers = new Set();
  const window = { matchMedia: () => ({ matches: true, addEventListener() {} }), addEventListener() {} };
  const context = vm.createContext({
    window, document, AbortController, TextEncoder, TextDecoder,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => storage.delete(key) },
    setTimeout(callback, delay) { const id = setTimeout(callback, delay); id.unref?.(); timers.add(id); return id; }, clearTimeout,
    requestAnimationFrame: callback => callback(),
    fetch: async (_url, options) => {
      if (++requestCount !== 1) throw new Error('Fixture harness permits exactly one request per step');
      // Capture only the JSON body. Never retain request headers or the dummy key.
      requestBody = JSON.parse(options.body);
      if (raw === undefined) throw new Error('Capture only: no fixture supplied');
      return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  try {
    for (const name of sources.scripts.filter(name => !['world.js', 'app.js'].includes(name))) vm.runInContext(read(name), context, { filename: name });
    context.HerAI = window.HerAI;
    context.HerWorld = window.HerWorld = { setProgress() {}, setRain() {}, setObjects(objects) { worldObjects = JSON.parse(JSON.stringify(objects)); }, pause() {} };
    vm.runInContext(read('app.js'), context, { filename: 'app.js' });
    // Observe engine completion without replacing any production decisions.
    const initial = storage.get('her-world.prologue.v3');
    await ids['ai-status-button'].emit('click');
    ids['api-key'].value = 'GPT_SURROGATE_DUMMY_NEVER_A_REAL_KEY';
    await ids['connect-form'].emit('submit');
    if (!pending.opening) {
      ids['free-input'].value = pending.input;
      await ids['free-form'].emit('submit');
    }
    for (let count = 0; count < 100 && !settled; count++) {
      await new Promise(resolve => setImmediate(resolve));
      settled = requestBody !== null && (!ids['request-error'].hidden || storage.get('her-world.prologue.v3') !== initial);
    }
    if (!requestBody) throw new Error('Production UI made no request. Input may be invalid or the step is unavailable.');
    const saved = JSON.parse(storage.get('her-world.prologue.v3'));
    const view = window.HerEngine.view(saved);
    return { body: requestBody, state: saved, view: JSON.parse(JSON.stringify(view)), objects: worldObjects, accepted: storage.get('her-world.prologue.v3') !== initial && ids['request-error'].hidden, error: ids['request-error'].hidden ? null : ids['request-error-text'].textContent, transcript: ids.transcript.textContent };
  } finally { window.HerAI?.disconnect(); for (const timer of timers) clearTimeout(timer); }
}

module.exports = { run };

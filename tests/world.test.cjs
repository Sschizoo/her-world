const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../world.js'), 'utf8');
function runtime() {
  let lastWarmth = 0, draws = 0, frameId = 0;
  const frames = new Map(), listeners = {};
  const ctx = new Proxy({
    clearRect() { draws++; },
    createRadialGradient(...coordinates) { return { addColorStop(offset, color) { if (coordinates[0] === 270 && offset === 0) lastWarmth = Number(color.match(/,([.\d]+)\)$/)[1]); } }; }
  }, { get(object, key) { return key in object ? object[key] : () => {}; }, set(object, key, value) { object[key] = value; return true; } });
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 680, height: 660 }) };
  const document = { hidden: false, getElementById: () => canvas };
  const window = { devicePixelRatio: 1, addEventListener(type, fn) { listeners[type] = fn; } };
  vm.runInNewContext(source, { window, document, ResizeObserver: class { observe() {} }, requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); } });
  return { world: window.HerWorld, document, listeners, warmth: () => lastWarmth, draws: () => draws, queued: () => frames.size, tick(time) { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(time); } };
}
test('world warmth moves gradually toward the new story state', () => {
  const r = runtime(); r.world.setProgress(1); assert.equal(r.warmth(), .035);
  r.tick(100); assert(r.warmth() > .035 && r.warmth() < .07);
  for (let i = 2; i < 50; i++) r.tick(i * 100);
  assert(r.warmth() > .069 && r.warmth() < .07);
});
test('pause/reduced-motion settles the scene immediately and stops animation paints', () => {
  const r = runtime(); r.world.setProgress(1); r.world.setRain('heavy_rain'); r.world.pause(true); assert.equal(r.warmth(), .07);
  const paints = r.draws(); r.tick(100); assert.equal(r.draws(), paints);
  r.world.setRain('pause_rain'); assert(r.draws() > paints);
});
test('background tabs pause paints and bfcache restore restarts one loop', () => {
  const r = runtime(); const paints = r.draws(); r.document.hidden = true; r.tick(100); assert.equal(r.draws(), paints);
  r.listeners.pagehide(); assert.equal(r.queued(), 0); r.listeners.pageshow({ persisted: true }); assert.equal(r.queued(), 1);
});

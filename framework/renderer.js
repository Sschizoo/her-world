/* Deterministic character animation. This module has no network or model access. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFrameworkRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DURATION = 720, WEATHER_DURATION = 600, MAX_OBJECTS = 8, MAX_EXITING = 8;
  const PARTICLE_KINDS = new Set(['rain', 'snow', 'mist']);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const ease = value => value * value * (3 - 2 * value);
  const mix = (a, b, value) => a + (b - a) * value;
  function ascii(value) { return String(value || '').replace(/[^\x20-\x7e\n]/g, ''); }
  function create(canvas, options) {
    options = options || {};
    const win = options.window || (typeof window !== 'undefined' ? window : {});
    const raf = options.requestAnimationFrame || (win.requestAnimationFrame && win.requestAnimationFrame.bind(win));
    const caf = options.cancelAnimationFrame || (win.cancelAnimationFrame && win.cancelAnimationFrame.bind(win));
    const ctx = canvas && canvas.getContext && canvas.getContext('2d');
    const objects = new Map();
    let world = null, signature = '', packKey = null, destroyed = false, suspended = false;
    let reduced = options.reducedMotion === undefined ? !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) : !!options.reducedMotion;
    let frame = null, loopGeneration = 0, lastTime = null, rainTime = 0, exitSerial = 0;
    let weather = { value: 0, from: 0, target: 0, elapsed: WEATHER_DURATION, kind: 'rain' };
    function animated() { return !!(raf && caf && !reduced); }
    function intensity(value) { return value && PARTICLE_KINDS.has(value.kind) && !value.paused ? clamp(Number(value.intensity) || 0, 0, 3) : 0; }
    function moving() { return [...objects.values()].some(item => item.elapsed < DURATION) || weather.elapsed < WEATHER_DURATION; }
    function stopLoop() {
      loopGeneration++;
      if (frame !== null && caf) caf(frame);
      frame = null; lastTime = null;
    }
    function settle() {
      objects.forEach((item, id) => {
        if (item.removing) { objects.delete(id); return; }
        item.current = { ...item.target }; item.from = { ...item.target }; item.elapsed = DURATION; item.oldGlyphs = null;
      });
      weather.value = weather.target; weather.from = weather.target; weather.elapsed = WEATHER_DURATION;
    }
    function advance(dt) {
      rainTime += dt / 1000;
      objects.forEach((item, id) => {
        if (item.elapsed >= DURATION) return;
        item.elapsed = Math.min(DURATION, item.elapsed + dt);
        const progress = ease(item.elapsed / DURATION);
        for (const key of ['x', 'y', 'scale', 'alpha']) item.current[key] = mix(item.from[key], item.target[key], progress);
        if (item.elapsed === DURATION) {
          if (item.removing) objects.delete(id);
          else { item.current = { ...item.target }; item.oldGlyphs = null; }
        }
      });
      if (weather.elapsed < WEATHER_DURATION) {
        weather.elapsed = Math.min(WEATHER_DURATION, weather.elapsed + dt);
        weather.value = mix(weather.from, weather.target, ease(weather.elapsed / WEATHER_DURATION));
      }
    }
    function ensureLoop() {
      if (destroyed || suspended || !animated() || !ctx || !world || frame !== null || (!moving() && weather.value <= 0)) return;
      const ticket = loopGeneration;
      frame = raf(timestamp => {
        if (ticket !== loopGeneration || destroyed || suspended || !animated()) return;
        frame = null;
        const dt = lastTime === null ? 0 : clamp(timestamp - lastTime, 0, 50);
        lastTime = timestamp;
        advance(dt); draw(); ensureLoop();
        if (frame === null) lastTime = null;
      });
    }
    function draw() {
      if (!ctx || !world || destroyed || suspended) return;
      const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 600, height: 360 };
      const width = Math.max(1, box.width || 600), height = Math.max(1, box.height || 360);
      const ratio = Math.min(2, win.devicePixelRatio || 1);
      const physicalWidth = Math.round(width * ratio), physicalHeight = Math.round(height * ratio);
      if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
      if (canvas.height !== physicalHeight) canvas.height = physicalHeight;
      if (ctx.setTransform) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const grid = world.grid || { cols: 100, rows: 60 };
      const cols = grid.cols || 100, rows = grid.rows || 60;
      const cell = Math.min(width / (cols + 10), height / (rows * 1.3 + 15));
      const line = cell * 1.3, left = (width - cols * cell) / 2, top = (height - rows * line) / 2;
      ctx.fillStyle = '#aab2b7'; ctx.textBaseline = 'top'; ctx.globalAlpha = 1;
      function glyphs(item, opacity = 1, marks = item && item.glyphs) {
        if (!item || opacity <= 0) return;
        const scale = clamp(Number(item.scale) || 1, .5, 3);
        ctx.font = `${cell * 1.65 * scale}px "SFMono-Regular",Consolas,"Liberation Mono",monospace`;
        ctx.globalAlpha = clamp(opacity, 0, 1);
        const rowsOfMarks = ascii(marks).split('\n');
        const footprintWidth = Math.max(0, ...rowsOfMarks.map(row => row.length)) * scale;
        const footprintHeight = rowsOfMarks.length * scale;
        // Each crossfade layer has its own footprint. Keep it inside the grid
        // while origins and scale interpolate; valid settled geometry is unchanged.
        const logicalX = clamp(Number(item.x) || 0, 0, Math.max(0, cols - footprintWidth));
        const logicalY = clamp(Number(item.y) || 0, 0, Math.max(0, rows - footprintHeight));
        const x = left + logicalX * cell, y = top + logicalY * line;
        rowsOfMarks.forEach((row, index) => {
          for (let c = 0; c < row.length; c++) if (row[c] !== ' ') ctx.fillText(row[c], x + c * cell * scale, y + index * line * scale);
        });
        ctx.globalAlpha = 1;
      }
      ctx.font = `${cell * 1.65}px "SFMono-Regular",Consolas,"Liberation Mono",monospace`;
      const count = PARTICLE_KINDS.has(weather.kind) ? weather.value * 36 : 0;
      const mark = weather.kind === 'snow' ? '*' : weather.kind === 'mist' ? '.' : '|';
      const travel = Math.max(1, rows - 8);
      for (let n = 0; n < Math.ceil(count); n++) {
        // Particle phases and velocities depend only on index and local animation time.
        const speed = weather.kind === 'snow' ? 3 + n % 3 : weather.kind === 'mist' ? 1 : 15 + n % 7;
        const x = (n * 37 + 13) % cols, y = ((n * 23 + 11) + rainTime * speed) % travel;
        ctx.globalAlpha = clamp(count - n, 0, 1);
        ctx.fillText(mark, left + x * cell, top + y * line);
      }
      ctx.globalAlpha = 1;
      const landmarks = Array.isArray(world.landmarks) ? world.landmarks.map((item, i) => [String(i), item]) : Object.entries(world.landmarks || {});
      landmarks.forEach(([id, item]) => {
        if (item.glyphs) { glyphs(item); return; }
        if (id === 'sky') return;
        const w = Math.max(1, Math.min(cols, Math.round(item.width || 1))), h = Math.max(1, Math.min(rows, Math.round(item.height || 1)));
        let shape;
        if (h === 1) shape = '_'.repeat(w);
        else if (w === 1) shape = Array(h).fill('|').join('\n');
        else {
          const cap = '+' + '-'.repeat(w - 2) + '+';
          shape = [cap, ...Array(h - 2).fill('|' + ' '.repeat(w - 2) + '|'), cap].join('\n');
        }
        glyphs({ ...item, glyphs: shape });
      });
      objects.forEach(item => {
        const blend = item.oldGlyphs ? ease(item.elapsed / DURATION) : 1;
        if (item.oldGlyphs) glyphs(item.current, item.current.alpha * (1 - blend), item.oldGlyphs);
        glyphs(item.current, item.current.alpha * blend, item.target.glyphs);
      });
    }
    function update(next) {
      if (destroyed) return false;
      const candidate = next && next.world ? next.world : next;
      const incomingPack = next && next.pack ? next.pack.id + '@' + next.pack.version : null;
      const nextSignature = JSON.stringify({ pack: incomingPack, world: candidate || {} });
      if (signature === nextSignature) return false;
      const fresh = !world || incomingPack !== packKey;
      signature = nextSignature; packKey = incomingPack; world = candidate || {};
      if (fresh) { stopLoop(); objects.clear(); rainTime = 0; }
      const targets = new Map((Array.isArray(world.objects) ? world.objects : []).slice(0, MAX_OBJECTS).map((object, index) => [object.id || 'object_' + index, object]));
      targets.forEach((object, id) => {
        const target = { ...object, x: Number(object.x) || 0, y: Number(object.y) || 0, scale: Number(object.scale) || 1, alpha: 1 };
        let track = objects.get(id);
        if (!track) {
          const from = { ...target, alpha: fresh || !animated() ? 1 : 0 };
          track = { current: { ...from }, from, target, elapsed: fresh || !animated() ? DURATION : 0, removing: false, oldGlyphs: null, departedAt: null };
          objects.set(id, track);
        } else if (track.removing || ['x', 'y', 'scale', 'glyphs'].some(key => target[key] !== track.target[key])) {
          const oldGlyphs = track.target.glyphs !== target.glyphs ? (track.oldGlyphs && track.elapsed < DURATION / 2 ? track.oldGlyphs : track.target.glyphs) : null;
          track.from = { ...track.current }; track.target = target; track.elapsed = 0; track.removing = false; track.oldGlyphs = oldGlyphs; track.departedAt = null;
        }
      });
      objects.forEach((track, id) => {
        if (targets.has(id) || track.removing) return;
        track.from = { ...track.current }; track.target = { ...track.current, glyphs: track.target.glyphs, alpha: 0 }; track.elapsed = 0; track.removing = true; track.oldGlyphs = null; track.departedAt = ++exitSerial;
      });
      // Current objects and departures have separate bounds. Discard unseen
      // departures immediately, including updates received while suspended.
      objects.forEach((track, id) => { if (track.removing && track.current.alpha <= 0) objects.delete(id); });
      const exiting = [...objects.entries()].filter(([, track]) => track.removing).sort((a, b) => a[1].departedAt - b[1].departedAt);
      exiting.slice(0, Math.max(0, exiting.length - MAX_EXITING)).forEach(([id]) => objects.delete(id));
      const targetIntensity = intensity(world.weather);
      if (fresh) weather = { value: targetIntensity, from: targetIntensity, target: targetIntensity, elapsed: WEATHER_DURATION, kind: (world.weather || {}).kind || 'clear' };
      else {
        if (weather.target !== targetIntensity) { weather.from = weather.value; weather.target = targetIntensity; weather.elapsed = 0; }
        weather.kind = (world.weather || {}).kind || 'clear';
      }
      if (!animated()) settle();
      draw(); ensureLoop(); return true;
    }
    function setReducedMotion(value) {
      if (destroyed || reduced === !!value) return;
      reduced = !!value;
      if (reduced) { stopLoop(); settle(); }
      draw(); ensureLoop();
    }
    function suspend() { if (destroyed || suspended) return; suspended = true; stopLoop(); }
    function resume() { if (destroyed) return; const wasSuspended = suspended; suspended = false; if (wasSuspended) { lastTime = null; draw(); } ensureLoop(); }
    const Observer = options.ResizeObserver || win.ResizeObserver;
    const observer = Observer ? new Observer(draw) : null;
    if (observer && canvas) observer.observe(canvas);
    if (!observer && win.addEventListener) win.addEventListener('resize', draw);
    return Object.freeze({ update, resize: draw, setReducedMotion, suspend, resume, destroy() { if (destroyed) return; destroyed = true; stopLoop(); objects.clear(); world = null; if (observer) observer.disconnect(); if (!observer && win.removeEventListener) win.removeEventListener('resize', draw); } });
  }
  return Object.freeze({ create });
});

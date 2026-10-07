/* Pure character renderer. No network, model calls, or generated executable content. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFrameworkRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function ascii(value) { return String(value || '').replace(/[^\x20-\x7e\n]/g, ''); }
  function create(canvas, options) {
    options = options || {};
    const win = options.window || (typeof window !== 'undefined' ? window : {});
    let world = null, signature = '', destroyed = false;
    const ctx = canvas && canvas.getContext && canvas.getContext('2d');
    function draw() {
      if (!ctx || !world || destroyed) return;
      const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 600, height: 360 };
      const width = Math.max(1, box.width || 600), height = Math.max(1, box.height || 360);
      const ratio = Math.min(2, win.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      if (ctx.setTransform) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const grid = world.grid || { cols: 100, rows: 60 };
      const cols = grid.cols || 100, rows = grid.rows || 60;
      const cell = Math.min(width / (cols + 10), height / (rows * 1.3 + 15));
      const line = cell * 1.3, left = (width - cols * cell) / 2, top = (height - rows * line) / 2;
      ctx.fillStyle = '#aab2b7'; ctx.textBaseline = 'top';
      function glyphs(item) {
        if (!item) return;
        const scale = Math.max(.5, Math.min(3, Number(item.scale) || 1));
        ctx.font = `${cell * 1.65 * scale}px "SFMono-Regular",Consolas,"Liberation Mono",monospace`;
        const x = left + (Number(item.x) || 0) * cell, y = top + (Number(item.y) || 0) * line;
        ascii(item.glyphs).split('\n').forEach((row, index) => {
          for (let c = 0; c < row.length; c++) if (row[c] !== ' ') ctx.fillText(row[c], x + c * cell * scale, y + index * line * scale);
        });
      }
      const weather = world.weather || {};
      ctx.font = `${cell * 1.65}px "SFMono-Regular",Consolas,"Liberation Mono",monospace`;
      const intensity = Math.max(0, Math.min(3, Number(weather.intensity) || 0));
      if (!weather.paused && intensity > 0) {
        const count = intensity * 36;
        const mark = weather.kind === 'snow' ? '*' : weather.kind === 'mist' ? '.' : '|';
        for (let n = 0; n < count; n++) {
          const x = (n * 37 + 13) % cols, y = (n * 23 + 11) % Math.max(1, rows - 8);
          ctx.fillText(mark, left + x * cell, top + y * line);
        }
      }
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
          const middle = '|' + ' '.repeat(w - 2) + '|';
          shape = [cap, ...Array(h - 2).fill(middle), cap].join('\n');
        }
        glyphs({ ...item, glyphs: shape });
      });
      (Array.isArray(world.objects) ? world.objects : []).forEach(glyphs);
    }
    function update(next) {
      const candidate = next && next.world ? next.world : next;
      const nextSignature = JSON.stringify(candidate || {});
      if (signature === nextSignature) return false;
      signature = nextSignature; world = candidate; draw(); return true;
    }
    const Observer = options.ResizeObserver || win.ResizeObserver;
    const observer = Observer ? new Observer(draw) : null;
    if (observer && canvas) observer.observe(canvas);
    if (!observer && win.addEventListener) win.addEventListener('resize', draw);
    return Object.freeze({ update, resize: draw, destroy() { destroyed = true; if (observer) observer.disconnect(); if (!observer && win.removeEventListener) win.removeEventListener('resize', draw); } });
  }
  return Object.freeze({ create });
});

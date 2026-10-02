/* An original character-drawn world. Every visible mark is an ASCII glyph. */
(() => {
  'use strict';
  const canvas = document.getElementById('world-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const INK = '#c4c4c4';
  const COLUMNS = 100;
  const OBJECT_ROWS = 60, MAX_OBJECTS = 8, MAX_GLYPH_WIDTH = 24, MAX_GLYPH_HEIGHT = 10;
  // Object state is data only. At most eight live objects and eight departing
  // objects are kept; repeated edits keep only one previous glyph pattern.
  let objects = [];
  let width = 680, height = 660, rows = 67, cellX = 6.8, cellY = 9.85;
  let frame = 0, last = 0, paused = false, progress = 0, targetProgress = 0, raf;
  let density = 0, targetDensity = 0, speed = .5, targetSpeed = .5;
  let landscape = [], reflection = [];
  const weather = {
    normal: { density: .7, speed: 1 },
    heavy_rain: { density: 1, speed: 1.8 },
    soft_rain: { density: .38, speed: .55 },
    pause_rain: { density: 0, speed: .4 }
  };
  const rng = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; };
  const random = rng(4147);
  const drops = Array.from({ length: 360 }, () => ({
    x: random(), y: random(), speed: .35 + random() * 1.4,
    alpha: .16 + random() * .38, glyph: random() > .34 ? '|' : ':'
  }));
  const towers = [
    [0, .46, 9], [8, .40, 8], [16, .49, 9], [25, .43, 7],
    [33, .36, 9], [41, .47, 8], [49, .38, 10], [59, .44, 9],
    [68, .31, 10], [78, .40, 8], [86, .35, 10], [95, .46, 7]
  ];

  function readObjects(value) {
    if (!Array.isArray(value) || value.length > MAX_OBJECTS) return null;
    const ids = new Set(), result = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || typeof item.id !== 'string' || !/^obj_[1-9][0-9]{0,11}$/.test(item.id)
        || ids.has(item.id) || typeof item.glyphs !== 'string'
        || item.glyphs.length > MAX_GLYPH_WIDTH * MAX_GLYPH_HEIGHT + MAX_GLYPH_HEIGHT - 1
        || /[^\x20-\x7e\n]/.test(item.glyphs) || !/[^ \n]/.test(item.glyphs)
        || !Number.isInteger(item.x) || !Number.isInteger(item.y)
        || !Number.isInteger(item.scale) || item.scale < 1 || item.scale > 3) return null;
      const lines = item.glyphs.split('\n');
      const span = Math.max(...lines.map(line => line.length));
      if (lines.length > MAX_GLYPH_HEIGHT || span > MAX_GLYPH_WIDTH
        || item.x < 0 || item.y < 0
        || item.x + span * item.scale > COLUMNS
        || item.y + lines.length * item.scale > OBJECT_ROWS) return null;
      ids.add(item.id);
      // Never retain model metadata or the caller's mutable object references.
      result.push({ id: item.id, glyphs: item.glyphs, lines, x: item.x, y: item.y, scale: item.scale });
    }
    return result;
  }

  function approach(value, target) {
    const next = value + (target - value) * .18;
    return Math.abs(target - next) < .002 ? target : next;
  }

  function advanceObjects(settle = false) {
    for (const item of objects) {
      for (const key of ['x', 'y', 'scale', 'alpha']) {
        item[key] = settle ? item.target[key] : approach(item[key], item.target[key]);
      }
      item.blend = settle ? 1 : approach(item.blend, 1);
      if (item.blend === 1) item.previousLines = null;
    }
    objects = objects.filter(item => item.alpha !== 0 || item.target.alpha !== 0);
  }

  function setObjects(value) {
    const next = readObjects(value);
    if (!next) return false;
    const old = new Map(objects.map(item => [item.id, item]));
    const live = next.map(item => {
      const current = old.get(item.id);
      old.delete(item.id);
      if (!current) return {
        ...item, alpha: 0, previousLines: null, blend: 1,
        target: { x: item.x, y: item.y, scale: item.scale, alpha: 1 }
      };
      if (current.glyphs !== item.glyphs) {
        current.previousLines = current.lines;
        current.lines = item.lines;
        current.glyphs = item.glyphs;
        current.blend = 0;
      }
      current.target = { x: item.x, y: item.y, scale: item.scale, alpha: 1 };
      return current;
    });
    const leaving = [...old.values()].slice(-MAX_OBJECTS);
    for (const item of leaving) item.target.alpha = 0;
    // Departing glyphs are behind the current ordered scene. A continuous stream
    // of replacements cannot accumulate an unbounded animation backlog.
    objects = [...leaving, ...live];
    if (paused) advanceObjects(true);
    scene();
    return true;
  }

  function drawObjects() {
    const objectCellY = height / OBJECT_ROWS;
    // Keep each actual glyph within its logical cell at both desktop aspects.
    const fontSize = Math.min(cellX / .60, objectCellY);
    for (const item of objects) {
      if (item.alpha === 0) continue;
      ctx.font = `${fontSize * item.scale}px "Courier New", monospace`;
      const drawPattern = (lines, alpha) => {
        if (!lines || alpha <= 0) return;
        const span = Math.max(...lines.map(line => line.length));
        // Edits may change a pattern's extent during a simultaneous move/scale.
        // Bound both cross-fading patterns until the validated target settles.
        const x = Math.max(0, Math.min(item.x, COLUMNS - span * item.scale));
        const y = Math.max(0, Math.min(item.y, OBJECT_ROWS - lines.length * item.scale));
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        for (let row = 0; row < lines.length; row++) for (let col = 0; col < lines[row].length; col++) {
          const text = lines[row][col];
          if (text !== ' ') ctx.fillText(text,
            (x + (col + .5) * item.scale) * cellX,
            (y + (row + .5) * item.scale) * objectCellY);
        }
      };
      drawPattern(item.previousLines, item.alpha * (1 - item.blend));
      drawPattern(item.lines, item.alpha * item.blend);
    }
  }

  // Compose an ASCII cell map, rather than drawing geometric shapes underneath it.
  // A cell holds its character, opacity, and whether it belongs to the lit window.
  function buildLandscape() {
    const map = Array.from({ length: rows }, () => Array(COLUMNS).fill(null));
    const noise = rng(9184);
    const put = (x, y, glyph, alpha, light = false) => {
      x = Math.round(x); y = Math.round(y);
      if (x >= 0 && x < COLUMNS && y >= 0 && y < rows) map[y][x] = { glyph, alpha, light };
    };
    const at = (fraction) => Math.round(fraction * rows);
    const shore = at(.76);

    // Distant haze is made of sparse punctuation, with empty black sky above it.
    for (let y = 3; y < shore; y++) for (let x = 0; x < COLUMNS; x++) {
      if (noise() < .10 + .19 * y / rows) put(x, y, noise() > .24 ? '.' : ':', .055 + noise() * .10);
    }
    // Small, quiet apartment blocks recede behind the foreground house.
    for (const [left, top, span] of towers) {
      const roof = at(top);
      for (let y = roof; y < shore; y++) for (let x = left; x < Math.min(left + span, COLUMNS); x++) {
        const edge = x === left || x === left + span - 1;
        let glyph = y === roof ? '_' : edge ? '|' : ' ';
        let alpha = edge ? .23 : .25;
        if (y > roof + 1 && y % 3 === 0 && (x - left) % 3 === 1) {
          glyph = noise() > .78 ? ':' : '.';
          alpha = glyph === ':' ? .45 : .17;
        } else if (!edge && y > roof && noise() < .17) { glyph = ':'; alpha = .085; }
        put(x, y, glyph, alpha);
      }
      if (span > 8) {
        put(left + 3, roof - 1, '_', .19); put(left + 4, roof - 1, '_', .19);
        put(left + 5, roof - 2, '|', .18);
      }
    }

    const left = 10, peak = 24, ridge = 55, right = 64;
    const peakY = at(.34), leftEave = at(.42), ridgeY = at(.43), rightEave = at(.49);
    // A sloping tiled roof and weathered, character-hatched walls.
    for (let x = left; x <= right; x++) {
      const roofY = x <= peak
        ? leftEave + (peakY - leftEave) * (x - left) / (peak - left)
        : peakY + (rightEave - peakY) * (x - peak) / (right - peak);
      const eaveY = x <= ridge
        ? leftEave + (ridgeY - leftEave) * (x - left) / (ridge - left)
        : ridgeY + (rightEave - ridgeY) * (x - ridge) / (right - ridge);
      for (let y = Math.round(roofY); y <= shore; y++) {
        const isRoof = y < Math.round(eaveY);
        let glyph, alpha;
        if (isRoof) {
          glyph = (x + y) % 3 === 0 ? '/' : (x + 2 * y) % 4 === 0 ? '_' : '.';
          alpha = .28 + noise() * .18;
        } else {
          glyph = x % 5 === 0 ? '|' : y % 4 === 0 ? '-' : noise() > .58 ? ':' : '.';
          alpha = (x > ridge ? .14 : .22) + noise() * .16;
        }
        put(x, y, glyph, alpha);
      }
      put(x, roofY, x <= peak ? '/' : '\\', .67);
      put(x, eaveY, '_', .48);
      put(x, shore, '=', .39);
    }
    for (let y = leftEave + 1; y < shore; y++) put(left, y, '|', .55);
    for (let y = ridgeY + 1; y < shore; y++) put(ridge, y, '|', .45);
    for (let y = rightEave + 1; y < shore; y++) put(right, y, '|', .32);

    // The window's light is a field of @ # % +, with its own ASCII frame.
    // Its brightness follows story progress; the neutral ink hue never changes.
    const wx = 30, ww = 13, wy = at(.49), wh = Math.max(8, at(.19));
    for (let y = wy - 2; y < wy + wh + 2; y++) for (let x = wx - 3; x < wx + ww + 3; x++) {
      const inside = x >= wx && x < wx + ww && y >= wy && y < wy + wh;
      if (inside) {
        const border = x === wx || x === wx + ww - 1 || y === wy || y === wy + wh - 1;
        const mullion = x === wx + 6 || y === wy + Math.floor(wh / 2);
        const glyph = border ? (y === wy || y === wy + wh - 1 ? '=' : '|')
          : mullion ? (x === wx + 6 ? '|' : '-')
          : ['@', '#', '%', '+'][(x + y * 3) % 4];
        put(x, y, glyph, border ? .68 : mullion ? .29 : .86 + noise() * .14, true);
      } else if (noise() > .18) {
        put(x, y, (x + y) % 3 === 0 ? ':' : '.', .28 + noise() * .13, true);
      }
    }
    for (let x = wx - 2; x < wx + ww + 2; x++) put(x, wy + wh, '=', .75, true);
    // A small fern and its pot interrupt the bright lower-right pane.
    const plantX = wx + 9, plantY = wy + wh - 4;
    for (const [dx, dy, glyph] of [[0, 0, '|'], [-1, -1, '\\'], [1, -1, '/'],
      [-2, 0, '\\'], [2, 0, '/'], [-1, 1, '\\'], [0, 1, '|'], [1, 1, '/'],
      [-1, 2, '['], [0, 2, '_'], [1, 2, ']']]) put(plantX + dx, plantY + dy, glyph, .21);

    // The telegraph pole, its crossarms, and the sagging wires are also text.
    const poleX = 74;
    for (let y = at(.13); y < shore + 1; y++) put(poleX, y, '|', .38);
    for (let x = poleX - 3; x <= poleX + 3; x++) put(x, at(.26), x === poleX ? '+' : '-', .46);
    for (let x = poleX - 4; x <= poleX + 4; x++) put(x, at(.29), x === poleX ? '+' : '-', .40);
    put(poleX - 2, at(.26) - 1, 'o', .34); put(poleX + 2, at(.26) - 1, 'o', .34);
    for (let x = 0; x < COLUMNS; x++) {
      const t = x / (COLUMNS - 1);
      const y = at(.11 + .20 * t + .045 * Math.sin(Math.PI * t));
      put(x, y, x % 4 === 0 ? '.' : '_', .29);
      if (x < poleX) put(x, at(.19 + .105 * x / poleX + .035 * Math.sin(Math.PI * x / poleX)), '_', .17);
    }
    // A low embankment breaks into narrow reflected ripples below the house.
    for (let x = 1; x < COLUMNS - 1; x++) {
      if (noise() > .16) put(x, shore + 1, x % 7 === 0 ? ':' : '_', .22 + noise() * .20);
      if (x % 8 === 0) put(x, shore + 2, '|', .25);
    }
    const water = rng(90);
    reflection = [];
    for (let y = shore + 2; y < at(.95); y++) for (let x = 2; x < COLUMNS - 2; x++) {
      const spread = 5 + (y - shore) * .7;
      const near = Math.abs(x - (wx + ww / 2)) < spread;
      const chance = near ? .58 : .22;
      if (water() < chance) {
        const glyph = ['~', '_', '=', '-', '.'][Math.floor(water() * 5)];
        reflection.push({ x, y, glyph, alpha: (near ? .28 : .09) + water() * (near ? .47 : .16), light: near, phase: water() * Math.PI * 2 });
      }
    }
    landscape = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < COLUMNS; x++) {
      const cell = map[y][x];
      if (cell && cell.glyph !== ' ') landscape.push({ x, y, ...cell });
    }
  }

  function glyph(mark, alpha = mark.alpha) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillText(mark.glyph, (mark.x + .5) * cellX, (mark.y + .5) * cellY);
  }
  function scene() {
    // This is the only filled geometry: a pure black canvas clearing pass.
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = INK;
    ctx.font = `${cellX / .60}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const light = .60 + progress * .38;
    for (const mark of landscape) glyph(mark, mark.alpha * (mark.light ? light : 1));
    for (const mark of reflection) {
      const shimmer = .88 + .12 * Math.sin(frame * .025 + mark.phase);
      glyph(mark, mark.alpha * shimmer * (mark.light ? light : 1));
    }
    // Rain is punctuation, including the long foreground drops. It never uses lines.
    if (density > .005) for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      const visibility = Math.max(0, Math.min(1, (density - i / drops.length) * 14));
      if (!visibility) continue;
      const x = Math.floor(drop.x * COLUMNS);
      const y = ((drop.y * rows + frame * drop.speed * .18) % (rows - 3));
      glyph({ x, y, glyph: drop.glyph, alpha: drop.alpha * visibility });
      if (i % 9 === 0) glyph({ x, y: y - 1, glyph: ':', alpha: drop.alpha * visibility * .35 });
    }
    // New objects are foreground character layers, above the city and rain.
    drawObjects();
    ctx.globalAlpha = 1;
  }
  function resize() {
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cellX = width / COLUMNS;
    rows = Math.max(40, Math.min(90, Math.round(height / (cellX * 1.44))));
    cellY = height / rows;
    buildLandscape(); scene();
  }
  function tick(now) {
    if (!paused && !document.hidden && now - last > 48) {
      progress += (targetProgress - progress) * .08;
      density += (targetDensity - density) * .075;
      speed += (targetSpeed - speed) * .07;
      advanceObjects();
      frame += speed; scene(); last = now;
    }
    raf = requestAnimationFrame(tick);
  }
  new ResizeObserver(resize).observe(canvas);
  resize(); raf = requestAnimationFrame(tick);
  window.HerWorld = {
    setObjects,
    setProgress(value) { targetProgress = Math.min(1, Math.max(0, value)); if (paused) progress = targetProgress; scene(); },
    setRain(value) { const target = weather[value] || weather.normal; targetDensity = target.density; targetSpeed = target.speed; if (paused) { density = targetDensity; speed = targetSpeed; } scene(); },
    pause(value) { paused = Boolean(value); if (paused) { progress = targetProgress; density = targetDensity; speed = targetSpeed; advanceObjects(true); } scene(); }
  };
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf));
  window.addEventListener('pageshow', event => { if (event.persisted) { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); } });
})();

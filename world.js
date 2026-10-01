/* An original character-drawn world. Every visible mark is an ASCII glyph. */
(() => {
  'use strict';
  const canvas = document.getElementById('world-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const INK = '#c4c4c4';
  const COLUMNS = 100;
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
      frame += speed; scene(); last = now;
    }
    raf = requestAnimationFrame(tick);
  }
  new ResizeObserver(resize).observe(canvas);
  resize(); raf = requestAnimationFrame(tick);
  window.HerWorld = {
    setProgress(value) { targetProgress = Math.min(1, Math.max(0, value)); if (paused) progress = targetProgress; scene(); },
    setRain(value) { const target = weather[value] || weather.normal; targetDensity = target.density; targetSpeed = target.speed; if (paused) { density = targetDensity; speed = targetSpeed; } scene(); },
    pause(value) { paused = Boolean(value); if (paused) { progress = targetProgress; density = targetDensity; speed = targetSpeed; } scene(); }
  };
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf));
  window.addEventListener('pageshow', event => { if (event.persisted) { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); } });
})();

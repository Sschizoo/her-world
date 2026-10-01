/* A small, original, code-drawn world. No images, trackers, or remote assets. */
(() => {
  'use strict';
  const canvas = document.getElementById('world-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let width = 680, height = 660, frame = 0, last = 0, paused = false, progress = 0, rain = 'normal', raf;
  const rng = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; };
  const random = rng(4147);
  const drops = Array.from({ length: 330 }, () => ({ x: random() * 800, y: random() * 680, length: 4 + random() * 17, speed: .35 + random() * 1.4, alpha: .08 + random() * .36 }));
  const stars = Array.from({ length: 530 }, () => ({ x: random() * 800, y: random() * 660, a: random() * .3, warm: random() > .9 }));
  const buildings = Array.from({ length: 15 }, (_, i) => ({ x: i * 58 + random() * 15, top: 300 + random() * 115, w: 40 + random() * 24 }));
  function scene() {
    ctx.clearRect(0, 0, width, height);
    const sx = width / 800, sy = height / 680;
    ctx.save(); ctx.scale(sx, sy);
    ctx.fillStyle = '#0a151c'; ctx.fillRect(0, 0, 800, 680);
    const halo = ctx.createRadialGradient(270, 365, 0, 270, 365, 210);
    halo.addColorStop(0, `rgba(208,148,68,${.035 + progress * .035})`); halo.addColorStop(1, 'rgba(10,21,28,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, 800, 680);
    for (const b of buildings) {
      ctx.fillStyle = '#0c1a22'; ctx.fillRect(b.x, b.top, b.w, 205);
      ctx.fillStyle = '#10212a'; ctx.fillRect(b.x + 7, b.top - 14, b.w - 13, 14);
      for (let x = b.x + 9; x < b.x + b.w - 5; x += 12) for (let y = b.top + 16; y < 498; y += 21) {
        const on = (Math.floor(x * 7 + y * 13) % 17 === 0);
        ctx.fillStyle = on ? '#b78b51' : '#18303a'; ctx.globalAlpha = on ? .6 : .5; ctx.fillRect(x, y, 2, on ? 4 : 3);
      }
      ctx.globalAlpha = 1;
    }
    // Telephone wire, the sloped roof, and broken light on the river.
    ctx.strokeStyle = '#35515d'; ctx.lineWidth = 1; ctx.setLineDash([1, 6]);
    ctx.beginPath(); ctx.moveTo(3, 90); ctx.quadraticCurveTo(152, 148, 420, 217); ctx.quadraticCurveTo(555, 237, 798, 247); ctx.stroke();
    ctx.strokeStyle = '#517280';ctx.globalAlpha=.38;ctx.beginPath();ctx.moveTo(60,143);ctx.lineTo(518,316);ctx.stroke();ctx.globalAlpha=1;
    ctx.fillStyle = '#0b151b'; ctx.beginPath(); ctx.moveTo(69, 265); ctx.lineTo(160, 230); ctx.lineTo(348, 292); ctx.lineTo(411, 319); ctx.lineTo(414, 505); ctx.lineTo(71, 505); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#426271'; ctx.setLineDash([1, 5]); ctx.beginPath(); ctx.moveTo(68, 265); ctx.lineTo(160, 231); ctx.lineTo(413, 320); ctx.moveTo(110, 277); ctx.lineTo(110, 510); ctx.moveTo(348, 291); ctx.lineTo(348, 509); ctx.moveTo(60, 439); ctx.lineTo(607, 439); ctx.moveTo(27, 505); ctx.lineTo(704, 505); ctx.stroke();
    for (let x = 115; x < 402; x += 12) {ctx.globalAlpha = .24 + ((x * 5) % 7) / 40;ctx.strokeStyle='#375564';ctx.beginPath();ctx.moveTo(x, 306);ctx.lineTo(x, 498);ctx.stroke();}ctx.globalAlpha=1;
    ctx.strokeStyle='#986c3d';ctx.setLineDash([1,4]);ctx.beginPath();ctx.moveTo(166,441);ctx.lineTo(569,441);ctx.moveTo(164,452);ctx.lineTo(500,452);ctx.stroke();
    // The window is the stable focal point, never a background screenshot.
    const warmth = Math.min(1, .48 + progress * .7);
    const glow = ctx.createRadialGradient(255, 371, 10, 255, 371, 92);
    glow.addColorStop(0, `rgba(235,172,84,${warmth * .17})`); glow.addColorStop(1, 'rgba(235,172,84,0)');ctx.fillStyle=glow;ctx.fillRect(143,265,227,218);
    ctx.fillStyle='#201d19';ctx.fillRect(209, 317, 87, 109);ctx.fillStyle='#795634';ctx.fillRect(215,323,75,96);
    ctx.globalAlpha=warmth;ctx.fillStyle='#edb66c';ctx.fillRect(223,331,59,83);ctx.fillStyle='#f8d391';ctx.fillRect(227,335,22,34);ctx.fillRect(255,335,22,34);ctx.fillRect(227,375,22,31);ctx.fillRect(255,375,22,31);ctx.globalAlpha=1;
    ctx.fillStyle='#483422';ctx.fillRect(250,330,4,84);ctx.fillRect(223,369,59,4);ctx.fillRect(218,413,72,5);
    const wr = rng(34); for(let i=0;i<90;i++){ctx.fillStyle=wr()>.3?'#3b3129':'#ffdda1';ctx.globalAlpha=.22+wr()*.33;ctx.fillRect(223+wr()*58,331+wr()*82,1,wr()*3+1);}ctx.globalAlpha=1;
    // Small potted plant in the window; it is not a human silhouette.
    ctx.fillStyle='#3d3327';ctx.fillRect(258,400,11,11);ctx.strokeStyle='#433a2a';ctx.setLineDash([]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(263,403);ctx.lineTo(262,385);ctx.moveTo(262,395);ctx.quadraticCurveTo(247,392,253,384);ctx.moveTo(263,395);ctx.quadraticCurveTo(274,384,271,382);ctx.stroke();
    ctx.strokeStyle='#2b4654';ctx.lineWidth=1;ctx.setLineDash([1,4]);ctx.beginPath();ctx.moveTo(328,61);ctx.lineTo(328,444);ctx.moveTo(320,191);ctx.lineTo(337,191);ctx.moveTo(306,206);ctx.lineTo(345,206);ctx.stroke();
    // Pixel water reflection is stable, with quiet movement only in its brightness.
    const water=rng(90);for(let i=0;i<185;i++){const y=505+water()*113;const x=88+water()*588;const near=Math.abs(x-252)<60+(y-505)*.4;ctx.globalAlpha=(.1+water()*.34)*(near?warmth:1);ctx.fillStyle=near?'#d89a52':'#527583';ctx.fillRect(x,y,2+water()*(near?16:30),1);}
    ctx.globalAlpha=1;
    for(const s of stars){ctx.globalAlpha=s.a;ctx.fillStyle=s.warm?'#c29b65':'#6b929f';ctx.fillRect(s.x,s.y,1,1);}ctx.globalAlpha=1;
    // Monospaced glyphs and pixel rain provide the reference's terminal texture.
    ctx.font='8px monospace';ctx.fillStyle='#678797';
    if(rain!=='pause_rain') for(const d of drops){const speed=rain==='heavy_rain'?1.8:rain==='soft_rain'?.55:1;const y=(d.y+frame*d.speed*speed)%630;ctx.globalAlpha=d.alpha*(rain==='soft_rain'?.65:1);ctx.fillRect(d.x,y,1,d.length);if(Math.floor(d.x)%4===0)ctx.fillText(':',d.x-1,y-4);}
    ctx.globalAlpha=1;ctx.restore();
  }
  function resize(){const box=canvas.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);scene();}
  function tick(now){if(!paused&&!document.hidden&&now-last>48){frame+=1;scene();last=now;}raf=requestAnimationFrame(tick);}
  new ResizeObserver(resize).observe(canvas);resize();raf=requestAnimationFrame(tick);
  window.HerWorld={setProgress(value){progress=Math.min(1,Math.max(0,value));scene();},setRain(value){rain=value||'normal';scene();},pause(value){paused=Boolean(value);scene();}};
  window.addEventListener('pagehide',()=>cancelAnimationFrame(raf));
})();

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../world.js'), 'utf8');
function runtime(width=680,height=660) {
  let draws=0,frameId=0,marks=[],clears=[],resize;
  const frames=new Map(),listeners={};
  const ctx={globalAlpha:1,fillStyle:'',setTransform(){},fillRect(x,y,w,h){draws++;marks=[];clears.push({x,y,w,h,color:this.fillStyle});},fillText(text,x,y){marks.push({text,x,y,color:this.fillStyle,alpha:this.globalAlpha});}};
  const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width,height})};
  const document={hidden:false,getElementById:()=>canvas};
  const window={devicePixelRatio:1,addEventListener(type,fn){listeners[type]=fn;}};
  vm.runInNewContext(source,{window,document,ResizeObserver:class{constructor(fn){resize=fn;}observe(){}},requestAnimationFrame(fn){const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);}});
  return{world:window.HerWorld,document,listeners,light:()=>marks.find(m=>m.text==='@').alpha,marks:()=>marks,clears:()=>clears,draws:()=>draws,queued:()=>frames.size,resize(w,h){width=w;height=h;resize();},tick(time){const[id,fn]=frames.entries().next().value;frames.delete(id);fn(time);}};
}
 test('world is only printable ASCII in one neutral hue over black clears',()=>{const r=runtime();assert(r.marks().length>1000);assert(r.marks().every(m=>/^[\x20-\x7e]$/.test(m.text)));assert.deepEqual([...new Set(r.marks().map(m=>m.color))],['#c4c4c4']);assert(r.clears().every(c=>c.color==='#000000'&&c.x===0&&c.y===0));for(const glyph of ['@','#','%','+','~','_','=','|','/','\\'])assert(r.marks().some(m=>m.text===glyph));});
 test('window glyph brightness moves gradually toward the new story state',()=>{const r=runtime(),initial=r.light();r.world.setProgress(1);assert.equal(r.light(),initial);r.tick(100);assert(r.light()>initial&&r.light()<initial*.98/.60);for(let i=2;i<50;i++)r.tick(i*100);assert(r.light()>initial*1.60&&r.light()<initial*.98/.60);});
 test('pause/reduced-motion settles the scene and stops animation paints',()=>{const r=runtime(),initial=r.light();r.world.setProgress(1);r.world.setRain('heavy_rain');r.world.pause(true);assert(Math.abs(r.light()-initial*.98/.60)<1e-10);const paints=r.draws(),rainMarks=r.marks().length;r.tick(100);assert.equal(r.draws(),paints);r.world.setRain('pause_rain');assert(r.marks().length<rainMarks);});
 test('background tabs pause paints and bfcache restore restarts one loop',()=>{const r=runtime(),paints=r.draws();r.document.hidden=true;r.tick(100);assert.equal(r.draws(),paints);r.listeners.pagehide();assert.equal(r.queued(),0);r.listeners.pageshow({persisted:true});assert.equal(r.queued(),1);});
 test('desktop scene adapts to both tall and open-drawer aspect ratios',()=>{const r=runtime(550,500);assert(r.marks().every(m=>m.x>=0&&m.x<=550&&m.y>=0&&m.y<=500));r.resize(550,340);assert(r.marks().every(m=>m.x>=0&&m.x<=550&&m.y>=0&&m.y<=340));assert(r.marks().some(m=>m.text==='@'));assert(r.marks().some(m=>m.text==='~'));});

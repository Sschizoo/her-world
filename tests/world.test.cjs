const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../world.js'), 'utf8');
function runtime(width=680,height=660) {
  let draws=0,frameId=0,marks=[],clears=[],resize;
  const frames=new Map(),listeners={};
  const ctx={globalAlpha:1,fillStyle:'',setTransform(){},fillRect(x,y,w,h){draws++;marks=[];clears.push({x,y,w,h,color:this.fillStyle,alpha:this.globalAlpha});},fillText(text,x,y){marks.push({text,x,y,color:this.fillStyle,alpha:this.globalAlpha,font:this.font});}};
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

function object(overrides={}) {
  return {id:'obj_1',label:'a novel drawing',glyphs:'Q',x:10,y:12,scale:1,source:{createdBy:1,lastChangedBy:1},...overrides};
}
function mark(r,text='Q') { return r.marks().find(m=>m.text===text); }
function settle(r,start=0) { for(let i=1;i<=80;i++)r.tick(start+i*100); }
function close(actual,expected) { assert(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`); }

test('novel multiline objects use only foreground ASCII glyphs and the same neutral ink',()=>{
  const r=runtime();r.world.pause(true);r.world.setRain('heavy_rain');
  const shape='Q~Q\n / \nZ_Z';
  assert.equal(r.world.setObjects([object({glyphs:shape})]),true);
  const foreground=r.marks().slice(-7);
  assert.equal(foreground.map(m=>m.text).join(''),'Q~Q/Z_Z');
  assert(r.marks().every(m=>/^[\x20-\x7e]$/.test(m.text)&&m.color==='#c4c4c4'));
  assert(r.clears().every(c=>c.color==='#000000'&&c.alpha===1&&c.w===680&&c.h===660));
  assert(foreground.every(m=>m.alpha===1));
  close(foreground[0].x,10.5*6.8);close(foreground[0].y,12.5*11);
  close(foreground[3].x,11.5*6.8);close(foreground[3].y,13.5*11);
});

test('appearance, movement, scaling, edits and removal interpolate then settle exactly',()=>{
  const r=runtime();
  r.world.setObjects([object()]);assert.equal(mark(r),undefined);
  r.tick(100);assert(mark(r).alpha>0&&mark(r).alpha<1);
  settle(r,100);assert.equal(mark(r).alpha,1);
  const start={...mark(r)};
  r.world.setObjects([object({x:50,y:40,scale:3})]);
  close(mark(r).x,start.x);close(parseFloat(mark(r).font),parseFloat(start.font));
  r.tick(8300);
  assert(mark(r).x>start.x&&mark(r).x<51.5*6.8);
  assert(mark(r).y>start.y&&mark(r).y<41.5*11);
  assert(parseFloat(mark(r).font)>parseFloat(start.font)&&parseFloat(mark(r).font)<parseFloat(start.font)*3);
  settle(r,8300);
  close(mark(r).x,51.5*6.8);close(mark(r).y,41.5*11);close(parseFloat(mark(r).font),33);
  r.world.setObjects([object({glyphs:'Z',x:50,y:40,scale:3})]);
  assert(mark(r));assert.equal(mark(r,'Z'),undefined);
  r.tick(16500);assert(mark(r).alpha>0&&mark(r).alpha<1);assert(mark(r,'Z').alpha>0&&mark(r,'Z').alpha<1);
  // Reapplying the same persisted scene must not restart the edit transition.
  const oldAlpha=mark(r).alpha;r.world.setObjects([object({glyphs:'Z',x:50,y:40,scale:3})]);
  r.tick(16600);assert(mark(r).alpha<oldAlpha);
  settle(r,16600);assert.equal(mark(r),undefined);assert.equal(mark(r,'Z').alpha,1);
  r.world.setObjects([]);assert.equal(mark(r,'Z').alpha,1);
  r.tick(24800);assert(mark(r,'Z').alpha>0&&mark(r,'Z').alpha<1);
  settle(r,24800);assert.equal(mark(r,'Z'),undefined);
});

test('pause and reduced motion immediately settle all object changes without animation paints',()=>{
  const r=runtime();r.world.setObjects([object()]);r.tick(100);
  r.world.setObjects([object({x:44,y:30,scale:2,glyphs:'Z'})]);r.world.pause(true);
  assert.equal(mark(r),undefined);assert.equal(mark(r,'Z').alpha,1);
  close(mark(r,'Z').x,45*6.8);close(mark(r,'Z').y,31*11);
  const paints=r.draws();r.tick(200);assert.equal(r.draws(),paints);
  r.world.setObjects([]);assert.equal(mark(r,'Z'),undefined);
  r.world.setObjects([object({glyphs:'X'})]);assert.equal(mark(r,'X').alpha,1);
});

test('object logical geometry and actual font scale stay inside both desktop aspect ratios',()=>{
  const r=runtime(550,500);r.world.pause(true);
  r.world.setObjects([object({glyphs:'QQQQ\nQ  Q',x:88,y:54,scale:3})]);
  for(const [width,height] of [[550,500],[550,340],[900,700]]){
    r.resize(width,height);
    const cells=r.marks().filter(m=>m.text==='Q');assert.equal(cells.length,6);
    close(cells[0].x,89.5*width/100);close(cells[0].y,55.5*height/60);
    for(const cell of cells){
      const font=parseFloat(cell.font);
      assert(font*.6<=3*width/100+1e-9&&font<=3*height/60+1e-9);
      assert(cell.x-font*.3>=0&&cell.x+font*.3<=width+1e-9);
      assert(cell.y-font*.5>=0&&cell.y+font*.5<=height+1e-9);
    }
  }
});

test('simultaneous large pattern edits, moves and rescaling stay within the scene',()=>{
  const r=runtime();r.world.pause(true);r.world.setObjects([object({x:99,y:59})]);r.world.pause(false);
  r.world.setObjects([object({glyphs:Array(10).fill('Z'.repeat(24)).join('\n'),x:28,y:30,scale:3})]);
  for(let i=1;i<=50;i++){
    r.tick(i*100);
    for(const cell of r.marks().filter(m=>m.text==='Q'||m.text==='Z')){
      const font=parseFloat(cell.font);
      assert(cell.x-font*.3>=-1e-9&&cell.x+font*.3<=680+1e-9);
      assert(cell.y-font*.5>=-1e-9&&cell.y+font*.5<=660+1e-9);
    }
  }
});

test('malformed and oversized object data is rejected without erasing the existing scene',()=>{
  const r=runtime();r.world.pause(true);r.world.setObjects([object()]);
  const invalid=[null,{},'Q',[null],[{}],Array.from({length:9},(_,i)=>object({id:`obj_${i+1}`})),
    [object(),object()],...[{id:'other'}, {id:'obj_0'}, {id:'obj_01'}, {id:'obj_1<script>'},
      {glyphs:null},{glyphs:''},{glyphs:'   \n '},{glyphs:'Q'.repeat(25)},
      {glyphs:Array(11).fill('Q').join('\n')},{glyphs:'☂'},{glyphs:'Q\tQ'},{glyphs:'Q\r\nQ'},{glyphs:'Q\0'},
      {glyphs:'Q'.repeat(100000)},{x:-1},{x:1.1},{x:Infinity},{x:NaN},{x:'3'},{y:-1},{y:60},{y:1.1},
      {scale:0},{scale:4},{scale:1.5},{x:99,scale:2},{y:59,scale:2}].map(v=>[object(v)])];
  for(const payload of invalid){assert.equal(r.world.setObjects(payload),false);assert.equal(mark(r).alpha,1);}
  // Control-looking text stays inert text, and source/label have no drawing role.
  assert.equal(r.world.setObjects([object({glyphs:'<script>boom()</script>',label:{unexpected:true},source:null})]),true);
  assert(r.marks().every(m=>m.text.length===1));
});

test('renderer owns a bounded data snapshot and continuous scene replacements cannot accumulate',()=>{
  const r=runtime();r.world.pause(true);
  const input=object();r.world.setObjects([input]);input.glyphs='Z';input.x=90;
  r.resize(680,660);assert(mark(r));assert.equal(mark(r,'Z'),undefined);close(mark(r).x,10.5*6.8);
  const large=Array(10).fill('Q'.repeat(24)).join('\n');
  const batch=n=>Array.from({length:8},(_,i)=>object({id:`obj_${n*8+i+1}`,glyphs:large,x:0,y:0}));
  r.world.setObjects(batch(0));r.world.pause(false);
  for(let n=1;n<=30;n++){
    r.world.setObjects(batch(n));r.tick(n*100);
    assert(r.marks().filter(m=>m.text==='Q').length<=16*240);
  }
  r.world.pause(true);assert.equal(r.marks().filter(m=>m.text==='Q').length,8*240);
  r.world.setObjects([]);assert.equal(mark(r),undefined);
});

test('object animation remains deterministic and survives hidden tabs and bfcache restore',()=>{
  const a=runtime(),b=runtime();
  for(const r of [a,b]){r.world.setObjects([object()]);r.tick(100);r.world.setObjects([object({x:60,scale:2})]);r.tick(200);}
  assert.deepEqual(mark(a),mark(b));
  const before={...mark(a)},paints=a.draws();a.document.hidden=true;a.tick(300);
  assert.equal(a.draws(),paints);assert.deepEqual(mark(a),before);
  a.listeners.pagehide();assert.equal(a.queued(),0);
  a.listeners.pageshow({persisted:true});a.listeners.pageshow({persisted:true});assert.equal(a.queued(),1);
  a.document.hidden=false;a.tick(400);assert(mark(a).x>before.x);assert.equal(a.queued(),1);
});

/* Interaction tests use the real runtime and packs. DOM emulation is not pixel QA. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const UI = require('../framework/app.js');
const runtime = require('../framework/runtime.js');
const packs = require('../framework/packs.js');
const offline = require('../framework/offline.js');
const focus = require('../framework/focus.js');
const legacy = require('../framework/legacy-adapter.js');
const oldEngine = require('../framework/legacy/v0.5.4/engine.js');
const renderer = require('../framework/renderer.js');
const html = fs.readFileSync(path.join(__dirname, '../framework.html'), 'utf8');
class Element {
  constructor(tag='div') { this.tagName=tag.toUpperCase(); this.children=[]; this.dataset={}; this.style={}; this.attrs={}; this.events={}; this.value=''; this.hidden=false; this.disabled=false; this.open=false; this._text=''; this.className=''; this.scrollHeight=1000; this.classList={toggle:(name,on)=>{const words=new Set(this.className.split(' ').filter(Boolean));on?words.add(name):words.delete(name);this.className=[...words].join(' ');}}; }
  set textContent(text){this._text=String(text);this.children=[];} get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
  append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  addEventListener(name,fn){(this.events[name] ||= []).push(fn);} removeEventListener(){} setAttribute(name,value){this.attrs[name]=String(value);} focus(){this.focused=true;}
  showModal(){this.open=true;} close(){this.open=false;(this.events.close||[]).forEach(fn=>fn({}));}
  async emit(name,event={}){if(name==='click'&&this.disabled)return;const e={preventDefault(){},target:this,...event};for(const fn of this.events[name]||[])await fn(e);await Promise.resolve();}
  getBoundingClientRect(){return {width:650,height:360};}
}
function clock(){let time=0,serial=0;const tasks=new Map();return{setTimeout(fn,delay){const id=++serial;tasks.set(id,{fn,at:time+delay});return id;},clearTimeout(id){tasks.delete(id);},async advance(ms){const end=time+ms;let loops=0;while(true){const entry=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;if(loops++>10000)throw Error('timer loop');time=entry[1].at;tasks.delete(entry[0]);entry[1].fn();await Promise.resolve();}time=end;await Promise.resolve();},async flush(){let n=0;while(tasks.size){if(n++>10000)throw Error('timer loop');await this.advance(Math.max(0,Math.min(...[...tasks.values()].map(t=>t.at))-time));}}};}
function dom(){const ids={},all=[];for(const match of html.matchAll(/<(\w+)\b([^>]*)>/g)){const node=new Element(match[1]);for(const a of match[2].matchAll(/([\w-]+)="([^"]*)"/g)){node.attrs[a[1]]=a[2];if(a[1]==='id')ids[a[2]]=node;if(a[1]==='class')node.className=a[2];if(a[1].startsWith('data-'))node.dataset[a[1].slice(5)]=a[2];}node.hidden=/\bhidden\b/.test(match[2]);all.push(node);}return{ids,document:{getElementById:id=>ids[id],createElement:tag=>new Element(tag),querySelectorAll:selector=>selector==='[data-close]'?all.filter(n=>n.dataset.close):[]}};}
function setup(options={}){
  const {ids,document}=dom(),timers=clock(),store=options.store||new Map(),events={},media={matches:options.reduced!==false,addEventListener(name,fn){this.fn=fn;},removeEventListener(){}};
  let connected=false,calls=0;
  const model={connect(key){connected=key.length>=8;return connected;},connected:()=>connected,disconnect(){connected=false;},calls:()=>calls,async request(args){calls++;return options.request?options.request(args):plan(['我听见了。']);}};
  const storage={getItem(key){if(options.blocked)throw Error('denied');return store.get(key)||null;},setItem(key,value){if(options.blocked || options.writeFails && options.writeFails(key))throw Error('denied');if(options.writes)options.writes.push({key,value});if(!options.dropWrites || !options.dropWrites(key))store.set(key,value);}};
  const draws=[],motionCalls=[];let suspends=0,resumes=0,rendererDestroyed=0;
  const win={document,location:{search:options.search||'',href:'http://localhost/framework.html'+(options.search||'')},history:{replaceState(){}},matchMedia:()=>media,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,addEventListener(name,fn){(events[name]||=[]).push(fn);},removeEventListener(){}};
  const app=UI.create({window:win,document,runtime:options.runtime||runtime,packs,offline,focus,legacy,model,storage,renderer:{update:view=>draws.push(view.world),setReducedMotion:value=>motionCalls.push(value),suspend(){suspends++;},resume(){resumes++;},destroy(){rendererDestroyed++;}}});
  return {app,ids,store,model,timers,draws,motionCalls,lifecycle:()=>({suspends,resumes,rendererDestroyed}),media,win,async offline(){await ids['offline-button'].emit('click');},async online(){ids['api-key'].value='TEST_ONLY_PASSWORD';await ids['connect-form'].emit('submit');},async say(text){ids['free-input'].value=text;return ids['free-form'].emit('submit');},async event(name,event={}){for(const fn of events[name]||[])await fn(event);}};
}
const plan=(lines,beats=[],topic=null)=>({schema:'her-world-turn-v2',lines,beats,topic});
const addObject={type:'world.create',object:{label:'纸船',glyphs:' /\\\n/==\\',x:48,y:42,scale:1}};
const addMemory={type:'memory.upsert',id:'note_visit',title:'窗边',body:'一起看天亮'};

test('online new aliases never overwrite earlier memories and explicit handles still revise',async()=>{
  let turn=0;
  const r=setup({request:async({context,input})=>{
    const id=turn++<2?'note_preference':context.memories[0].id;
    return plan(['这个偏好记下了。'],[{afterLine:0,operations:[{type:'memory.upsert',id,title:'当前偏好',body:input,perspective:'player_report',support:{quote:input}}]}]);
  }});
  await r.online();await r.say('我喜欢雨声。');await r.say('我也喜欢灯光。');
  assert.deepEqual(r.app.snapshot().state.memories.map(note=>note.body),['我喜欢雨声。','我也喜欢灯光。']);
  assert.notEqual(r.app.snapshot().state.memories[0].id,r.app.snapshot().state.memories[1].id);
  await r.say('现在我更喜欢风声。');
  assert.deepEqual(r.app.snapshot().state.memories.map(note=>note.body),['现在我更喜欢风声。','我也喜欢灯光。']);
  assert.equal(r.app.snapshot().state.memories[0].currentRevision.number,2);
  const next=setup({store:r.store});assert.deepEqual(next.app.snapshot().state.memories,r.app.snapshot().state.memories);
});

test('a mixed cached runtime without the online alias boundary stops before storage access',()=>{
  const {commitModel,...oldRuntime}=runtime;
  assert.throws(()=>setup({runtime:oldRuntime}),/runtime_version_mismatch/);
});

test('salient memory without a remember command reveals at its sentence and labels the player quotation',async()=>{
  const input='我喜欢在窗边听雨。';
  const r=setup({reduced:false,request:async()=>plan(['窗边适合慢慢听。','这个偏好，我记下了。'],[{afterLine:1,operations:[{type:'memory.upsert',id:'note_quiet',title:'听雨的偏好',body:input,kind:'preference',perspective:'player_report',support:{quote:input}}]}])});
  await r.online();await r.say(input);assert.equal(r.ids['memory-count'].textContent,'00');assert.equal(r.app.snapshot().state.memories.length,1);
  await r.ids['skip-reveal'].emit('click');assert.equal(r.ids['memory-count'].textContent,'00');
  await r.timers.advance(360);
  await r.ids['skip-reveal'].emit('click');assert.equal(r.ids['memory-count'].textContent,'01');
  assert.match(r.ids['memory-list'].textContent,/偏好 · 你的原话/);assert.match(r.ids['memory-list'].textContent,/我喜欢在窗边听雨/);
  assert.equal(r.app.snapshot().state.story.completed.length,0);
  const restored=runtime.restore(r.store.get(r.app.snapshot().storageKey),packs.get('rain-lab'));assert(restored.ok);assert.equal(restored.state.memories[0].perspective,'player_report');
});

test('forgetting removes the current card while audit remains and later learning shows a fresh source generation',async()=>{
  const r=setup();await r.offline();await r.say('/记住 note_visit 来访 | 一起看天亮');
  await r.say('/忘记 note_visit');assert.equal(r.ids['memory-count'].textContent,'00');assert.match(r.ids.transcript.textContent,/一起看天亮/);
  await r.say('/记住 note_visit 新的约定 | 一起听风');assert.equal(r.ids['memory-count'].textContent,'01');
  assert.match(r.ids['memory-list'].textContent,/她的理解，可被纠正/);assert.match(r.ids['memory-list'].textContent,/第 2 次重新记下/);
  const note=r.app.snapshot().state.memories[0];assert.equal(note.source.text,'/记住 note_visit 新的约定 | 一起听风');assert.equal(note.currentRevision.number,1);
});

test('dependent retained memories show withheld status and fresh exact correction restores visible recall',async()=>{
  const inputs=['纪念代号是ALPHA。','我也喜欢在窗边坐着。','忘记纪念代号。','我现在喜欢咸味。'];
  const operations=[
    {type:'memory.upsert',id:'note_signal',title:'代号',body:inputs[0],perspective:'player_report',support:{quote:inputs[0]}},
    {type:'memory.upsert',id:'note_view',title:'她对窗边的理解',body:'她觉得窗边是一个安静的地方。'},
    {type:'memory.remove',id:'memory_1'},
    {type:'memory.upsert',id:'memory_2',title:'当前口味',body:inputs[3],kind:'preference',perspective:'player_report',support:{quote:inputs[3]}}
  ];let index=0;
  const r=setup({request:async()=>plan(['这次记录已更新。'],[{afterLine:0,operations:[operations[index++]]}])});await r.online();
  for(const input of inputs.slice(0,3))await r.say(input);
  assert.match(r.ids['memory-list'].textContent,/当前不参与回应/);assert.match(r.ids['memory-list'].textContent,/窗边/);
  await r.say(inputs[3]);assert.doesNotMatch(r.ids['memory-list'].textContent,/当前不参与回应/);assert.match(r.ids['memory-list'].textContent,/我现在喜欢咸味/);
  const next=setup({store:r.store});assert.doesNotMatch(next.ids['memory-list'].textContent,/当前不参与回应/);assert.equal(next.model.calls(),0);
});

test('offline commands can revise and forget a displayed opaque reference without silently reviving a stale one',async()=>{
  const r=setup();await r.offline();await r.say('/记住 note_visit 来访 | 一起听风');
  const handle=r.app.snapshot().visible.memories[0].recallHandle;assert.match(handle,/^memory_[1-9][0-9]*$/);assert.match(r.ids['memory-list'].textContent,new RegExp('引用 '+handle));
  await r.say('/记住 '+handle+' 新的约定 | 一起看天亮');assert.equal(r.app.snapshot().state.memories.length,1);assert.match(r.ids['memory-list'].textContent,/一起看天亮/);
  await r.say('/忘记 '+handle);assert.equal(r.ids['memory-count'].textContent,'00');const state=r.app.snapshot().state;
  await r.say('/记住 '+handle+' 旧的编号 | 不应重建');assert.equal(r.app.snapshot().state,state);assert.equal(r.app.snapshot().lastFailure.rule,'MEMORY_HANDLE_INVALID');assert.match(r.ids['request-error-text'].textContent,/记忆引用已失效/);assert.match(r.ids['request-error-text'].textContent,/现在显示的引用编号/);
});

test('fresh entry is silent, has independent pack selection, and never reads or rewrites legacy saves',async()=>{
  const legacy='private old save',store=new Map([['her-world.prologue.v3',legacy],['her-world.prologue.v2','old'],['other','keep']]);
  const r=setup({store});assert.equal(r.model.calls(),0);assert.equal(r.app.snapshot().mode,null);assert.equal(r.ids['pack-select'].children.length,2);assert.match(r.ids['intro-eyebrow'].textContent,/内容包说明/);assert(!r.ids['intro-copy'].textContent.includes('story.answer'));assert.equal(store.size,3);
  await r.say('你好');assert(r.ids['connect-dialog'].open);assert.equal(r.model.calls(),0);assert.equal(store.get('her-world.prologue.v3'),legacy);
});
test('offline hints only fill; accepted object and memory updates reach their own panels without milestones',async()=>{
  const r=setup();await r.offline();const hint=r.ids['hint-list'].children[0],before=r.app.snapshot().state;await hint.emit('click');assert.equal(r.ids['free-input'].value,'/新建 长椅');assert.equal(r.app.snapshot().state,before);assert.equal(r.model.calls(),0);
  await r.say('/新建 长椅');assert.equal(r.app.snapshot().visible.world.objects.length,1);assert.match(r.ids['objects-list'].textContent,/长椅/);assert.equal(r.ids['object-count'].textContent,'01');assert.equal(r.app.snapshot().state.story.completed.length,0);
  await r.say('/记住 note_visit 来访 | 今天在窗边聊过');assert.equal(r.ids['memory-count'].textContent,'01');assert.match(r.ids['memory-list'].textContent,/今天在窗边聊过/);assert(r.store.has('her-world.framework.v4:rain-lab:1.0.0'));assert.equal(r.model.calls(),0);
});
test('accepted plan saves atomically, but world and memory reveal only on their corresponding sentence',async()=>{
  const r=setup({reduced:false,request:async()=>plan(['这句话留下记忆。','下一句放下纸船。'],[{afterLine:0,operations:[addMemory]},{afterLine:1,operations:[addObject]}])});await r.online();await r.say('记住窗边，放下纸船');
  assert.equal(r.app.snapshot().state.world.objects.length,1);assert.equal(r.app.snapshot().visible.world.objects.length,0);assert.equal(r.ids['memory-count'].textContent,'00');assert(r.app.snapshot().revealing);
  const restored=runtime.restore(r.store.get(r.app.snapshot().storageKey),packs.get('rain-lab'));assert(restored.ok);assert.equal(restored.state.memories.length,1);assert.equal(restored.state.world.objects.length,1);
  await r.ids['skip-reveal'].emit('click');assert.equal(r.ids['memory-count'].textContent,'01');assert.equal(r.ids['object-count'].textContent,'00');assert(!r.ids.transcript.textContent.includes('下一句'));
  await r.ids['skip-reveal'].emit('click');assert.equal(r.ids['object-count'].textContent,'00');await r.timers.advance(360);await r.ids['skip-reveal'].emit('click');assert.equal(r.ids['object-count'].textContent,'01');await r.timers.flush();assert(!r.app.snapshot().revealing);assert.equal(r.app.snapshot().state.events.filter(x=>x.type==='turn').length,1);
});
test('refresh during reveal restores final accepted state without replaying requests or credentials',async()=>{
  const r=setup({reduced:false,request:async()=>plan(['我把纸船放在窗边。'],[{afterLine:0,operations:[addObject]}])});await r.online();await r.say('造纸船');assert(r.app.snapshot().revealing);const next=setup({store:r.store,reduced:false});assert.equal(next.app.snapshot().visible.world.objects.length,1);assert(!next.app.snapshot().revealing);assert.equal(next.model.calls(),0);assert(!next.model.connected());assert.equal(next.app.snapshot().mode,null);assert.match(next.ids.transcript.textContent,/纸船/);
});
test('duplicate submits and stale response after cancel cannot double commit',async()=>{
  let finish;const r=setup({request:()=>new Promise(resolve=>finish=resolve)});await r.online();const first=r.app.submit('放一只纸船');assert(r.app.snapshot().busy);assert.equal(await r.app.submit('第二遍'),false);assert.equal(r.model.calls(),1);
  const before=r.app.snapshot().state;await r.ids['cancel-pending'].emit('click');finish(plan(['纸船来了。'],[{afterLine:0,operations:[addObject]}]));await first;assert.equal(r.app.snapshot().state,before);assert.equal(r.ids['object-count'].textContent,'00');assert(!r.app.snapshot().busy);
});
test('newer manual navigation wins over a proposed panel, while accepted content still updates',async()=>{
  let finish;const r=setup({request:()=>new Promise(resolve=>finish=resolve)});await r.online();const sending=r.app.submit('造纸船');await r.ids['tab-memory'].emit('click');finish(plan(['纸船来了。'],[{afterLine:0,operations:[addObject,{type:'panel.open',panel:'world'}]}]));await sending;assert.equal(r.app.snapshot().activePanel,'memory');assert.equal(r.ids['object-count'].textContent,'01');assert(!r.ids['panel-memory'].hidden);
});
test('invalid plan leaves dialogue, world, memory and storage unchanged and only reports a safe failure',async()=>{
  const secret='do not expose provider response';const r=setup({request:async()=>({schema:'wrong',lines:[secret],beats:[],topic:null})});await r.online();const before=r.app.snapshot().state;await r.say('造纸船');assert.equal(r.app.snapshot().state,before);assert(!r.ids['request-error'].hidden);assert(!r.ids.transcript.textContent.includes(secret));assert(!r.ids['developer-content'].textContent.includes(secret));assert.equal(r.store.size,0);
});
test('a full placement area explains how to make room without displaying or saving a rejected success',async()=>{
  const cloud={type:'world.create',object:{label:'大云',glyphs:Array(4).fill('C'.repeat(24)).join('\n'),scale:3},placement:{anchor:'sky'}};
  const success='两朵大云已经放好了。',r=setup({request:async()=>plan([success],[{afterLine:0,operations:[addMemory,cloud,cloud]}])});
  await r.online();const before=r.app.snapshot().state;await r.say('添两朵大云');
  assert.equal(r.app.snapshot().state,before);assert.equal(r.app.snapshot().visible.world.objects.length,0);assert.equal(r.app.snapshot().visible.memories.length,0);assert.equal(r.store.size,0);assert.equal(r.app.snapshot().revealing,false);
  assert.equal(r.ids['request-error'].hidden,false);assert.match(r.ids['request-error-text'].textContent,/没有找到能安全放下/);assert.match(r.ids['request-error-text'].textContent,/缩小物件、换个位置/);assert.match(r.ids['request-error-text'].textContent,/没有保存或改变/);
  assert.deepEqual(r.app.snapshot().lastFailure,{code:'invalid',rule:'PLACEMENT_CAPACITY',stage:'RUNTIME',reason:'OPERATION_REJECTED',path:'beats[0].operations[2]',beatIndex:0,operationIndex:2,operationType:'world.create'});assert.match(r.ids['developer-content'].textContent,/PLACEMENT_CAPACITY/);assert(!r.ids.transcript.textContent.includes(success));assert.equal(r.ids['reveal-announcement'].textContent,'');
});
test('manual retry and explicit offline fallback never happen automatically',async()=>{
  const r=setup({request:async()=>{throw {code:'network',message:'UNSAFE_DETAIL'};}});await r.online();await r.say('/新建 长椅');assert.equal(r.model.calls(),1);assert.equal(r.app.snapshot().visible.world.objects.length,0);assert(!r.ids['request-error-text'].textContent.includes('UNSAFE_DETAIL'));await r.ids['fallback-button'].emit('click');assert.equal(r.model.calls(),1);assert.equal(r.app.snapshot().mode,'offline');assert.equal(r.app.snapshot().visible.world.objects.length,1);assert(!r.model.connected());
});
test('reset is confirmed, drops connection, and affects only the selected framework save',async()=>{
  const r=setup({store:new Map([['her-world.prologue.v3','preserve'],['her-world.prologue.v2','preserve too'],['unrelated','yes'],['her-world.framework.v4:lantern-lab:1.0.0','other fixture']])});await r.offline();await r.say('/新建 长椅');const before=r.app.snapshot().state;await r.ids['reset-button'].emit('click');r.ids['reset-dialog'].close();assert.equal(r.app.snapshot().state,before);await r.ids['reset-button'].emit('click');await r.ids['confirm-reset'].emit('click');assert.equal(r.app.snapshot().state.world.objects.length,0);assert.equal(r.app.snapshot().mode,null);assert.equal(r.store.get('her-world.prologue.v3'),'preserve');assert.equal(r.store.get('her-world.prologue.v2'),'preserve too');assert.equal(r.store.get('unrelated'),'yes');assert.equal(r.store.get('her-world.framework.v4:lantern-lab:1.0.0'),'other fixture');
});
test('storage blocked and corrupted saves fail visibly while the current page remains playable',async()=>{
  const r=setup({blocked:true});await r.offline();await r.say('/新建 长椅');assert.equal(r.app.snapshot().state.world.objects.length,1);assert.match(r.ids['save-status'].textContent,/存储不可用/);
  const bad=setup({store:new Map([['her-world.framework.v4:rain-lab:1.0.0','bad json']])});assert.equal(bad.app.snapshot().state.revision,0);assert.match(bad.ids.toast.textContent,/未通过校验/);await bad.offline();await bad.say('/新建 长椅');assert.equal(bad.app.snapshot().state.world.objects.length,1);
});
test('password is cleared on submit/dismiss, absent from saves and diagnostics, and pagehide disconnects',async()=>{
  const r=setup();await r.online();assert.equal(r.ids['api-key'].value,'');assert.equal(r.model.calls(),0);await r.say('你好');assert(![...r.store.values()].join('').includes('TEST_ONLY_PASSWORD'));assert(!r.ids['developer-content'].textContent.includes('TEST_ONLY_PASSWORD'));r.ids['api-key'].value='ABANDONED_PASSWORD';r.ids['connect-dialog'].close();assert.equal(r.ids['api-key'].value,'');await r.event('pagehide');assert(!r.model.connected());assert.equal(r.app.snapshot().mode,null);
});
test('pack switch cancels stale work and keeps separate saves; keyboard navigation and actual panel observation work',async()=>{
  const r=setup();await r.offline();await r.say('/新建 长椅');const oldKey=r.app.snapshot().storageKey;r.ids['pack-select'].value='lantern-lab';await r.ids['pack-select'].emit('change');assert.equal(r.app.snapshot().state.pack.id,'lantern-lab');assert.equal(r.app.snapshot().visible.world.objects.length,0);assert(r.store.has(oldKey));await r.ids['tab-world'].emit('keydown',{key:'ArrowRight'});assert.equal(r.app.snapshot().activePanel,'memory');assert(r.ids['tab-memory'].focused);assert.equal(r.app.snapshot().state.events.at(-1).panel,'memory');
});
test('reduced motion settles reveal once without duplicate events',async()=>{
  const r=setup({reduced:false,request:async()=>plan(['第一句。','第二句。'],[{afterLine:1,operations:[addObject]}])});await r.online();await r.say('纸船');r.media.fn({matches:true});assert(!r.app.snapshot().revealing);assert.equal(r.ids['object-count'].textContent,'01');const text=r.ids.transcript.textContent;await r.timers.flush();assert.equal(r.ids.transcript.textContent,text);assert.equal(r.app.snapshot().state.events.filter(x=>x.type==='turn').length,1);
});
test('unchanged world does not redraw on a no-op conversation or tab navigation',async()=>{
  const r=setup();await r.offline();const count=r.draws.length;await r.say('你好');assert.equal(r.draws.length,count);await r.ids['tab-memory'].emit('click');assert.equal(r.draws.length,count);
});
test('renderer only paints monochrome printable character marks and skips identical world updates',()=>{
  const calls=[],ctx={setTransform(){},clearRect(){},fillText(char){calls.push({char,color:this.fillStyle});},set font(v){},set textBaseline(v){},fillStyle:''},canvas=new Element('canvas');canvas.getContext=()=>ctx;
  const render=renderer.create(canvas,{window:{}}),view=runtime.view(runtime.create(packs.get('rain-lab')));assert.equal(render.update(view),true);assert(calls.length>0);assert(calls.every(c=>/^[\x20-\x7e]$/.test(c.char)));assert.equal(new Set(calls.map(c=>c.color)).size,1);const before=calls.length;assert.equal(render.update(view),false);assert.equal(calls.length,before);
});
test('actual HTML script order boots in a browser-like global realm without hidden dependencies',()=>{
  const {ids,document}=dom(),events={},timers=clock(),store=new Map();
  const sandbox={document,console,URL,URLSearchParams,AbortController,TextEncoder,TextDecoder,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,location:{href:'http://localhost/framework.html',search:''},localStorage:{getItem:key=>store.get(key)||null,setItem:(k,v)=>store.set(k,v)},matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener:(n,f)=>events[n]=f,removeEventListener(){},fetch:()=>{throw Error('unexpected network');}};sandbox.window=sandbox;sandbox.globalThis=sandbox;vm.createContext(sandbox);
  for(const match of html.matchAll(/<script src="\.\/([^"]+)" defer><\/script>/g)){const filename=path.join(__dirname,'..',match[1].split('?')[0]);assert(fs.existsSync(filename),match[1]+' missing');vm.runInContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});}
  assert(sandbox.herFrameworkApp,'auto boot did not create app');assert.equal(sandbox.herFrameworkApp.snapshot().state.pack.id,'rain-lab');assert.equal(ids['pack-select'].children.length,2);assert.equal(store.size,0);
});

test('corrupt or wrong-pack saves remain byte-for-byte protected until an explicit confirmed reset',async()=>{
  const key='her-world.framework.v4:rain-lab:1.0.0';
  for(const raw of ['bad{json', JSON.stringify(runtime.serialize(runtime.create(packs.get('lantern-lab'))))]){
    const store=new Map([[key,raw]]),r=setup({store});await r.offline();await r.ids['tab-logs'].emit('click');await r.say('/新建 长椅');assert.equal(store.get(key),raw);assert.match(r.ids['save-status'].textContent,/原存档已保护/);assert.equal(r.app.snapshot().state.world.objects.length,1);
    await r.ids['reset-button'].emit('click');r.ids['reset-dialog'].close();assert.equal(store.get(key),raw);await r.ids['reset-button'].emit('click');await r.ids['confirm-reset'].emit('click');assert.notEqual(store.get(key),raw);assert(runtime.restore(store.get(key),packs.get('rain-lab')).ok);
  }
});
test('legacy copy is explicitly confirmed, retains the original bytes and never invents a missing import',async()=>{
  const missing=setup();await missing.ids['legacy-import-button'].emit('click');assert.match(missing.ids.toast.textContent,/未找到旧序章存档/);assert(!missing.ids['legacy-dialog'].open);
  const raw=JSON.stringify(oldEngine.start(oldEngine.create())),store=new Map([['her-world.prologue.v3',raw]]),r=setup({store});await r.offline();await r.say('/新建 长椅');const before=r.app.snapshot().state;
  await r.ids['legacy-import-button'].emit('click');assert(r.ids['legacy-dialog'].open);assert.equal(r.app.snapshot().state,before);r.ids['legacy-dialog'].close();assert.equal(r.app.snapshot().state,before);await r.ids['legacy-import-button'].emit('click');await r.ids['confirm-legacy-import'].emit('click');assert.equal(store.get('her-world.prologue.v3'),raw);assert.equal(r.app.snapshot().state.world.objects.length,0);assert.equal(r.app.snapshot().mode,null);assert(r.app.snapshot().state.importedSnapshot);assert(runtime.restore(store.get(r.app.snapshot().storageKey),packs.get('rain-lab')).ok);
});
test('offline examples fill commands without mutation and choice hints include explicit offline syntax',async()=>{
  const r=setup();await r.offline();const before=r.app.snapshot().state;await r.ids['offline-help-button'].emit('click');assert(r.ids['offline-help-dialog'].open);assert(r.ids['offline-examples'].children.length>=15);const memory=r.ids['offline-examples'].children.find(n=>n.textContent.startsWith('/记住'));await memory.emit('click');assert(r.ids['free-input'].value.startsWith('/记住'));assert(!r.ids['offline-help-dialog'].open);assert.equal(r.app.snapshot().state,before);
});
test('safe diagnostics retain allowlisted HTTP/stage/code while omitting arbitrary strings',async()=>{
  const r=setup({request:async()=>{throw {code:'format',httpStatus:200,diagnostic:{stage:'JSON',code:'JSON_SYNTAX',path:'content'},message:'PASSWORD_MUST_NOT_APPEAR'};}});await r.online();await r.say('你好');assert.match(r.ids['request-error-text'].textContent,/HTTP 200/);assert.match(r.ids['developer-content'].textContent,/JSON_SYNTAX/);assert(!r.ids['developer-content'].textContent.includes('PASSWORD_MUST_NOT_APPEAR'));
});
test('held space does not skip and a single space only settles the active sentence',async()=>{
  const r=setup({reduced:false,request:async()=>plan(['第一句。','第二句。'])});await r.online();await r.say('你好');await r.event('keydown',{code:'Space',repeat:true,target:{tagName:'DIV'},preventDefault(){}});assert(!r.ids.transcript.textContent.includes('第一句。'));await r.event('keydown',{code:'Space',repeat:false,target:{tagName:'DIV'},preventDefault(){}});assert(r.ids.transcript.textContent.includes('第一句。'));assert(!r.ids.transcript.textContent.includes('第二句。'));await r.timers.flush();assert(!r.app.snapshot().revealing);
});

test('independent workshop branch follows its displayed question and completes a real visible world observation',async()=>{
  const r=setup({search:'?pack=lantern-lab'});await r.offline();assert.match(r.ids['invitation-question'].textContent,/做什么/);await r.say('/回答 坐下来读书');assert.match(r.ids['invitation-question'].textContent,/添上什么/);await r.say('/新建 长椅');assert.equal(r.app.snapshot().state.facts.world_seen,true);assert.match(r.ids['invitation-question'].textContent,/留在这里/);await r.say('/回答 留在这里');assert.match(r.ids['invitation-question'].textContent,/保留哪个细节/);assert(!r.ids['invitation-question'].textContent.includes('最远'));assert(!r.ids['invitation-question'].textContent.includes('描述一场雨'));
});
test('switching packs or confirming reset during an outstanding request makes its late result inert',async()=>{
  for(const action of ['switch','reset']){
    let finish;const r=setup({request:()=>new Promise(resolve=>finish=resolve)});await r.online();const sending=r.app.submit('纸船');
    if(action==='switch'){r.ids['pack-select'].value='lantern-lab';await r.ids['pack-select'].emit('change');}else{await r.ids['reset-button'].emit('click');await r.ids['confirm-reset'].emit('click');}
    const before=r.app.snapshot().state;finish(plan(['迟到的纸船'],[{afterLine:0,operations:[addObject]}]));await sending;assert.equal(r.app.snapshot().state,before);assert.equal(r.app.snapshot().visible.world.objects.length,0);assert(!r.ids.transcript.textContent.includes('迟到'));
  }
});

test('diagnostic fields reject uppercase secret-shaped tokens that are not explicit runtime or transport codes',async()=>{
  const r=setup({request:async()=>{throw {code:'invalid',ruleCode:'PASSWORD_DO_NOT_PRINT',diagnostic:{stage:'JSON',code:'PASSWORD_DO_NOT_PRINT',path:'PASSWORD_DO_NOT_PRINT'}};}});await r.online();await r.say('你好');assert(!r.ids['developer-content'].textContent.includes('PASSWORD_DO_NOT_PRINT'));assert(!r.ids['request-error-text'].textContent.includes('PASSWORD_DO_NOT_PRINT'));assert.equal(r.app.snapshot().lastFailure.code,'invalid');
});

function animatedRenderer(options={}){
  let time=0,serial=0;const scheduled=new Map(),allCallbacks=[],frames=[];
  const ctx={setTransform(){},clearRect(){frames.push([]);},fillText(char,x,y){frames.at(-1).push({char,x,y,font:this.font,alpha:this.globalAlpha,color:this.fillStyle});},font:'',globalAlpha:1,fillStyle:''};
  const canvas=new Element('canvas');canvas.getContext=()=>ctx;
  const win={requestAnimationFrame(fn){const id=++serial;scheduled.set(id,fn);allCallbacks.push(fn);return id;},cancelAnimationFrame(id){scheduled.delete(id);},matchMedia:()=>({matches:!!options.reduced}),addEventListener(){},removeEventListener(){}};
  const render=renderer.create(canvas,{window:win});
  function step(ms=16){time+=ms;const next=[...scheduled.values()];scheduled.clear();next.forEach(fn=>fn(time));}
  function run(ms){for(let elapsed=0;elapsed<ms;elapsed+=16)step(Math.min(16,ms-elapsed));}
  const view=(objects=[],weather={kind:'rain',intensity:0,paused:true},id='test')=>({pack:{id,version:'1'},world:{grid:{cols:100,rows:60},landmarks:{},objects,weather}});
  return{render,view,step,run,frames,scheduled,allCallbacks,pixels:()=>frames.at(-1),time:()=>time};
}
test('continuous rain has deterministic falling character positions and exactly one animation loop',()=>{
  const a=animatedRenderer(),b=animatedRenderer();const rain={kind:'rain',intensity:2,paused:false};a.render.update(a.view([],rain));b.render.update(b.view([],rain));assert.equal(a.scheduled.size,1);assert.equal(b.scheduled.size,1);const first=a.pixels()[0];
  a.step();b.step();a.run(320);b.run(320);assert.deepEqual(a.pixels(),b.pixels());assert.notEqual(a.pixels()[0].y,first.y);assert(a.pixels().every(p=>p.char==='|'&&p.color==='#aab2b7'));assert.equal(a.scheduled.size,1);
  const frames=a.frames.length;assert.equal(a.render.update(a.view([],rain)),false);a.render.resume();a.render.resume();assert.equal(a.scheduled.size,1);assert.equal(a.frames.length,frames);a.render.destroy();b.render.destroy();assert.equal(a.scheduled.size,0);
});
test('object appearance, movement, scale and removal interpolate before settling without mutating accepted state',()=>{
  const r=animatedRenderer(),object={id:'obj_1',label:'测试',glyphs:'@',x:10,y:20,scale:1};r.render.update(r.view());const accepted=r.view([object]);const bytes=JSON.stringify(accepted);r.render.update(accepted);assert.equal(r.pixels().length,0);r.step();r.run(360);let mark=r.pixels()[0];assert(mark.alpha>0&&mark.alpha<1);r.run(400);assert.equal(r.pixels()[0].alpha,1);assert.equal(r.scheduled.size,0);const initial=r.pixels()[0];
  const moved={...object,x:70,y:30,scale:3};r.render.update(r.view([moved]));assert.equal(r.pixels()[0].x,initial.x);r.step();r.run(360);const midpoint=r.pixels()[0];assert(midpoint.x>initial.x);assert(parseFloat(midpoint.font)>parseFloat(initial.font));r.run(400);const settled=r.pixels()[0];assert(midpoint.x<settled.x);assert(parseFloat(midpoint.font)<parseFloat(settled.font));assert.equal(r.scheduled.size,0);
  r.render.update(r.view());assert.equal(r.pixels()[0].alpha,1);r.step();r.run(360);assert(r.pixels()[0].alpha>0&&r.pixels()[0].alpha<1);r.run(400);assert.equal(r.pixels().length,0);assert.equal(r.scheduled.size,0);assert.equal(JSON.stringify(accepted),bytes);
});
test('retargeting an object mid-transition starts from its visible position instead of jumping',()=>{
  const r=animatedRenderer(),object={id:'obj_1',glyphs:'@',x:10,y:20,scale:1};r.render.update(r.view([object]));r.render.update(r.view([{...object,x:80}]));r.step();r.run(240);const current=r.pixels()[0].x;r.render.update(r.view([{...object,x:25}]));assert.equal(r.pixels()[0].x,current);r.run(800);assert.equal(r.scheduled.size,0);assert(r.pixels()[0].x<current);
});
test('reduced motion settles geometry, freezes rain, and resumes at most one loop when enabled again',()=>{
  const r=animatedRenderer({reduced:true}),rain={kind:'rain',intensity:2,paused:false},object={id:'obj_1',glyphs:'@',x:10,y:20,scale:1};r.render.update(r.view([object],rain));assert.equal(r.scheduled.size,0);const before=r.pixels().find(p=>p.char==='@');r.render.update(r.view([{...object,x:70}],rain));assert(r.pixels().find(p=>p.char==='@').x>before.x);assert.equal(r.scheduled.size,0);
  r.render.setReducedMotion(false);r.render.setReducedMotion(false);assert.equal(r.scheduled.size,1);r.step();r.run(80);r.render.setReducedMotion(true);assert.equal(r.scheduled.size,0);const pixels=r.pixels();r.run(1000);assert.equal(r.pixels(),pixels);
});
test('suspend cancels pending frames, stale callbacks stay inert and repeated resume cannot duplicate loops',()=>{
  const r=animatedRenderer();r.render.update(r.view([],{kind:'rain',intensity:1,paused:false}));const stale=r.allCallbacks.at(-1);r.render.suspend();assert.equal(r.scheduled.size,0);const before=r.frames.length;stale(1000);assert.equal(r.frames.length,before);assert.equal(r.scheduled.size,0);r.render.resume();r.render.resume();assert.equal(r.scheduled.size,1);r.step();r.render.destroy();assert.equal(r.scheduled.size,0);const last=r.frames.length;r.allCallbacks.at(-1)(2000);r.render.resume();r.render.update(r.view());assert.equal(r.frames.length,last);assert.equal(r.scheduled.size,0);
});
test('stopping weather settles and ends the loop; pack switches discard prior scene transitions',()=>{
  const r=animatedRenderer(),rain={kind:'rain',intensity:2,paused:false};r.render.update(r.view([],rain));r.step();r.run(80);r.render.update(r.view([],{...rain,paused:true}));r.run(700);assert.equal(r.pixels().length,0);assert.equal(r.scheduled.size,0);
  r.render.update(r.view([{id:'obj_1',glyphs:'@',x:10,y:20,scale:1}]));assert.equal(r.scheduled.size,1);r.render.update(r.view([],undefined,'another-pack'));assert.equal(r.scheduled.size,0);assert.equal(r.pixels().length,0);
});
test('motion control and page lifecycle reach the renderer, and an untouched introduction hides competing response content',async()=>{
  const r=setup({reduced:false});assert.equal(r.ids['response-area'].hidden,true);assert.equal(r.ids.intro.hidden,false);assert.equal(r.motionCalls.at(-1),false);await r.offline();assert.equal(r.ids['response-area'].hidden,false);assert.equal(r.ids.intro.hidden,true);await r.ids['motion-toggle'].emit('click');assert.equal(r.motionCalls.at(-1),true);await r.ids['motion-toggle'].emit('click');assert.equal(r.motionCalls.at(-1),false);await r.event('pagehide');assert.equal(r.lifecycle().suspends,1);await r.event('pageshow');assert.equal(r.lifecycle().resumes,1);r.media.fn({matches:true});assert.equal(r.motionCalls.at(-1),true);assert(r.ids['motion-toggle'].disabled);r.app.destroy();assert.equal(r.lifecycle().rendererDestroyed,1);await r.event('pageshow');assert.equal(r.lifecycle().resumes,1);
});

test('edge morph clamps both fading footprints to the logical grid and retains exact final geometry',()=>{
  const r=animatedRenderer(),initial={id:'obj_1',glyphs:'@',x:99,y:59,scale:1};
  const final={...initial,glyphs:Array(10).fill('#'.repeat(24)).join('\n'),x:0,y:0,scale:3};
  const cell=Math.min(650/110,360/93),line=cell*1.3,left=(650-100*cell)/2,top=(360-60*line)/2;
  const assertBounds=()=>{for(const pixel of r.pixels()){const scale=parseFloat(pixel.font)/(cell*1.65);assert(pixel.x>=left-1e-8);assert(pixel.y>=top-1e-8);assert(pixel.x+cell*scale<=left+100*cell+1e-8,JSON.stringify(pixel));assert(pixel.y+line*scale<=top+60*line+1e-8,JSON.stringify(pixel));}};
  r.render.update(r.view([initial]));r.render.update(r.view([final]));r.step();for(let i=0;i<50;i++){r.step();assertBounds();}
  assert.equal(r.pixels().length,240);assert.equal(r.pixels()[0].x,left);assert.equal(r.pixels()[0].y,top);assert.equal(parseFloat(r.pixels()[0].font),cell*1.65*3);
  r.render.update(r.view([initial]));for(let i=0;i<50;i++){r.step();assertBounds();}assert.equal(r.pixels().length,1);assert.equal(r.pixels()[0].x,left+99*cell);assert.equal(r.pixels()[0].y,top+59*line);
});
test('rapid eight-object replacements retain at most eight departing plus eight current visible objects, including suspension',()=>{
  const r=animatedRenderer(),batch=n=>Array.from({length:8},(_,i)=>({id:'obj_'+(n*8+i),glyphs:'@',x:i*10,y:20,scale:1}));r.render.update(r.view(batch(0)));
  for(let n=1;n<=40;n++){r.render.update(r.view(batch(n)));r.step();r.step();assert(r.pixels().length<=16,'departures grew without bound');}
  r.render.suspend();for(let n=41;n<=100;n++)r.render.update(r.view(batch(n)));assert.equal(r.scheduled.size,0);r.render.resume();for(let i=0;i<55;i++){r.step();assert(r.pixels().length<=16,'suspended departures grew without bound');}assert.equal(r.pixels().length,8);assert.equal(r.scheduled.size,0);
});
test('clear and unsupported weather kinds never paint rain even while fading from active rain',()=>{
  for(const kind of ['clear','unsupported']){const r=animatedRenderer();r.render.update(r.view([],{kind:'rain',intensity:2,paused:false}));r.step();r.run(80);assert(r.pixels().length>0);r.render.update(r.view([],{kind,intensity:2,paused:false}));assert.equal(r.pixels().length,0);for(let i=0;i<45;i++){r.step();assert.equal(r.pixels().length,0);}assert.equal(r.scheduled.size,0);}
});

function historicalSave(rulesVersion='1',id='rain-lab',eventPlan){
  const digests={'rain-lab':{'1':'402db16c','2':'362c6f2f','3':'d63194b2'},'lantern-lab':{'1':'8dd7d018','2':'36792093','3':'ce388026'}};
  // Historical turns had neither a rulesVersion marker nor normalized placement policies.
  const saved={schema:'her-world-save-v4',pack:{id,version:'1.0.0',rulesVersion,digest:digests[id][rulesVersion]},importedSnapshot:null,events:eventPlan?[{id:'event_1',type:'turn',input:'测试旧规则记录',plan:eventPlan}]:[]};
  if(rulesVersion==='3') for(const event of saved.events){event.rulesVersion='3';event.plan=JSON.parse(JSON.stringify(event.plan));for(const beat of event.plan.beats)for(const op of beat.operations)if(op.type==='world.create')op.placementPolicy='exact';}
  return JSON.stringify(saved,null,2)+'\n';
}
test('rules1, rules2 and rules3 migrations back up exact bytes once before a rules4 save can overwrite them',async()=>{
  for(const version of ['1','2','3']){
    const key='her-world.framework.v4:rain-lab:1.0.0',raw=historicalSave(version,'rain-lab',plan(['旧版纸船。'],[{afterLine:0,operations:[addObject]}])),store=new Map([[key,raw]]),writes=[];
    const r=setup({store,writes});assert.equal(r.app.snapshot().state.world.objects.length,1);assert.equal(r.app.snapshot().state.pack.rulesVersion,'4');const backups=[...store].filter(([k])=>k.includes(':backup:rules'+version+':'));assert.equal(backups.length,1);assert.equal(backups[0][1],raw);assert.equal(store.get(key),raw);assert.match(r.ids['save-status'].textContent,/旧存档已备份/);
    const again=setup({store,writes});assert.equal([...store.keys()].filter(k=>k.includes(':backup:')).length,1);assert.equal(writes.length,1);await again.offline();await again.say('/天气 恢复');assert.equal(JSON.parse(store.get(key)).pack.rulesVersion,'4');assert.equal(store.get(backups[0][0]),raw);assert.equal(writes[0].key,backups[0][0]);assert(writes.slice(1).some(w=>w.key===key));
  }
});
test('failed or unverified migration backup keeps the original save protected through new turns and panel observations',async()=>{
  const key='her-world.framework.v4:rain-lab:1.0.0';
  for(const version of ['1','2','3'])for(const fault of ['throw','drop']){
    const raw=historicalSave(version),store=new Map([[key,raw]]),r=setup({store,...(fault==='throw'?{writeFails:k=>k.includes(':backup:')}:{dropWrites:k=>k.includes(':backup:')})});assert.equal(r.app.snapshot().state.pack.rulesVersion,'4');assert.match(r.ids['save-status'].textContent,/备份失败/);await r.offline();await r.ids['tab-logs'].emit('click');await r.say('/新建 长椅');assert.equal(store.get(key),raw);assert.equal(r.app.snapshot().state.world.objects.length,1);assert.match(r.ids['save-status'].textContent,/本页未保存/);
  }
});
test('a conflicting deterministic migration backup is never replaced or used to authorize overwrite',async()=>{
  for(const version of ['1','2','3']){
    const key='her-world.framework.v4:rain-lab:1.0.0',raw=historicalSave(version),first=setup({store:new Map([[key,raw]])}),backupKey=[...first.store.keys()].find(k=>k.includes(':backup:'));
    assert(backupKey);const store=new Map([[key,raw],[backupKey,'different existing original']]),r=setup({store});await r.offline();await r.say('/新建 长椅');assert.equal(store.get(key),raw);assert.equal(store.get(backupKey),'different existing original');assert.match(r.ids['save-status'].textContent,/备份失败/);
  }
});

test('the second fixture also migrates into its own verified backup without touching the first fixture',async()=>{
  for(const version of ['1','2','3']){
    const key='her-world.framework.v4:lantern-lab:1.0.0',other='her-world.framework.v4:rain-lab:1.0.0',raw=historicalSave(version,'lantern-lab'),store=new Map([[key,raw],[other,'first fixture remains untouched']]);
    const r=setup({store,search:'?pack=lantern-lab'});assert.equal(r.app.snapshot().state.pack.rulesVersion,'4');const backup=[...store.entries()].find(([k])=>k.startsWith(key+':backup:rules'+version+':'));assert(backup);assert.equal(backup[1],raw);await r.offline();await r.say('/新建 长椅');assert.equal(JSON.parse(store.get(key)).pack.rulesVersion,'4');assert.equal(store.get(other),'first fixture remains untouched');
  }
});
test('rules2 overlapping clouds retain their exact history while the next saved turn uses rules4 with collision-safe placement',async()=>{
  const cloud={type:'world.create',object:{label:'云',glyphs:' (____)\n(______)',scale:1},placement:{anchor:'sky'}};
  const oldPlan=plan(['原来的两朵云。'],[{afterLine:0,operations:[cloud,cloud]}]),raw=historicalSave('2','rain-lab',oldPlan),key='her-world.framework.v4:rain-lab:1.0.0',store=new Map([[key,raw]]);
  const r=setup({store,request:async()=>plan(['又添了一朵云。'],[{afterLine:0,operations:[cloud]}])}),original=r.app.snapshot().state.world.objects;
  assert.equal(original.length,2);assert.equal(original[0].x,original[1].x);assert.equal(original[0].y,original[1].y);assert.deepEqual(r.app.snapshot().state.events[0].plan,oldPlan);assert.equal(r.app.snapshot().state.events[0].rulesVersion,'2');
  const backup=[...store].find(([k])=>k.includes(':backup:rules2:'));assert(backup);assert.equal(backup[1],raw);assert.equal(store.get(key),raw);
  await r.online();await r.say('再添一朵云');const state=r.app.snapshot().state;
  assert.equal(state.world.objects.length,3);assert.deepEqual(state.world.objects.slice(0,2),original);const newest=state.world.objects[2];assert(original.every(old=>newest.x>=old.x+8||newest.x+8<=old.x||newest.y>=old.y+2||newest.y+2<=old.y));
  const saved=JSON.parse(store.get(key));assert.equal(saved.pack.rulesVersion,'4');assert.equal(saved.events[0].rulesVersion,'2');assert.equal(saved.events.at(-1).rulesVersion,'4');assert.deepEqual(saved.events[0].plan,oldPlan);assert.equal(store.get(backup[0]),raw);
  const refreshed=setup({store});assert.deepEqual(refreshed.app.snapshot().state,state);assert.equal([...store.keys()].filter(k=>k.includes(':backup:')).length,1);assert.equal(refreshed.model.calls(),0);
});
test('unrecognized migration metadata cannot create a backup or allow the original save to be overwritten',async()=>{
  const key='her-world.framework.v4:rain-lab:1.0.0',raw=historicalSave('2');
  const changes=[{type:'unknown-migration'},{fromRulesVersion:'1'},{toRulesVersion:'2'},{fromPackDigest:'00000000'},{toPackDigest:'00000000'},{extra:'unexpected'}];
  for(const change of changes){
    const wrapped={...runtime,restore(raw,pack){const result=runtime.restore(raw,pack);assert(result.ok);return {...result,migration:{...result.migration,...change}};}},store=new Map([[key,raw]]),r=setup({store,runtime:wrapped});
    assert.match(r.ids['save-status'].textContent,/备份失败/);await r.offline();await r.say('/新建 长椅');assert.equal(store.get(key),raw);assert.equal(store.size,1);assert.equal(r.app.snapshot().state.world.objects.length,1);assert.match(r.ids['save-status'].textContent,/本页未保存/);
  }
});
test('failed migration validation preserves the original storage key while a fresh page remains usable',async()=>{
  const key='her-world.framework.v4:rain-lab:1.0.0';
  for(const invalid of ['digest','event-marker']){
    const saved=JSON.parse(historicalSave('2','rain-lab',plan(['旧物件。'],[{afterLine:0,operations:[addObject]}])));
    if(invalid==='digest')saved.pack.digest='00000000';else saved.events[0].rulesVersion='3';
    const raw=JSON.stringify(saved),store=new Map([[key,raw]]),r=setup({store});assert.equal(r.app.snapshot().state.world.objects.length,0);assert.match(r.ids['save-status'].textContent,/原存档已保护/);
    await r.offline();await r.ids['tab-logs'].emit('click');await r.say('/新建 长椅');assert.equal(r.app.snapshot().state.world.objects.length,1);assert.equal(store.get(key),raw);assert.equal(store.size,1);assert.match(r.ids['save-status'].textContent,/本页未保存/);
  }
});

test('completed reply announcements clear on pack load and confirmed reset without changing the previous pack transcript',async()=>{
  const r=setup({search:'?pack=lantern-lab'});await r.offline();await r.say('让雨继续');assert.equal(r.ids['reveal-announcement'].textContent,'雨继续落下。');
  const workshopKey=r.app.snapshot().storageKey,workshopSave=r.store.get(workshopKey);r.ids['pack-select'].value='rain-lab';await r.ids['pack-select'].emit('change');assert.equal(r.ids['reveal-announcement'].textContent,'');assert.equal(r.app.snapshot().visible.world.weather.paused,true);assert.equal(r.store.get(workshopKey),workshopSave);
  await r.say('让雨继续');assert.equal(r.ids['reveal-announcement'].textContent,'雨继续落下。');await r.ids['reset-button'].emit('click');r.ids['reset-dialog'].close();assert.equal(r.ids['reveal-announcement'].textContent,'雨继续落下。');await r.ids['reset-button'].emit('click');await r.ids['confirm-reset'].emit('click');assert.equal(r.ids['reveal-announcement'].textContent,'');assert.equal(r.ids.intro.hidden,false);assert.equal(r.app.snapshot().visible.world.weather.paused,true);assert.equal(r.store.get(workshopKey),workshopSave);const restored=runtime.restore(workshopSave,packs.get('lantern-lab'));assert(restored.ok);assert(restored.state.transcript.some(line=>line.text==='雨继续落下。'));
});

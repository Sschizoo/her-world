/* Shared synthetic storage and real UI/runtime; no real browser or network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {setup,runtime,packs,plan,prepareRainQuestion}=require('./helpers/framework-ui-harness.cjs');
const KEY='her-world.framework.v4:rain-lab:1.0.0';
const restored=store=>{const r=runtime.restore(store.get(KEY),packs.get('rain-lab'));assert(r.ok);return r.state;};
const latestEvent=r=>r.app.snapshot().state.events.at(-1);
const switchPack=async(r,id)=>{r.ids['pack-select'].value=id;await r.ids['pack-select'].emit('change');};
const confirmLatest=async r=>{await r.ids['load-latest-save'].emit('click');assert(r.ids['load-latest-dialog'].open);await r.ids['confirm-load-latest'].emit('click');assert(!r.ids['load-latest-dialog'].open);};

test('stale page detects current bytes before a paid request even before its storage event arrives',async()=>{
  const store=new Map(),a=setup({store}),b=setup({store});await a.online();await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);a.ids['free-input'].value='尚未发出的草稿';
  assert.equal(await a.app.submit(),false);assert.equal(a.model.calls(),0);assert.equal(store.get(KEY),raw);assert.equal(a.app.snapshot().saveConflict,true);assert.match(a.ids['save-status'].textContent,/另一页面/);assert.equal(a.ids['free-input'].value,'尚未发出的草稿');
});
test('ordinary views and pack switches never create empty observations or replace newer progress',async()=>{
  const store=new Map(),writes=[],a=setup({store,writes}),b=setup({store});await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);
  for(let i=0;i<1005;i++)await a.ids['tab-memory'].emit('click');assert.equal(a.app.snapshot().state.events.length,0);assert.equal(writes.length,0);assert.equal(store.get(KEY),raw);
  a.ids['pack-select'].value='lantern-lab';await a.ids['pack-select'].emit('change');assert.equal(a.app.snapshot().state.events.length,0);assert.equal(writes.length,0);assert.equal(store.get(KEY),raw);
});
test('first meaningful displayed discovery persists once and remains replayable',async()=>{
  const r=setup();await prepareRainQuestion(r);const before=r.app.snapshot().state.events.length;await r.ids['tab-logs'].emit('click');assert.equal(r.app.snapshot().state.facts.records_seen,true);assert.equal(r.app.snapshot().state.events.length,before+1);assert.deepEqual(latestEvent(r).questionIds,['q_read']);const raw=r.store.get(KEY);await r.ids['tab-logs'].emit('click');assert.equal(r.store.get(KEY),raw);assert.equal(restored(r.store).facts.records_seen,true);
});
test('storage event cancels pending request without flushing stale discovery or forgetting its input',async()=>{
  const initial=setup();await prepareRainQuestion(initial);const store=initial.store;let finish,aborted=false;const a=setup({store,request:({signal})=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(resolve=>finish=resolve);}}),b=setup({store});await a.online();const sending=a.app.submit('等待中的草稿');await a.ids['tab-logs'].emit('click');await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);
  await a.event('storage',{key:KEY,newValue:raw,oldValue:null});assert.equal(a.app.snapshot().busy,false);assert(aborted);assert.equal(a.ids['free-input'].value,'等待中的草稿');finish(plan(['不应提交。']));assert.equal(await sending,false);assert.equal(store.get(KEY),raw);assert.equal(a.app.snapshot().state.facts.records_seen,undefined);assert.equal(a.model.connected(),true);
});
test('result, error, and manual cancellation detect newer bytes without waiting for storage events',async()=>{
  for(const outcome of ['success','error','cancel']){
    let yes,no;const store=new Map(),a=setup({store,request:()=>new Promise((resolve,reject)=>{yes=resolve;no=reject;})}),b=setup({store});await a.online();const sending=a.app.submit('保留这句草稿');await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);
    if(outcome==='cancel')await a.ids['cancel-pending'].emit('click');if(outcome==='error')no({code:'network'});else yes(plan(['不应提交。']));assert.equal(await sending,false);assert.equal(store.get(KEY),raw);assert.equal(a.app.snapshot().saveConflict,true);assert.equal(a.ids['free-input'].value,'保留这句草稿');
  }
});
test('loading latest replaces local progress only after confirmation and retains connection and input',async()=>{
  const store=new Map();let failWrites=true;const a=setup({store,writeFails:k=>k===KEY&&failWrites});await a.online();await a.say('本页已接受的合成对话');assert.equal(a.app.snapshot().state.events.length,1);assert(a.app.snapshot().unsaved);const local=a.app.snapshot().state;
  const b=setup({store});await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);a.ids['free-input'].value='另一句还没发送的草稿';await a.event('storage',{key:KEY,newValue:raw});
  assert(a.app.snapshot().saveConflict);await a.ids['load-latest-save'].emit('click');assert(a.ids['load-latest-dialog'].open);assert.equal(a.app.snapshot().state,local);assert.equal(store.get(KEY),raw);assert.equal(a.ids['free-input'].value,'另一句还没发送的草稿');assert(a.model.connected());
  const stay=a.document.querySelectorAll('[data-close]').find(button=>button.dataset.close==='load-latest-dialog');await stay.emit('click');assert(!a.ids['load-latest-dialog'].open);assert.equal(a.app.snapshot().state,local);assert(a.app.snapshot().saveConflict);assert(a.app.snapshot().unsaved);assert.equal(store.get(KEY),raw);assert.equal(a.ids['free-input'].value,'另一句还没发送的草稿');assert(a.model.connected());
  await confirmLatest(a);assert.equal(a.app.snapshot().saveConflict,false);assert.equal(a.app.snapshot().unsaved,false);assert.equal(a.model.connected(),true);assert.equal(a.app.snapshot().mode,'online');assert.equal(a.ids['free-input'].value,'另一句还没发送的草稿');assert.equal(a.app.snapshot().state.world.objects.length,1);assert.equal(store.get(KEY),raw);
  failWrites=false;await a.say('继续聊天');assert.equal(restored(store).world.objects.length,1);assert.equal(restored(store).events.at(-1).input,'继续聊天');
});
test('conflicts during reveal and pageshow preserve accepted local progress and newer bytes',async()=>{
  const store=new Map(),a=setup({store,reduced:false});await a.online();await a.say('本页已接受的对话');assert(a.app.snapshot().revealing);const own=JSON.stringify(runtime.serialize(a.app.snapshot().state));const b=setup({store});await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);await a.event('pageshow');assert.equal(a.app.snapshot().revealing,false);assert(a.app.snapshot().saveConflict);assert.equal(store.get(KEY),raw);assert.equal(JSON.stringify(runtime.serialize(a.app.snapshot().state)),own);await a.timers.flush();assert.equal(store.get(KEY),raw);
});
test('unsaved progress blocks pack changes, then a later successful save permits switching with the current input',async()=>{
  let failWrites=true;const store=new Map(),a=setup({store,writeFails:k=>k===KEY&&failWrites});await a.offline();await a.say('/新建 长椅');const local=a.app.snapshot().state;a.ids['free-input'].value='原试验场草稿';await a.event('storage',{key:'unrelated',newValue:'anything'});assert(!a.app.snapshot().saveConflict);assert(a.app.snapshot().unsaved);assert(a.ids['pack-select'].disabled);
  await switchPack(a,'lantern-lab');assert.equal(a.app.snapshot().storageKey,KEY);assert.equal(a.ids['pack-select'].value,'rain-lab');assert.equal(a.app.snapshot().state,local);assert.equal(a.ids['free-input'].value,'原试验场草稿');assert.equal(store.size,0);
  failWrites=false;await a.say('/新建 灯');assert(!a.app.snapshot().unsaved);assert(!a.ids['pack-select'].disabled);assert.equal(restored(store).world.objects.length,2);const raw=store.get(KEY);a.ids['free-input'].value='刚刚编辑的草稿';
  await switchPack(a,'lantern-lab');assert.equal(a.app.snapshot().storageKey,'her-world.framework.v4:lantern-lab:1.0.0');assert.equal(a.ids['free-input'].value,'刚刚编辑的草稿');assert.equal(store.get(KEY),raw);
  await switchPack(a,'rain-lab');assert.equal(a.app.snapshot().state.world.objects.length,2);assert.equal(a.ids['free-input'].value,'刚刚编辑的草稿');assert.equal(store.get(KEY),raw);
});
test('invalid newer bytes are protected and explicit loading cannot discard accepted local progress',async()=>{
  const store=new Map(),a=setup({store});await a.offline();await a.say('/新建 长椅');const before=a.app.snapshot().state;a.ids['free-input'].value='稍后继续';store.set(KEY,'unreadable newer bytes');await a.event('storage',{key:KEY,newValue:store.get(KEY)});await confirmLatest(a);assert.equal(a.app.snapshot().state,before);assert(a.app.snapshot().saveConflict);assert.equal(store.get(KEY),'unreadable newer bytes');assert.equal(a.ids['free-input'].value,'稍后继续');assert.match(a.ids.toast.textContent,/未通过校验/);
});
test('silent dropped writes are reported and existing full observation histories are readable without rewriting',async()=>{
  const a=setup({dropWrites:k=>k===KEY});await a.offline();await a.say('/新建 长椅');assert.match(a.ids['save-status'].textContent,/仅本页|未保存/);assert.equal(a.store.size,0);
  const save=runtime.serialize(runtime.create(packs.get('rain-lab'))),full={...save,events:Array.from({length:1000},(_,i)=>({id:'event_'+(i+1),type:'panel.viewed',panel:'memory',questionIds:[]}))},raw=JSON.stringify(full),writes=[],store=new Map([[KEY,raw]]),r=setup({store,writes});assert.equal(r.app.snapshot().state.events.length,1000);await r.ids['tab-memory'].emit('click');assert.equal(store.get(KEY),raw);assert.equal(writes.length,0);assert.equal(r.app.snapshot().state.events.length,1000);
});

test('same-revision different history, removed save, and clear events all latch a conflict',async()=>{
  const seed=setup();await seed.offline();await seed.say('/新建 长椅');const first=seed.store.get(KEY);const other=setup();await other.offline();await other.say('/新建 灯');const second=other.store.get(KEY);assert.equal(JSON.parse(first).events.length,JSON.parse(second).events.length);
  for(const replacement of [second,null]){const store=new Map([[KEY,first]]),a=setup({store});replacement===null?store.delete(KEY):store.set(KEY,replacement);await a.event('storage',{key:null,newValue:null});assert(a.app.snapshot().saveConflict);assert.equal(store.get(KEY),replacement===null?undefined:second);assert.equal(a.app.snapshot().state.world.objects[0].label,'长椅');}
});
test('last pre-write comparison preserves another page when storage changes after model result validation',async()=>{
  const b=setup();await b.offline();await b.say('/新建 长椅');const newer=b.store.get(KEY),store=new Map();let armed=false,reads=0;
  const a=setup({store,beforeRead(key,map){if(armed&&key===KEY&&++reads===3)map.set(KEY,newer);}});await a.online();const before=a.app.snapshot().state;a.ids['free-input'].value='本页刚验证的回答';armed=true;assert.equal(await a.app.submit(),false);assert.equal(a.model.calls(),1);assert.equal(store.get(KEY),newer);assert(a.app.snapshot().saveConflict);assert.equal(a.app.snapshot().state,before);assert.equal(a.app.snapshot().state.events.filter(e=>e.type==='turn').length,0);assert.equal(a.ids['free-input'].value,'本页刚验证的回答');assert(!a.ids.transcript.textContent.includes('我听见了。'));
});
test('an unannounced conflict before confirming reset cannot reset either page or disconnect this one',async()=>{
  const store=new Map(),a=setup({store}),b=setup({store});await a.online();await a.ids['reset-button'].emit('click');await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);await a.ids['confirm-reset'].emit('click');assert.equal(store.get(KEY),raw);assert(a.app.snapshot().saveConflict);assert(a.model.connected());assert.equal(a.app.snapshot().state.events.length,0);
});
test('load latest reuses one validated snapshot even if storage changes during validation',async()=>{
  const seed=setup();await seed.offline();await seed.say('/新建 长椅');const raw=seed.store.get(KEY),store=new Map();let armed=false,restoreCalls=0;
  const r=setup({store,runtime:{...runtime,restore(value,pack){restoreCalls++;const result=runtime.restore(value,pack);if(armed)store.set(KEY,'late invalid bytes');return result;}}});
  store.set(KEY,raw);await r.event('storage',{key:KEY});armed=true;await r.ids['load-latest-save'].emit('click');assert.equal(restoreCalls,0);await r.ids['confirm-load-latest'].emit('click');assert.equal(restoreCalls,1);assert.equal(r.app.snapshot().state.world.objects.length,1);assert.equal(store.get(KEY),'late invalid bytes');await r.event('pageshow');assert(r.app.snapshot().saveConflict);
});
test('full historical progress remains viewable without truncation and cannot issue a model request',async()=>{
  const empty=runtime.serialize(runtime.create(packs.get('rain-lab'))),raw=JSON.stringify({...empty,events:Array.from({length:1000},(_,i)=>({id:'event_'+(i+1),type:'panel.viewed',panel:'memory',questionIds:[]}))}),store=new Map([[KEY,raw]]),r=setup({store});await r.online();const before=r.app.snapshot().state;r.ids['free-input'].value='不会发送的请求';assert.equal(await r.app.submit(),false);assert.equal(r.model.calls(),0);assert.equal(store.get(KEY),raw);assert.match(r.ids.toast.textContent,/上限/);await r.ids['tab-memory'].emit('click');assert.equal(r.app.snapshot().state,before);assert.equal(r.app.snapshot().state.events.length,1000);assert.equal(r.ids['free-input'].value,'不会发送的请求');
});

test('conflict keeps the current editable input and blocks navigation without a recovery UI entry',async()=>{
  const store=new Map(),a=setup({store}),b=setup({store});a.ids['free-input'].value='草稿甲';await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);await a.event('storage',{key:KEY});assert(a.app.snapshot().saveConflict);
  const before=a.app.snapshot().state;a.ids['free-input'].value='草稿乙';assert.equal(a.ids['free-input'].disabled,false);assert(a.ids['free-send'].disabled);assert(a.ids['pack-select'].disabled);await switchPack(a,'lantern-lab');assert.equal(a.app.snapshot().state,before);assert.equal(a.app.snapshot().storageKey,KEY);assert.equal(store.get(KEY),raw);assert.equal(a.ids['free-input'].value,'草稿乙');
  for(const id of ['recovery-button','recovery-dialog','recovery-data','recovery-download'])assert.equal(a.ids[id],undefined);
  assert.equal(Object.hasOwn(a.app.snapshot(),'recoveryCount'),false);
});

test('confirmation reads the current valid save when it changed after the dialog opened',async()=>{
  const store=new Map(),a=setup({store}),b=setup({store});await a.online();a.ids['free-input'].value='确认前继续编辑';await b.offline();await b.say('/新建 长椅');await a.event('storage',{key:KEY});const before=a.app.snapshot().state;await a.ids['load-latest-save'].emit('click');await b.say('/新建 灯');const newest=store.get(KEY);assert.equal(a.app.snapshot().state,before);
  await a.ids['confirm-load-latest'].emit('click');assert.equal(a.app.snapshot().state.world.objects.length,2);assert.equal(store.get(KEY),newest);assert.equal(a.ids['free-input'].value,'确认前继续编辑');assert(a.model.connected());assert(!a.app.snapshot().saveConflict);
});
test('a save corrupted after the dialog opened leaves accepted progress and input untouched',async()=>{
  const store=new Map(),a=setup({store});await a.online();await a.say('本页原有记录');const before=a.app.snapshot().state,b=setup({store});await b.offline();await b.say('/新建 长椅');await a.event('storage',{key:KEY});a.ids['free-input'].value='等确认之后再说';await a.ids['load-latest-save'].emit('click');store.set(KEY,'changed invalid bytes');await a.ids['confirm-load-latest'].emit('click');assert.equal(a.app.snapshot().state,before);assert.equal(store.get(KEY),'changed invalid bytes');assert.equal(a.ids['free-input'].value,'等确认之后再说');assert(a.app.snapshot().saveConflict);assert(a.model.connected());assert.match(a.ids.toast.textContent,/未通过校验/);
});
test('removed latest progress is adopted as empty only after confirmation while preserving the current input',async()=>{
  const a=setup();await a.online();await a.say('已经保存的一句');const before=a.app.snapshot().state;a.ids['free-input'].value='仍可编辑的草稿';a.store.delete(KEY);await a.event('storage',{key:KEY,newValue:null});await a.ids['load-latest-save'].emit('click');assert.equal(a.app.snapshot().state,before);assert(a.app.snapshot().saveConflict);await a.ids['confirm-load-latest'].emit('click');assert.equal(a.app.snapshot().state.events.length,0);assert(!a.app.snapshot().saveConflict);assert(!a.app.snapshot().unsaved);assert.equal(a.store.size,0);assert.equal(a.ids['free-input'].value,'仍可编辑的草稿');assert(a.model.connected());
});
test('unreadable storage at confirmation preserves the current page and permits a later successful load',async()=>{
  let readBlocked=false;const store=new Map(),a=setup({store,beforeRead(key){if(readBlocked&&key===KEY)throw Error('temporarily unavailable');}});await a.online();await a.say('本页原有记录');const before=a.app.snapshot().state,b=setup({store});await b.offline();await b.say('/新建 长椅');const raw=store.get(KEY);await a.event('storage',{key:KEY});a.ids['free-input'].value='存储恢复后再说';await a.ids['load-latest-save'].emit('click');readBlocked=true;await a.ids['confirm-load-latest'].emit('click');assert.equal(a.app.snapshot().state,before);assert.equal(store.get(KEY),raw);assert(a.app.snapshot().saveConflict);assert.equal(a.ids['free-input'].value,'存储恢复后再说');assert(a.model.connected());assert.match(a.ids.toast.textContent,/不允许读取/);
  readBlocked=false;await confirmLatest(a);assert.equal(a.app.snapshot().state.world.objects.length,1);assert(!a.app.snapshot().saveConflict);assert.equal(a.ids['free-input'].value,'存储恢复后再说');await switchPack(a,'lantern-lab');assert.notEqual(a.app.snapshot().storageKey,KEY);assert.equal(a.ids['free-input'].value,'存储恢复后再说');assert.equal(store.get(KEY),raw);
});

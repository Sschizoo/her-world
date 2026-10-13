const test=require('node:test'),assert=require('node:assert/strict');
const {setup,runtime,packs,plan,prepareRainQuestion}=require('./helpers/framework-ui-harness.cjs');
const syntheticLocks=require('./helpers/synthetic-locks.cjs');
const KEY='her-world.framework.v4:rain-lab:1.0.0';
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const locked=(locks,options={})=>setup({...options,navigator:{locks}});
const sendInput=(r,input)=>{r.ids['free-input'].value=input;return r.app.submit();};

test('simultaneous candidates stay private until one exclusive locked writer wins',async()=>{
 const locks=syntheticLocks(),store=new Map(),a=locked(locks,{store}),b=locked(locks,{store});await a.online();await b.online();locks.hold();const aa=sendInput(a,'合成页面甲'),bb=sendInput(b,'合成页面乙');await tick();assert.equal(a.app.snapshot().state.events.length,0);assert.equal(b.app.snapshot().state.events.length,0);assert.equal(store.size,0);assert.match(a.ids['save-status'].textContent,/保存中|等待保存/);assert.equal(locks.calls.length,2);assert.equal(locks.calls[0].name,locks.calls[1].name);assert.equal(locks.calls[0].options.mode,'exclusive');
 locks.release();const results=await Promise.all([aa,bb]);assert.equal(results.filter(Boolean).length,1);const winner=results[0]?a:b,loser=results[0]?b:a,saved=runtime.restore(store.get(KEY),packs.get('rain-lab'));assert(saved.ok);assert.equal(saved.state.events.length,1);assert.equal(loser.app.snapshot().state.events.length,0);assert(loser.app.snapshot().saveConflict);assert.equal(loser.ids['free-input'].value,results[0]?'合成页面乙':'合成页面甲');assert(!loser.app.snapshot().unsaved);assert.equal(loser.ids['recovery-button'],undefined);assert.equal(winner.app.snapshot().state.events.length,1);assert.equal(winner.ids['free-input'].value,'');assert.equal(saved.state.events[0].input,results[0]?'合成页面甲':'合成页面乙');
});
test('cancel, pack switch, pagehide and destroy make queued model candidates inert',async()=>{
 for(const action of ['cancel','switch','pagehide','pageshow','destroy']){
  const locks=syntheticLocks(),store=new Map(),r=locked(locks,{store});await r.online();const before=r.app.snapshot().state;locks.hold();const sending=sendInput(r,'需要保留的待保存回应');await tick();assert.equal(r.app.snapshot().state.events.length,0);
  if(action==='cancel')await r.ids['cancel-pending'].emit('click');else if(action==='switch'){r.ids['pack-select'].value='lantern-lab';await r.ids['pack-select'].emit('change');}else if(action==='pagehide'||action==='pageshow')await r.event(action);else r.app.destroy();locks.release();assert.equal(await sending,false);await tick();assert.equal(store.size,0);assert.equal(r.app.snapshot().state.events.length,0);assert.equal(r.ids['free-input'].value,'需要保留的待保存回应');assert(!r.app.snapshot().unsaved);assert(!r.app.snapshot().saving);if(action==='switch')assert.equal(r.app.snapshot().storageKey,'her-world.framework.v4:lantern-lab:1.0.0');else assert.equal(r.app.snapshot().state,before);
 }
});
test('present but rejecting LockManager never falls back to an unlocked write',async()=>{
 const locks={request(){return Promise.reject(Error('lock denied'));}},r=locked(locks);await r.online();const before=r.app.snapshot().state;assert.equal(await sendInput(r,'不能偷偷绕过锁'),false);assert.equal(r.store.size,0);assert.equal(r.app.snapshot().state,before);assert.equal(r.app.snapshot().state.events.length,0);assert(!r.app.snapshot().unsaved);assert.equal(r.ids['free-input'].value,'不能偷偷绕过锁');assert.match(r.ids['save-status'].textContent,/未保存|仅本页/);assert(r.model.connected());
});
test('storage-unavailable play remains honest even when lock acquisition succeeds',async()=>{
 const locks=syntheticLocks(),r=locked(locks,{blocked:true});await r.offline();assert.equal(await r.app.submit('/新建 长椅'),true);assert.equal(r.app.snapshot().state.world.objects.length,1);assert.match(r.ids['save-status'].textContent,/仅本页/);assert.equal(r.store.size,0);
});
test('meaningful observations wait for the writer and cannot overwrite a turn from another page',async()=>{
 const seed=setup();await prepareRainQuestion(seed);const store=seed.store,locks=syntheticLocks(),a=locked(locks,{store}),b=locked(locks,{store});const before=a.app.snapshot().state;a.ids['free-input'].value='看完日志再继续';await b.offline();locks.hold();const sending=b.app.submit('/新建 长椅');await tick();await a.ids['tab-logs'].emit('click');await tick();assert.equal(a.app.snapshot().state.facts.records_seen,undefined);locks.release();assert.equal(await sending,true);await tick();assert(a.app.snapshot().saveConflict);const saved=runtime.restore(store.get(KEY),packs.get('rain-lab'));assert(saved.ok);assert.equal(saved.state.world.objects.length,1);assert.equal(saved.state.facts.records_seen,undefined);assert.equal(a.app.snapshot().state,before);assert.equal(a.ids['free-input'].value,'看完日志再继续');assert.equal(a.app.snapshot().state.facts.records_seen,undefined);
});
test('reset is queued under the same key and cannot erase a newer winning turn',async()=>{
 const store=new Map(),locks=syntheticLocks(),a=locked(locks,{store}),b=locked(locks,{store});await a.online();await b.offline();await a.ids['reset-button'].emit('click');locks.hold();const sending=b.app.submit('/新建 长椅');await tick();const reset=a.ids['confirm-reset'].emit('click');await tick();locks.release();await sending;await reset;await tick();assert(a.app.snapshot().saveConflict);assert(a.model.connected());assert.equal(runtime.restore(store.get(KEY),packs.get('rain-lab')).state.world.objects.length,1);
});
test('historical migration authorizes and verifies its backup inside the same writer before replacement',async()=>{
 const raw=JSON.stringify({schema:'her-world-save-v4',pack:{id:'rain-lab',version:'1.0.0',rulesVersion:'3',digest:'d63194b2'},importedSnapshot:null,events:[]}),store=new Map([[KEY,raw]]),writes=[],locks=syntheticLocks();locks.hold();const r=locked(locks,{store,writes});await r.offline();const sending=r.app.submit('/新建 长椅');await tick();assert.equal(writes.length,0);assert.equal(store.get(KEY),raw);locks.release();assert.equal(await sending,true);assert(writes[0].key.includes(':backup:'));assert.equal(writes[0].value,raw);assert.equal(writes.at(-1).key,KEY);assert.equal(runtime.restore(store.get(KEY),packs.get('rain-lab')).state.world.objects.length,1);
});

test('canceling a queued discovery does not silently request the same lock again',async()=>{
 const seed=setup();await prepareRainQuestion(seed);const locks=syntheticLocks(),r=locked(locks,{store:seed.store}),raw=r.store.get(KEY);locks.hold();await r.ids['tab-logs'].emit('click');await tick();await r.ids['tab-logs'].emit('click');assert(r.app.snapshot().saving);const count=locks.calls.length;await r.ids['cancel-pending'].emit('click');assert.equal(locks.calls.length,count);locks.release();await tick();assert.equal(r.store.get(KEY),raw);assert.equal(r.app.snapshot().state.facts.records_seen,undefined);assert(!r.app.snapshot().saving);
});
test('stale callback guards reject a grant even if a lock substitute ignores abort',async()=>{
 let grant;const locks={request(name,options,callback){return new Promise(done=>{grant=()=>done(callback({name,mode:options.mode}));});}},r=locked(locks);await r.online();const before=r.app.snapshot().state,sending=sendInput(r,'迟到的锁授予');await tick();await r.ids['cancel-pending'].emit('click');grant();assert.equal(await sending,false);assert.equal(r.store.size,0);assert.equal(r.app.snapshot().state,before);assert.equal(r.app.snapshot().state.events.length,0);assert.equal(r.ids['free-input'].value,'迟到的锁授予');
});
test('same-page queued visits keep their displayed question IDs after a successful turn',async()=>{
 const seed=setup();await prepareRainQuestion(seed);const locks=syntheticLocks(),r=locked(locks,{store:seed.store});await r.online();locks.hold();const sending=r.app.submit('继续说');await tick();await r.ids['tab-logs'].emit('click');await r.ids['tab-memory'].emit('click');locks.release();assert.equal(await sending,true);await tick();assert.equal(r.app.snapshot().state.facts.records_seen,true);assert.equal(r.app.snapshot().activePanel,'memory');assert.deepEqual(r.app.snapshot().state.events.at(-1).questionIds,['q_read']);assert.equal(runtime.restore(r.store.get(KEY),packs.get('rain-lab')).state.facts.records_seen,true);
});
test('lock-level failure after acquisition settles the UI without an unlocked retry',async()=>{
 const locks=syntheticLocks(),r=locked(locks,{writeFails:k=>k===KEY});await r.online();assert.equal(await sendInput(r,'保留但无法写入'),true);assert.equal(r.store.size,0);assert.equal(r.app.snapshot().state.events.length,1);assert.equal(r.app.snapshot().state.events[0].input,'保留但无法写入');assert(!r.app.snapshot().saving);assert.match(r.ids['save-status'].textContent,/仅本页/);assert(r.app.snapshot().unsaved);assert(r.ids['pack-select'].disabled);assert.equal(r.ids['free-input'].value,'');
});
test('a failed locked migration backup keeps exact old bytes protected and reports the backup failure',async()=>{
 const raw=JSON.stringify({schema:'her-world-save-v4',pack:{id:'rain-lab',version:'1.0.0',rulesVersion:'3',digest:'d63194b2'},importedSnapshot:null,events:[]}),store=new Map([[KEY,raw]]),locks=syntheticLocks(),r=locked(locks,{store,writeFails:k=>k.includes(':backup:')});await r.offline();assert.equal(await r.app.submit('/新建 长椅'),true);assert.equal(store.get(KEY),raw);assert.equal(r.app.snapshot().state.world.objects.length,1);assert.match(r.ids['save-status'].textContent,/备份失败/);
});

test('explicit legacy import shares the locked writer and preserves source bytes on conflict',async()=>{
 const old=require('../framework/legacy/v0.5.4/engine.js'),legacyRaw=JSON.stringify(old.start(old.create())),store=new Map([['her-world.prologue.v3',legacyRaw]]),locks=syntheticLocks(),a=locked(locks,{store}),b=locked(locks,{store});await a.online();const before=a.app.snapshot().state;a.ids['free-input'].value='导入前的草稿';await b.offline();await a.ids['legacy-import-button'].emit('click');locks.hold();const sending=b.app.submit('/新建 长椅');await tick();const importing=a.ids['confirm-legacy-import'].emit('click');await tick();locks.release();await sending;await importing;assert(a.app.snapshot().saveConflict);assert(a.model.connected());assert.equal(a.app.snapshot().state,before);assert.equal(a.app.snapshot().state.importedSnapshot,null);assert.equal(a.ids['free-input'].value,'导入前的草稿');assert.equal(store.get('her-world.prologue.v3'),legacyRaw);assert.equal(runtime.restore(store.get(KEY),packs.get('rain-lab')).state.world.objects.length,1);
});
test('load-latest invalidates a waiting candidate while retaining its draft and connection',async()=>{
 const locks=syntheticLocks(),store=new Map(),r=locked(locks,{store}),external=setup();await r.online();const before=r.app.snapshot().state;locks.hold();const sending=sendInput(r,'等待保存的原话');await tick();await external.offline();await external.say('/新建 长椅');const raw=external.store.get(KEY);store.set(KEY,raw);await r.event('storage',{key:KEY});await r.ids['load-latest-save'].emit('click');assert.equal(r.app.snapshot().state,before);assert(r.app.snapshot().saveConflict);await r.ids['confirm-load-latest'].emit('click');locks.release();assert.equal(await sending,false);assert.equal(store.get(KEY),raw);assert.equal(r.app.snapshot().state.world.objects.length,1);assert.equal(r.ids['free-input'].value,'等待保存的原话');assert(r.model.connected());assert(!r.app.snapshot().saveConflict);assert(!r.app.snapshot().unsaved);
});

test('denied lock access and synchronous request failures also refuse unlocked writes',async()=>{
 for(const navigator of [Object.defineProperty({},'locks',{get(){throw Error('denied');}}),{locks:{request(){throw Error('request denied');}}},{locks:{request:null}}]){
  const r=setup({navigator});await r.offline();const before=r.app.snapshot().state;assert.equal(await sendInput(r,'/新建 长椅'),false);assert.equal(r.store.size,0);assert.equal(r.app.snapshot().state,before);assert.equal(r.app.snapshot().state.world.objects.length,0);assert.equal(r.ids['free-input'].value,'/新建 长椅');assert(!r.app.snapshot().unsaved);assert(!r.app.snapshot().saving);
 }
});

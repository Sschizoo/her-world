'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,runtime:R,packs:P}=require('./helpers/framework-ui-harness.cjs');
const locks=require('./helpers/synthetic-locks.cjs');
const fixture=require('./fixtures/framework-v019-before-purpose-save.json');
const key='her-world.framework.v4:lantern-lab:1.0.0';
const raw=JSON.stringify(fixture.save,null,2)+'\n';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const options=(locked,extra={})=>({search:'?pack=lantern-lab',store:new Map([[key,raw]]),...(locked?{navigator:{locks:locks()}}:{}),...extra});
const backupEntries=r=>[...r.store].filter(([k])=>k.startsWith(key+':backup:rules4:d11120d9:'));

test('pinned old workshop migration preserves progress and backs up before adopting a proven existing object',async()=>{
 for(const locked of [false,true]){
  const writes=[],r=setup(options(locked,{writes}));
  assert.equal(r.store.get(key),raw);assert.deepEqual(r.app.snapshot().state.story.completed,[]);
  assert.equal(r.app.snapshot().state.world.objects.length,1);
  assert.equal(backupEntries(r).length,locked?0:1);
  await r.offline();await r.say('/回答 我想在这里读书');await r.timers.flush();await tick();
  const state=r.app.snapshot().state;
  for(const id of ['purpose','make','inspect'])assert(state.story.completed.includes(id),id);
  assert.equal(state.world.objects.length,1);assert.equal(state.world.objects[0].source.createdEventId,'event_1');
  const saved=JSON.parse(r.store.get(key));assert.equal(saved.pack.digest,'cae92e8e');
  assert.deepEqual(saved.events[0],fixture.save.events[0]);
  assert.equal(saved.events.flatMap(e=>e.plan?.beats.flatMap(b=>b.operations)||[]).filter(op=>op.type==='world.create').length,1);
  assert.equal(backupEntries(r).length,1);assert.equal(backupEntries(r)[0][1],raw);
  assert(writes.findIndex(w=>w.key.includes(':backup:'))<writes.findIndex(w=>w.key===key));
  const restored=R.restore(r.store.get(key),P.get('lantern-lab'));assert(restored.ok);assert.deepEqual(restored.state,state);
  r.app.destroy();
 }
});

test('loading and switching an old workshop does not itself complete the existing-object node',async()=>{
 for(const locked of [false,true]){
  const r=setup(options(locked));await r.offline();
  for(const id of ['rain-lab','lantern-lab','rain-lab','lantern-lab']){r.ids['pack-select'].value=id;await r.ids['pack-select'].emit('change');await tick();}
  assert.deepEqual(r.app.snapshot().state.story.completed,[]);assert.equal(r.app.snapshot().state.world.objects.length,1);
  assert.equal(r.store.get(key),raw);assert.match(r.ids['invitation-question'].textContent,/做什么/);r.app.destroy();
 }
});

test('failed, unverified or conflicting completion backup never overwrites the old archive',async()=>{
 const reference=setup(options(false));const backupKey=backupEntries(reference)[0][0];reference.app.destroy();
 for(const locked of [false,true])for(const fault of ['throw','drop','collision']){
  const store=new Map([[key,raw],...(fault==='collision'?[[backupKey,'existing backup must remain']]:[])]);
  const extra=fault==='throw'?{writeFails:k=>k.includes(':backup:')}:fault==='drop'?{dropWrites:k=>k.includes(':backup:')}:{};
  const r=setup(options(locked,{store,...extra}));await r.offline();await r.say('/回答 阅读');await r.timers.flush();await tick();
  assert.equal(r.store.get(key),raw);assert.match(r.ids['save-status'].textContent,/备份失败/);
  if(fault==='collision')assert.equal(r.store.get(backupKey),'existing backup must remain');r.app.destroy();
 }
});

test('completion backup accepts only the exact locally pinned migration tuple',async()=>{
 for(const patch of [{type:'memory-provenance-v4'},{type:'unknown'},{fromRulesVersion:'3'},{toRulesVersion:'3'},{fromPackDigest:'00000000'},{toPackDigest:'d11120d9'},{extra:'unapproved'}]){
  const runtime={...R,restore(value,pack){const result=R.restore(value,pack);return result.ok&&result.migration?{...result,migration:{...result.migration,...patch}}:result;}};
  const r=setup(options(false,{runtime}));await r.offline();await r.say('/回答 阅读');await r.timers.flush();
  assert.equal(r.store.get(key),raw);assert.equal(backupEntries(r).length,0);assert.match(r.ids['save-status'].textContent,/备份失败/);r.app.destroy();
 }
});

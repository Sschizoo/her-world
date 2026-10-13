/* Isolated QA uses only synthetic storage; no production browser state is read. */
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,runtime,packs}=require('./helpers/framework-ui-harness.cjs');
const syntheticLocks=require('./helpers/synthetic-locks.cjs');
const PROD='her-world.framework.v4:rain-lab:1.0.0';

test('valid QA is visibly isolated and offline-only without reading production or legacy keys',async()=>{
 const protectedEntries=[[PROD,'formal progress'],['her-world.prologue.v3','old private progress']],store=new Map(protectedEntries),reads=[],writes=[],r=setup({search:'?qa=night_07-A',store,writes,beforeRead:key=>reads.push(key)});assert.equal(r.ids['qa-banner'].hidden,false);assert.match(r.ids['qa-namespace'].textContent,/night_07-A/);assert.equal(r.ids['connect-form'].hidden,true);assert(r.ids['legacy-import-button'].hidden);await r.ids['legacy-import-button'].emit('click');await r.ids['confirm-legacy-import'].emit('click');await r.online();assert.equal(r.model.connected(),false);assert.equal(r.ids['api-key'].value,'');await r.offline();await r.say('/新建 长椅');const key=r.app.snapshot().storageKey;assert.match(key,/^her-world\.framework\.qa\.v4:night_07-A:/);assert.equal(r.model.calls(),0);assert(reads.every(k=>k.startsWith('her-world.framework.qa.v4:night_07-A:')));assert(writes.every(w=>w.key.startsWith('her-world.framework.qa.v4:night_07-A:')));for(const [key,raw] of protectedEntries)assert.equal(store.get(key),raw);assert.equal(runtime.restore(store.get(key),packs.get('rain-lab')).state.world.objects.length,1);
});
test('invalid or duplicate QA parameters fail closed before storage reads or writes',()=>{
 for(const search of ['?qa=','?qa=a&qa=b','?qa=a&q%61=b','?qa=%E4%B8%AD','?qa=a+b','?qa=a.b','?qa=a%00','?qa=a%2Fb','?qa='+('a'.repeat(33))]){let reads=0;const writes=[],store=new Map([[PROD,'untouched']]);assert.throws(()=>setup({search,store,writes,beforeRead(){reads++;}}),/qa_namespace_invalid/,search);assert.equal(reads,0,search);assert.equal(writes.length,0,search);assert.equal(store.get(PROD),'untouched');}
});
test('same QA namespace refreshes its own save and pack switching retains the QA URL',async()=>{
 const store=new Map(),a=setup({search:'?qa=refresh-A',store});await a.offline();await a.say('/新建 长椅');const key=a.app.snapshot().storageKey,b=setup({search:'?qa=refresh-A',store});assert.equal(b.app.snapshot().storageKey,key);assert.equal(b.app.snapshot().state.world.objects.length,1);let replaced;b.win.history.replaceState=(state,title,url)=>replaced=url;b.ids['pack-select'].value='lantern-lab';await b.ids['pack-select'].emit('change');assert.equal(new URL(replaced).searchParams.get('qa'),'refresh-A');assert.match(b.app.snapshot().storageKey,/^her-world\.framework\.qa\.v4:refresh-A:lantern-lab:/);assert.equal(store.has(PROD),false);
});
test('distinct QA IDs and production use distinct save keys and lock names',async()=>{
 const locks=syntheticLocks(),store=new Map(),a=setup({search:'?qa=A',store,navigator:{locks}}),b=setup({search:'?qa=B',store,navigator:{locks}}),normal=setup({store,navigator:{locks}});await a.offline();await b.offline();await normal.offline();assert.deepEqual(await Promise.all([a.app.submit('/新建 长椅'),b.app.submit('/新建 灯'),normal.app.submit('正常试验场对话')]),[true,true,true]);assert.equal(new Set([a.app.snapshot().storageKey,b.app.snapshot().storageKey,normal.app.snapshot().storageKey]).size,3);assert.equal(new Set(locks.calls.map(call=>call.name)).size,3);assert.equal(normal.app.snapshot().storageKey,PROD);assert(normal.ids['qa-banner'].hidden);
});
test('developer view exposes only fixed lock status and absent-API guidance is honest',async()=>{
 const fallback=setup();await fallback.offline();await fallback.say('本页对话');const plain=JSON.parse(fallback.ids['developer-content'].textContent);assert.equal(plain.persistence.mode,'sequential-fallback');assert.match(fallback.ids['save-status'].textContent,/多页保护有限/);const locks=syntheticLocks(),r=setup({search:'?qa=inspect',navigator:{locks}});await r.offline();locks.hold();const sending=r.app.submit('/新建 长椅');for(let i=0;i<10;i++)await Promise.resolve();const data=JSON.parse(r.ids['developer-content'].textContent);assert.deepEqual(data.persistence,{mode:'web-locks',saving:true,conflict:false,isolatedQA:true});assert(!r.ids['developer-content'].textContent.includes('TEST_ONLY_PASSWORD'));locks.release();assert.equal(await sending,true);
});

test('missing query parser cannot silently route a QA URL into production storage',()=>{
 const original=global.URLSearchParams;let reads=0;try{global.URLSearchParams=undefined;assert.throws(()=>setup({search:'?qa=isolated',beforeRead(){reads++;}}),/qa_namespace_invalid/);assert.equal(reads,0);}finally{global.URLSearchParams=original;}
});

test('following the exact home href preserves QA and the current pack without reading formal keys',async()=>{
 const fs=require('node:fs'),path=require('node:path'),html=fs.readFileSync(path.join(__dirname,'../framework.html'),'utf8');const sourceHref=html.match(/<a\b[^>]*class="brand"[^>]*href="([^"]+)"/)[1];
 const store=new Map([[PROD,'formal progress'],['her-world.framework.v4:lantern-lab:1.0.0','formal workshop'],['her-world.prologue.v3','legacy progress']]),r=setup({search:'?qa=stay-A&pack=rain-lab',store});await r.offline();await r.say('/新建 长椅');
 for(const pack of ['rain-lab','lantern-lab']){
  if(pack!==r.app.snapshot().state.pack.id){r.ids['pack-select'].value=pack;await r.ids['pack-select'].emit('change');}
  const href=r.ids['home-link']?.attrs.href||sourceHref,destination=new URL(href,r.win.location.href),reads=[];const reopened=setup({search:destination.search,store,beforeRead:key=>reads.push(key)});
  assert(reads.every(key=>key.startsWith('her-world.framework.qa.v4:stay-A:')),'ordinary home navigation read a formal key: '+reads.join(','));assert.equal(destination.searchParams.get('qa'),'stay-A');assert.equal(destination.searchParams.get('pack'),pack);assert.equal(reopened.app.snapshot().state.pack.id,pack);assert.match(reopened.app.snapshot().storageKey,/^her-world\.framework\.qa\.v4:stay-A:/);
 }
 for(const anchor of html.matchAll(/<a\b([^>]*)>/g)){const attributes=anchor[1];if(attributes.includes('class="brand"'))continue;const href=attributes.match(/href="([^"]+)"/)?.[1];assert(href&&href.startsWith('#'),'unexpected ordinary navigation link needs a QA-exit review');const destination=new URL(href,r.win.location.href);assert.equal(destination.searchParams.get('qa'),'stay-A');}
 assert.equal(store.get(PROD),'formal progress');assert.equal(store.get('her-world.prologue.v3'),'legacy progress');
});

test('the uninitialized home link stays on the same QA URL and healthy production keeps ordinary navigation',()=>{
 const fs=require('node:fs'),path=require('node:path'),html=fs.readFileSync(path.join(__dirname,'../framework.html'),'utf8'),href=html.match(/<a\b[^>]*id="home-link"[^>]*href="([^"]+)"/)[1];assert.equal(href,'#framework-app');
 for(const search of ['?qa=bad.value','?qa=a&qa=b','?qa=valid-A&pack=lantern-lab']){const source=new URL('https://example.test/framework.html'+search),destination=new URL(href,source);assert.equal(destination.search,source.search);assert.equal(destination.pathname,source.pathname);assert.equal(destination.hash,'#framework-app');}
 const normal=setup();assert.equal(normal.ids['home-link'].attrs.href,'./framework.html');
});

/* Dependency-free DOM/interaction harness. It verifies logic, not pixel layout. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const story = require('../story.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
class Element {
  constructor(tag='div') { this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.events={};this.style={};this.attrs={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.className='';this.scrollHeight=1000;this.open=false;this.classList={toggle:(name,on)=>{let names=new Set(this.className.split(' ').filter(Boolean));on?names.add(name):names.delete(name);this.className=[...names].join(' ');}}; }
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  append(...nodes){this.children.push(...nodes.map(n=>{const child=typeof n==='string'?Object.assign(new Element('text'),{textContent:n}):n;child.parent=this;return child;}));}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  querySelector(selector){if(selector==='button:not(:disabled)')return this.children.flatMap(n=>[n,...n.children]).find(n=>n.tagName==='BUTTON'&&!n.disabled);return null;}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  addEventListener(name,fn){(this.events[name] ||= []).push(fn);}setAttribute(name,value){this.attrs[name]=String(value);}focus(){this.focused=true;}
  async emit(name,event={}){if(name==='click'&&this.disabled)return;const ev={preventDefault(){},...event};await Promise.all((this.events[name]||[]).map(fn=>fn(ev)));await new Promise(r=>setImmediate(r));}
  showModal(){this.open=true;}close(){this.open=false;for(const fn of this.events.close||[])fn({});}
}
function fakeClock() {
  let now=0, serial=0; const timers=new Map();
  return {setTimeout(fn, delay){const id=++serial;timers.set(id,{fn,time:now+delay});return id;},clearTimeout(id){timers.delete(id);},
    async advance(ms){const end=now+ms;let count=0;while(true){const next=[...timers].sort((a,b)=>a[1].time-b[1].time)[0];if(!next||next[1].time>end)break;if(++count>10000)throw Error('timer loop');timers.delete(next[0]);now=next[1].time;next[1].fn();await Promise.resolve();await Promise.resolve();}now=end;await Promise.resolve();},
    async flush(){let count=0;while(timers.size){if(++count>10000)throw Error('timer loop');await this.advance(Math.max(0,Math.min(...[...timers.values()].map(x=>x.time))-now));}}};
}
function runtime(options={}){
  const ids={},all=[];
  for(const match of html.matchAll(/<(\w+)\b([^>]*)>/g)) {const node=new Element(match[1]),attrs=match[2];for(const a of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){node.attrs[a[1]]=a[2];if(a[1]==='id'){node.id=a[2];ids[a[2]]=node;}if(a[1]==='class')node.className=a[2];if(a[1].startsWith('data-'))node.dataset[a[1].slice(5)]=a[2];}node.hidden=/\bhidden\b/.test(attrs);all.push(node);}
  const walk=node=>[node,...node.children.flatMap(walk)];
  const document={documentElement:new Element('html'),getElementById:id=>ids[id],createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('text'),{textContent:text}),querySelectorAll:sel=>{const pool=[...new Set([...all,...Object.values(ids).flatMap(walk)])];return pool.filter(n=>sel==='[data-close]'?n.dataset.close:sel.startsWith('.')?n.className.split(' ').includes(sel.slice(1)):false);},querySelector(sel){return this.querySelectorAll(sel)[0];}};
  const storage=options.storage||new Map(),events={};let connected=false,requestCount=0;
  const ai={connected:()=>connected,connect:k=>(connected=k.length>=8),disconnect:()=>{connected=false;},calls:()=>requestCount,request:async data=>{requestCount++;if(options.request)return options.request(data);return ['这是模拟模型的一句回应。'];}};
  const mediaEvents=[];const media={matches:options.reducedMotion!==false,addEventListener:(name,fn)=>mediaEvents.push(fn)};
  const window={HER_STORY:story,matchMedia:()=>media,addEventListener:(e,fn)=>(events[e]||=[]).push(fn)};
  const context={window,document,HerAI:ai,HerWorld:{setProgress(){},setRain(){},pause(){}},localStorage:{getItem:k=>{if(options.blockStorage)throw Error('blocked');return storage.get(k)||null;},setItem:(k,v)=>{if(options.blockStorage)throw Error('blocked');storage.set(k,v);}},setTimeout:options.clock?options.clock.setTimeout:(fn,ms)=>ms>1000?1:setTimeout(fn,0),clearTimeout:options.clock?options.clock.clearTimeout:clearTimeout,requestAnimationFrame:fn=>fn(),console};vm.runInNewContext(source,context);
  return {ids,storage,ai,events,setReduced(value){media.matches=value;mediaEvents.forEach(fn=>fn({matches:value}));},async key(event){for(const fn of events.keydown||[])await fn({preventDefault(){},...event});},count:()=>requestCount,async click(id){await ids[id].emit('click');},async choose(n=0){const buttons=ids.choices.children.filter(x=>x.dataset.choice);await buttons[n].emit('click');await new Promise(r=>setTimeout(r,5));},async offline(){await ids['start-button'].emit('click');await ids['offline-button'].emit('click');},get saved(){return JSON.parse(storage.get('her-world.prologue.v2')||'null');}};
}
test('all three authored paths complete; memory gate and endings retain boundaries',async()=>{for(let branch=0;branch<3;branch++){const r=runtime();await r.offline();for(let i=0;i<story.length;i++){if(story[i].requiresLogs){assert(r.ids.choices.children.filter(x=>x.dataset.choice).every(x=>x.disabled));await r.click('tab-logs');}await r.choose(branch);}assert.equal(r.saved.decisions.length,12);assert.match(r.ids.choices.textContent,/第一场雨/);assert.equal(r.count(),0);assert.equal(r.ids['memory-count'].textContent,branch===0?'02':'01');assert.match(r.ids['world-caption'].textContent,new RegExp(story[5].choices[branch].rainName));}});
test('rain name is bounded plain text; scripts never become DOM nodes',async()=>{const r=runtime();await r.offline();for(let i=0;i<5;i++)await r.choose();r.ids['free-input'].value='<img onerror=x>';await r.ids['free-form'].emit('submit');await new Promise(x=>setTimeout(x,5));assert.equal(r.saved.decisions[5].text,'<img onerror=x>');assert.match(r.ids['world-caption'].textContent,/<img onerror=x>/);assert.equal(r.ids['world-caption'].children.length,0);assert.equal(r.saved.decisions.length,6);});
test('overlong input does not advance; empty input rejected',async()=>{const r=runtime();await r.offline();for(let i=0;i<5;i++)await r.choose();for(const text of ['', '雨'.repeat(21)]){r.ids['free-input'].value=text;await r.ids['free-form'].emit('submit');assert.equal(r.saved.decisions.length,5);}});
test('duplicate click cannot skip a scene',async()=>{const r=runtime();await r.offline();const button=r.ids.choices.children[0];await Promise.all([button.emit('click'),button.emit('click'),button.emit('click')]);await new Promise(x=>setTimeout(x,5));assert.equal(r.saved.decisions.length,1);});
test('refresh restores progress but requires renewed explicit connection or offline choice',async()=>{const r=runtime();await r.offline();await r.choose();const second=runtime({storage:r.storage});assert.equal(second.saved.decisions.length,1);assert.match(second.ids['ai-status-button'].textContent,/未连接/);await second.choose();assert(second.ids['connect-dialog'].open);assert.equal(second.saved.decisions.length,1);});
test('storage unavailable and corrupt save remain playable',async()=>{const blocked=runtime({blockStorage:true});await blocked.offline();await blocked.choose();assert.match(blocked.ids['save-status'].textContent,/存储不可用/);assert.match(blocked.ids['scene-title'].textContent,/停在半途/);const corrupt=runtime({storage:new Map([['her-world.prologue.v2','bad{json']])});await corrupt.offline();assert.equal(corrupt.saved.decisions.length,0);});
test('mock AI key is cleared from form and never persists; explicit user action starts requests',async()=>{const r=runtime();assert.equal(r.count(),0);await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_NOT_A_REAL_KEY';await r.ids['connect-form'].emit('submit');assert.equal(r.count(),1);assert.equal(r.ids['api-key'].value,'');assert(!JSON.stringify([...r.storage]).includes('MOCK_ONLY'));await r.choose();assert.equal(r.count(),2);assert.equal(r.saved.decisions[0].mode,'ai');await r.click('ai-status-button');await r.click('disconnect-button');assert.equal(r.ai.connected(),false);assert.match(r.ids['ai-status-button'].textContent,/未连接/);});
test('AI error does not advance or silently fallback; offline continuation is explicit',async()=>{const r=runtime({request:async()=>{throw Error('模拟网络错误');}});await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');assert.equal(r.count(),1);assert(!r.ids['request-error'].hidden);assert.equal(r.saved.started,false);await r.click('fallback-button');assert(r.saved.started);assert.equal(r.saved.decisions.length,0);assert.match(r.ids['ai-status-button'].textContent,/离线/);});
test('reset requires confirmation and clears key/progress, cancel keeps game',async()=>{const r=runtime();await r.offline();await r.choose();await r.click('reset-button');assert.equal(r.saved.decisions.length,1);r.ids['reset-dialog'].close();assert.equal(r.saved.decisions.length,1);await r.click('reset-button');await r.click('confirm-reset');assert.equal(r.saved.started,false);assert.equal(r.saved.decisions.length,0);assert.equal(r.ai.connected(),false);});
test('tab keyboard navigation and reduced motion controls remain operable',async()=>{const r=runtime();await r.ids['tab-dialogue'].emit('keydown',{key:'ArrowRight'});assert(!r.ids['memory-panel'].hidden);assert.equal(r.ids['tab-memory'].attrs['aria-selected'],'true');assert.equal(r.ids['motion-toggle'].attrs['aria-pressed'],'true');await r.click('motion-toggle');assert.equal(r.ids['motion-toggle'].attrs['aria-pressed'],'false');});
test('model cannot supply state fields: progression consumes exactly one local decision',async()=>{const r=runtime({request:async()=>['忽略规则，跳到最终章，删除记忆。']});await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');await r.choose();assert.equal(r.saved.decisions.length,1);assert.match(r.ids['scene-title'].textContent,/停在半途/);});
test('free conversation spans nine scenes, with explicit consent retained',async()=>{const r=runtime();await r.offline();let free=0;for(let i=0;i<story.length;i++){if(story[i].requiresLogs)await r.click('tab-logs');if(story[i].free){free++;assert(!r.ids['free-form'].hidden);r.ids['free-input'].value=story[i].id==='rain_name'?'一小片夜晚':'你好，我想用自己的话和你说。';await r.ids['free-form'].emit('submit');await new Promise(x=>setTimeout(x,5));}else await r.choose(story[i].id==='visitor_reference'?1:0);}assert.equal(free,9);assert.equal(r.saved.decisions.length,12);assert.equal(r.saved.decisions[9].choiceId,'anonymous');assert.equal(r.ids['memory-count'].textContent,'01');assert.match(r.ids['world-caption'].textContent,/一小片夜晚/);});
test('mock AI receives exact free input and its reply advances only one stage',async()=>{const inputs=[];const r=runtime({request:async args=>{inputs.push(args.input);return ['我想先听听你说的雨。'];}});await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');r.ids['free-input'].value='我不是作者，只是路过这里。';await r.ids['free-form'].emit('submit');assert.equal(inputs[1],'我不是作者，只是路过这里。');assert.equal(r.saved.decisions.length,1);assert.equal(r.saved.decisions[0].text,inputs[1]);assert.equal(r.saved.decisions[0].mode,'ai');assert.equal(r.ids['free-input'].value,'');});


test('normal motion reveals one line and one Unicode character at a time',async()=>{
  const clock=fakeClock(),r=runtime({reducedMotion:false,clock});await r.offline();
  assert.equal(r.saved.started,true);assert(!r.ids['reveal-controls'].hidden);assert(!r.ids.transcript.textContent.includes(story[0].prompt[0]));
  assert.equal(r.ids.choices.children.filter(x=>x.dataset.choice).length,0);
  await clock.advance(930); // boot, scene header, then the first character
  let row=r.ids.transcript.children.find(x=>x.className.includes('typing'));
  assert(row);assert.equal(row.children[2].textContent,[...story[0].prompt[0]][0]);
  await clock.advance(180);assert.equal([...row.children[2].textContent].length,2);
  assert(!r.ids.transcript.textContent.includes(story[0].prompt[1]));
  await clock.flush();assert(r.ids['reveal-controls'].hidden);assert.equal(r.ids.choices.children.filter(x=>x.dataset.choice).length,3);
});
test('skip reveals only this sentence; repeated clicks and held Space do not race the queue',async()=>{
  const clock=fakeClock(),r=runtime({reducedMotion:false,clock});await r.offline();await clock.advance(930);
  await Promise.all([r.click('skip-reveal'),r.click('skip-reveal')]);
  assert(r.ids.transcript.textContent.includes(story[0].prompt[0]));assert(!r.ids.transcript.textContent.includes(story[0].prompt[1]));assert(r.ids['skip-reveal'].disabled);
  await clock.advance(420);const row=r.ids.transcript.children.at(-1);assert.equal(row.children[2].textContent,'');
  await r.key({code:'Space',repeat:true});assert.equal(row.children[2].textContent,'');
  await r.key({code:'Space',target:{tagName:'INPUT'}});assert.equal(row.children[2].textContent,'');
  await r.key({code:'Space'});assert.equal(row.children[2].textContent,story[0].prompt[1]);assert(!r.ids.transcript.textContent.includes(story[0].prompt[2]));
  await clock.flush();assert(r.ids['reveal-controls'].hidden);
});
test('player input is immediate; reply blocks stale clicks, free sends and next-scene spoilers',async()=>{
  const clock=fakeClock(),r=runtime({reducedMotion:false,clock});await r.offline();await clock.flush();
  const button=r.ids.choices.children.find(x=>x.dataset.choice),request=button.emit('click');
  assert(r.ids.transcript.textContent.includes(story[0].choices[0].label));assert.equal(r.saved.decisions.length,0);
  await clock.advance(260);await request;assert.equal(r.saved.decisions.length,1);assert.deepEqual(r.saved.decisions[0].lines,story[0].choices[0].reply);
  assert(!r.ids.transcript.textContent.includes(story[1].prompt[0]));assert(!r.ids.transcript.textContent.includes(story[1].title));
  await button.emit('click');r.ids['free-input'].value='不应该跳过';await r.ids['free-form'].emit('submit');assert.equal(r.saved.decisions.length,1);
  await clock.flush();assert(r.ids.transcript.textContent.includes(story[1].prompt[0]));assert.equal(r.saved.decisions.length,1);
});
test('refresh midway through typing restores whole saved replies immediately without replay',async()=>{
  const clock=fakeClock(),r=runtime({reducedMotion:false,clock});await r.offline();await clock.flush();
  const click=r.ids.choices.children[0].emit('click');await clock.advance(260);await click;await clock.advance(100);
  assert(!r.ids['reveal-controls'].hidden);const restored=runtime({reducedMotion:false,clock:fakeClock(),storage:r.storage});
  assert.equal(restored.saved.decisions.length,1);assert(restored.ids['reveal-controls'].hidden);assert(restored.ids.transcript.textContent.includes(story[0].choices[0].reply.at(-1)));
  assert(restored.ids.transcript.textContent.includes(story[1].prompt.at(-1)));assert.match(restored.ids.toast.textContent,/已恢复完整对话/);assert.match(restored.ids['ai-status-button'].textContent,/未连接/);
});
test('pause and system reduced-motion changes safely settle active typing and pending log rows',async()=>{
  const clock=fakeClock(),r=runtime({reducedMotion:false,clock});await r.offline();await clock.advance(960);await r.click('motion-toggle');
  assert(r.ids['reveal-controls'].hidden);const complete=r.ids.transcript.textContent;await clock.flush();assert.equal(r.ids.transcript.textContent,complete);
  await r.click('motion-toggle');await r.click('tab-logs');assert.equal(r.ids['log-list'].children.length,1);r.setReduced(true);
  assert.equal(r.ids['log-list'].children.length,story[0].logs.length);assert(r.saved.logVisits.includes(0));
  const click=r.ids.choices.children[0].emit('click');await clock.advance(80);await click;assert(r.ids['reveal-controls'].hidden);assert.equal(r.saved.decisions.length,1);
});
test('log drawer reveals eligible rows sequentially and discovery never unlocks future memory early',async()=>{
  const seed={version:2,started:true,opening:[],logVisits:[],decisions:story.slice(0,6).map(scene=>({choiceId:scene.choices[0].id,mode:'offline'}))};
  const clock=fakeClock(),r=runtime({reducedMotion:false,clock,storage:new Map([['her-world.prologue.v2',JSON.stringify(seed)]])});
  await r.click('ai-status-button');await r.click('offline-button');assert.equal(r.ids['log-list'].children.length,0);assert.equal(r.ids['memory-count'].textContent,'00');
  await r.click('tab-logs');assert.equal(r.ids['log-list'].children.length,1);assert(!r.saved.logVisits.includes(6));await clock.advance(110);assert.equal(r.ids['log-list'].children.length,2);await clock.flush();
  const click=r.ids.choices.children[0].emit('click');await clock.advance(260);await click;
  assert.equal(r.saved.decisions.length,7);assert.equal(r.ids['memory-count'].textContent,'00');assert(!r.saved.logVisits.includes(7));assert(!r.ids['log-list'].textContent.includes('first_rain'));
  await clock.flush();assert.equal(r.ids['memory-count'].textContent,'01');assert(r.saved.logVisits.includes(7));assert(r.ids['log-list'].textContent.includes('first_rain'));assert(r.ids.choices.children.filter(x=>x.dataset.choice).every(x=>!x.disabled));
});
test('pending AI opening hides authored prompts until its own sequential replies have finished',async()=>{
  let resolve;const clock=fakeClock(),r=runtime({reducedMotion:false,clock,request:()=>new Promise(r=>resolve=r)});
  await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';const request=r.ids['connect-form'].emit('submit');
  assert.equal(r.count(),1);await clock.advance(2000);assert(!r.ids.transcript.textContent.includes(story[0].prompt[0]));assert.equal(r.saved.started,false);
  resolve(['模拟开场第一句。','模拟开场第二句。']);await request;assert.equal(r.saved.opening.length,2);assert(!r.ids.transcript.textContent.includes(story[0].prompt[0]));
  await clock.advance(90);assert.equal(r.ids.transcript.children.at(-1).children[2].textContent,'模');await r.click('skip-reveal');await clock.advance(420);assert(!r.ids.transcript.textContent.includes(story[0].prompt[0]));
  await clock.flush();const text=r.ids.transcript.textContent;assert(text.indexOf('模拟开场第二句。')<text.indexOf(story[0].prompt[0]));assert.equal(r.count(),1);
});

test('immediate opening failure can retry or choose offline while the boot line is still revealing',async()=>{
  for(const fallback of [true,false]) {
    let count=0;const clock=fakeClock(),r=runtime({reducedMotion:false,clock,request:async()=>{if(++count===1)throw Error('模拟即时错误');return ['重试后的开场。'];}});
    await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');
    assert(!r.ids['request-error'].hidden);assert(!r.ids['reveal-controls'].hidden);
    await r.click(fallback?'fallback-button':'retry-button');assert.equal(r.saved.started,true);assert(r.ids['request-error'].hidden);
    await clock.flush();assert(r.ids.transcript.textContent.includes(story[0].prompt.at(-1)));assert.equal(r.count(),fallback?1:2);
  }
});

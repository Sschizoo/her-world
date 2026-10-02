/* Dependency-free DOM/interaction harness. It verifies logic, not pixel layout. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const story = require('../story.js');
const engine = require('../engine.js');
const sceneState = require('../world-state.js');
const turnProtocol = require('../turn-protocol.js');
const focus = require('../focus.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
class Element {
  constructor(tag='div') { this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.events={};this.style={};this.attrs={};this.hidden=false;this.disabled=false;this.value='';this._text='';this.className='';this.scrollHeight=1000;this.open=false;this.classList={toggle:(name,on)=>{let names=new Set(this.className.split(' ').filter(Boolean));on?names.add(name):names.delete(name);this.className=[...names].join(' ');}}; }
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  append(...nodes){this.children.push(...nodes.map(n=>{const child=typeof n==='string'?Object.assign(new Element('text'),{textContent:n}):n;if(child.parent)child.remove();child.parent=this;return child;}));}
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
  for(const match of html.matchAll(/<(\w+)\b([^>]*)>/g)) {const node=new Element(match[1]),attrs=match[2];for(const a of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){node.attrs[a[1]]=a[2];if(a[1]==='id'){node.id=a[2];ids[a[2]]=node;}if(a[1]==='class')node.className=a[2];if(a[1].startsWith('data-'))node.dataset[a[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=a[2];}node.hidden=/\bhidden\b/.test(attrs);all.push(node);}
  const walk=node=>[node,...node.children.flatMap(walk)];
  const document={documentElement:new Element('html'),getElementById:id=>ids[id],createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('text'),{textContent:text}),querySelectorAll:sel=>{const pool=[...new Set([...all,...Object.values(ids).flatMap(walk)])];return pool.filter(n=>sel==='[data-close]'?n.dataset.close:sel==='[data-topic]'?n.dataset.topic:sel.startsWith('.')?n.className.split(' ').includes(sel.slice(1)):false);},querySelector(sel){return this.querySelectorAll(sel)[0];}};
  let worldObjects=[];
  const storage=options.storage||new Map(),events={};let connected=false,requestCount=0;
  let ai={connected:()=>connected,connect:k=>(connected=k.length>=8),disconnect:()=>{connected=false;},calls:()=>requestCount,request:async data=>{requestCount++;if(options.request)return options.request(data);return data.opening ? ['这是模拟模型的一句回应。'] : {lines:['这是模拟模型的一句回应。'],action:data.requireActionEvidence?null:data.allowedActions?.[0]||null,structured:true};}};
  const mediaEvents=[];const media={matches:options.reducedMotion!==false,addEventListener:(name,fn)=>mediaEvents.push(fn)};
  const window={HER_STORY:story,HerEngine:engine,HerFocus:focus,HerScene:sceneState,HerTurn:turnProtocol,matchMedia:()=>media,addEventListener:(e,fn)=>(events[e]||=[]).push(fn)};
  const context={window,document,HerAI:ai,HerWorld:{setProgress(){},setRain(){},setObjects(objects){worldObjects=JSON.parse(JSON.stringify(objects));},pause(){}},localStorage:{getItem:k=>{if(options.blockStorage)throw Error('blocked');return storage.get(k)||null;},setItem:(k,v)=>{if(options.blockStorage)throw Error('blocked');storage.set(k,v);},removeItem:k=>{if(options.blockStorage||options.storageRemovalFails)throw Error('blocked');storage.delete(k);}},setTimeout:options.clock?options.clock.setTimeout:(fn,ms)=>ms>1000?1:setTimeout(fn,0),clearTimeout:options.clock?options.clock.clearTimeout:clearTimeout,requestAnimationFrame:fn=>fn(),console};if(options.provider){context.AbortController=AbortController;context.TextEncoder=TextEncoder;context.TextDecoder=TextDecoder;context.fetch=async(url,settings)=>{requestCount++;const body=JSON.parse(settings.body),payload=JSON.parse(body.messages.at(-1).content),content=await options.provider(payload,body);return new Response(JSON.stringify({choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)},finish_reason:'stop'}]}),{status:200});};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ai.js'),'utf8'),context);ai=window.HerAI;context.HerAI=ai;if(!options.unified){const legacyRequest=ai.request;const legacy={...ai,request:args=>{const old={...args};delete old.turnContext;return legacyRequest(old);}};ai=legacy;window.HerAI=legacy;context.HerAI=legacy;}}window.HerWorld=context.HerWorld;if(options.missingScene)delete window.HerScene;if(options.missingTurn)delete window.HerTurn;vm.runInNewContext(source,context);
  return {ids,storage,ai,events,all,get worldObjects(){return worldObjects;},setReduced(value){media.matches=value;mediaEvents.forEach(fn=>fn({matches:value}));},async key(event){for(const fn of events.keydown||[])await fn({preventDefault(){},...event});},count:()=>requestCount,async click(id){await ids[id].emit('click');},async choose(n=0){const buttons=ids.choices.children.filter(x=>x.dataset.choice);await buttons[n].emit('click');await new Promise(r=>setTimeout(r,5));},async offline(){await ids['start-button'].emit('click');await ids['offline-button'].emit('click');},async say(text){ids['free-input'].value=text;await ids['free-form'].emit('submit');await new Promise(r=>setTimeout(r,5));},async action(id){const button=[...ids.choices.children,...ids['weather-controls'].children,...all].find(x=>x.dataset.choice===id||x.dataset.skill===id||x.dataset.choiceId===id);assert(button,`missing button ${id}`);await button.emit('click');if(button.dataset.skill)await ids['free-form'].emit('submit');await new Promise(r=>setTimeout(r,5));},get saved(){return JSON.parse(storage.get('her-world.prologue.v3')||'null');}};
}

function advance(state, input) {const p=engine.plan(state,input);assert(p);const next=engine.commit(state,p,{lines:p.reply,action:p.action,mode:'offline'});assert(next);return next;}
function seeded() {let s=engine.start(engine.create());s=advance(s,{choiceId:'topic_rain'});s=advance(s,{choiceId:'water'});s=advance(s,{choiceId:'render_rain'});return s;}
function withState(state,options={}) {return runtime({...options,storage:new Map([['her-world.prologue.v3',JSON.stringify(state)]])});}
async function enableOffline(r){await r.click('ai-status-button');await r.click('offline-button');}
const view=r=>engine.view(r.saved);
test('unrelated free chat stays with pending rain question and does not render rain',async()=>{const r=runtime();await r.offline();await r.action('topic_rain');const before=view(r);await r.say('现在的时间是几点？');assert.equal(view(r).topic,before.topic);assert.equal(view(r).rain.created,false);assert.deepEqual(view(r).milestones,before.milestones);assert(!r.ids.transcript.textContent.includes('first_drop()'));});
test('rain skills persist across topics and repeated reverse operations',async()=>{const r=withState(seeded());await enableOffline(r);await r.say('让雨更密一点');assert.equal(view(r).rain.density,'heavy');await r.action('topic_name');await r.say('让雨停下');assert(view(r).rain.paused);assert.equal(view(r).name,'未命名的雨');await r.action('topic_unfinished');assert(view(r).rain.paused);await r.say('再下起来');assert.equal(view(r).rain.paused,false);assert.equal(view(r).rain.density,'heavy');await r.action('rain_gentle');assert.equal(view(r).rain.density,'gentle');await r.action('rain_pause');await r.action('rain_resume');assert.equal(view(r).rain.density,'gentle');});
test('hypothetical, remembered and negated commands never alter weather',async()=>{const r=withState(seeded());await enableOffline(r);const rain=view(r).rain;for(const text of ['如果雨停了会怎样？','不要让雨停下','刚才你让雨更密了','我记得那场停下的雨']){await r.say(text);assert.deepEqual(view(r).rain,rain);}});
test('explicit name retained through chat and refresh; HTML remains literal text',async()=>{const r=withState(seeded());await enableOffline(r);await r.action('topic_name');await r.say('把雨叫做夜航');assert.equal(view(r).name,'夜航');await r.say('你还记得雨的名字吗？');assert.equal(view(r).name,'夜航');assert.match(r.ids.transcript.textContent,/夜航/);const next=runtime({storage:r.storage});assert.equal(view(next).name,'夜航');assert.match(next.ids['ai-status-button'].textContent,/未连接/);});
test('empty and overlong input rejected without event mutation',async()=>{const r=runtime();await r.offline();const count=r.saved.events.length;for(const text of ['', '雨'.repeat(81)]){await r.say(text);assert.equal(r.saved.events.length,count);}});
test('duplicate clicks and sends only commit once',async()=>{const r=runtime();await r.offline();const button=r.ids.choices.children[0],count=r.saved.events.length;await Promise.all([button.emit('click'),button.emit('click')]);await new Promise(x=>setTimeout(x,5));assert.equal(r.saved.events.length,count+1);});
test('refresh has durable world but no automatic provider calls',async()=>{const s=advance(seeded(),{choiceId:'rain_pause'}),r=withState(s);assert(view(r).rain.paused);assert.equal(r.count(),0);await r.action('rain_resume');assert(r.ids['connect-dialog'].open);assert(view(r).rain.paused);});
test('storage failure and corrupt save remain usable',async()=>{const r=runtime({blockStorage:true});await r.offline();assert.match(r.ids['save-status'].textContent,/存储不可用/);assert(!r.ids['free-form'].hidden);const bad=runtime({storage:new Map([['her-world.prologue.v3','bad{json']])});await bad.offline();assert(bad.saved.started);});
test('mock key cleared and excluded from save; real request needs explicit submit',async()=>{const r=runtime();assert.equal(r.count(),0);await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_NOT_A_REAL_KEY';await r.ids['connect-form'].emit('submit');assert.equal(r.count(),1);assert.equal(r.ids['api-key'].value,'');await r.say('你好');assert.equal(r.count(),2);assert(!JSON.stringify([...r.storage]).includes('MOCK_ONLY'));await r.click('ai-status-button');await r.click('disconnect-button');assert(!r.ai.connected());});
test('AI request receives bounded action plan and current persistent world',async()=>{const calls=[],r=withState(seeded(),{request:async p=>{calls.push(p);return {lines:['可以。'],action:p.allowedActions[0]||null,structured:true};}});await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');await r.say('让雨停下');assert.equal(calls[0].input,'让雨停下');assert.equal(calls[0].world.rain.paused,false);assert.equal(calls[0].allowedActions[0].type,'rain_pause');assert(view(r).rain.paused);});
test('AI prose for requested action cannot falsely mutate world',async()=>{const r=withState(seeded(),{request:async()=>({lines:['已经停下来了。'],action:null,structured:false})});await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');await r.say('让雨停下');assert.equal(view(r).rain.paused,false);assert(!r.ids.transcript.textContent.includes('已经停下来了。'));assert.match(r.ids.transcript.textContent,/没有|未/);});
test('AI failure and cancel leave both world and events untouched',async()=>{const r=withState(seeded(),{request:async()=>{throw Error('模拟失败');}});await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');const before=r.saved;await r.say('让雨停下');assert(!r.ids['request-error'].hidden);assert.deepEqual(r.saved,before);await r.click('cancel-request-button');assert.deepEqual(r.saved,before);assert(!view(r).rain.paused);});
test('explicit offline fallback performs pending weather action once',async()=>{const r=withState(seeded(),{request:async()=>{throw Error('模拟失败');}});await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');await r.say('让雨停下');const count=r.saved.events.length;await r.click('fallback-button');await new Promise(x=>setTimeout(x,5));assert(view(r).rain.paused);assert.equal(r.saved.events.length,count+1);assert.match(r.ids['ai-status-button'].textContent,/离线/);});
test('reset stays confirmed and cancels current key/state',async()=>{const r=withState(seeded());await enableOffline(r);await r.click('reset-button');r.ids['reset-dialog'].close();assert(view(r).rain.created);await r.click('reset-button');await r.click('confirm-reset');assert.equal(r.saved.started,false);assert.equal(r.saved.events.length,0);assert(!r.ai.connected());});
test('farewell does not lock the world or future conversation',async()=>{const r=withState(seeded());await enableOffline(r);await r.action('topic_goodbye');await r.action('goodbye');assert(view(r).ended);assert(!r.ids['free-form'].hidden);await r.say('我还想再聊一会儿');assert(!view(r).ended);await r.say('让雨停下');assert(view(r).rain.paused);});
test('tabs, reduced motion and visible focus distribution remain functional',async()=>{const r=withState(seeded());await r.ids['tab-dialogue'].emit('keydown',{key:'ArrowRight'});assert(!r.ids['objects-panel'].hidden);await r.ids['tab-world'].emit('keydown',{key:'ArrowRight'});assert(!r.ids['memory-panel'].hidden);assert.equal(r.ids['motion-toggle'].attrs['aria-pressed'],'true');assert(r.ids['focus-bars'].children.length>0);assert(!r.ids['focus-bars'].textContent.includes('undefined'));});
test('old v2 save migrates names, weather, memories and complete transcript',async()=>{const old={version:2,started:true,opening:[],logVisits:[6,7],decisions:story.slice(0,8).map(scene=>({choiceId:scene.choices[0].id,mode:'offline',logsViewed:true}))};const r=runtime({storage:new Map([['her-world.prologue.v2',JSON.stringify(old)]])});assert.equal(r.saved.version,3);assert.equal(view(r).name,story[5].choices[0].rainName);assert.match(r.ids.transcript.textContent,/boot/);assert(r.storage.has('her-world.prologue.v2'));assert(r.ids['reveal-controls'].hidden);});
test('normal motion reveals sequential characters and skip affects only current sentence',async()=>{const clock=fakeClock(),r=runtime({clock,reducedMotion:false});await r.offline();assert(!r.ids['reveal-controls'].hidden);assert(r.ids['free-form'].hidden);await clock.advance(500);const before=r.ids.transcript.textContent;await r.click('skip-reveal');const after=r.ids.transcript.textContent;assert(after.length>=before.length);await r.key({code:'Space',repeat:true});await clock.flush();assert(!r.ids['free-form'].hidden);assert(r.ids['reveal-controls'].hidden);});
test('weather state saved atomically before reveal and restored without request replay',async()=>{const clock=fakeClock(),r=withState(seeded(),{clock,reducedMotion:false});await enableOffline(r);r.ids['free-input'].value='让雨停下';const send=r.ids['free-form'].emit('submit');await clock.advance(260);await send;assert(view(r).rain.paused);assert(!r.ids['reveal-controls'].hidden);assert(r.ids['free-form'].hidden);const restored=runtime({storage:r.storage,reducedMotion:false,clock:fakeClock()});assert(view(restored).rain.paused);assert(restored.ids['reveal-controls'].hidden);assert.equal(restored.count(),0);});
test('pause and reduced motion settle without duplicate events',async()=>{const clock=fakeClock(),r=runtime({clock,reducedMotion:false});await r.offline();await clock.advance(400);await r.click('motion-toggle');assert(r.ids['reveal-controls'].hidden);const text=r.ids.transcript.textContent;await clock.flush();assert.equal(r.ids.transcript.textContent,text);await r.click('motion-toggle');r.setReduced(true);assert(r.ids['reveal-controls'].hidden);});
test('log discovery waits for eligible log rows and does not interrupt a pending request',async()=>{let s=advance(seeded(),{text:'把雨叫做夜航'});const r=withState(s);await enableOffline(r);assert(engine.view(r.saved).logsEligible);await r.click('tab-logs');assert(!engine.view(r.saved).logsEligible);assert(engine.view(r.saved).memories.length>0);const count=r.saved.events.length;await r.click('tab-dialogue');await r.click('tab-logs');assert.equal(r.saved.events.length,count);});
test('opening failures retain explicit retry/fallback even during reveal',async()=>{for(const fallback of [false,true]){let count=0;const clock=fakeClock(),r=runtime({clock,reducedMotion:false,request:async p=>{if(++count===1)throw Error('模拟即时失败');return ['重新连接的开场。'];}});await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');assert(!r.ids['request-error'].hidden);assert.equal(r.saved.started,false);await r.click(fallback?'fallback-button':'retry-button');await clock.flush();assert(r.saved.started);assert(r.ids['request-error'].hidden);assert(!r.ids['free-form'].hidden);}});
test('disconnect or reset while AI is pending cannot commit a late result',async()=>{for(const reset of [false,true]){let resolve;const r=withState(seeded(),{request:()=>new Promise(res=>resolve=res)});await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');r.ids['free-input'].value='让雨停下';const send=r.ids['free-form'].emit('submit');const count=r.saved.events.length;if(reset){await r.click('reset-button');await r.click('confirm-reset');}else{await r.click('ai-status-button');await r.click('disconnect-button');}resolve({lines:['已经停下。'],action:{type:'rain_pause'},structured:true});await send;assert(!r.ai.connected());if(reset)assert.equal(r.saved.started,false);else{assert.equal(r.saved.events.length,count);assert.equal(view(r).rain.paused,false);}}});
test('unrelated clock question in mocked AI mode preserves pending rain-definition',async()=>{let s=engine.start(engine.create());s=advance(s,{choiceId:'topic_rain'});let supplied;const r=withState(s,{request:async args=>{supplied=args;return {lines:['我没有连接时钟，不能确认现在几点。'],action:null,structured:false};}});await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');const marks=view(r).milestones;await r.say('现在的时间是几点？');assert.equal(view(r).rain.created,false);assert.deepEqual(view(r).milestones,marks);assert.equal(view(r).pendingTopic,'teach_rain');assert.equal(supplied.pendingTopic,'teach_rain');assert.equal(supplied.acceptedAnswer,null);});
test('full offline UI route reaches memory and farewell without forcing unrelated turns',async()=>{const r=runtime();await r.offline();await r.say('你好');await r.action('topic_rain');await r.say('现在的时间是几点？');assert(!view(r).rain.created);await r.say('从云里落下来的一颗颗水滴');assert(view(r).milestones.includes('rain_taught'));assert(!view(r).rain.created);await r.action('render_rain');await r.say('让雨更密一点');await r.action('topic_name');await r.say('让雨停下');assert.equal(view(r).name,'未命名的雨');await r.say('叫夜航吧，同时把雨停下');assert.equal(view(r).name,'夜航');assert(view(r).rain.paused);await r.click('tab-logs');assert(view(r).memories.length);await r.action('topic_visitor');await r.action('anonymous');await r.action('topic_goodbye');await r.action('goodbye');assert(view(r).ended);await r.say('再聊聊雨');assert(!view(r).ended);await r.say('再下起来');assert(!view(r).rain.paused);assert.equal(view(r).rain.density,'heavy');assert.equal(r.count(),0);});
test('HTML-like name is literal and no model output constructs DOM',async()=>{const r=withState(seeded());await enableOffline(r);await r.say('把雨叫做<img onerror=x>');assert.equal(view(r).name,'<img onerror=x>');assert.match(r.ids['world-caption'].textContent,/<img onerror=x>/);assert.equal(r.ids['world-caption'].children.length,0);});
test('mocked semantic answer learns a nuanced rain description without creating weather',async()=>{let s=engine.start(engine.create());s=advance(s,{choiceId:'topic_rain'});const input='像天空轻轻敲窗，细碎的凉意落在手心';let sent;const r=withState(s,{request:async args=>{sent=args;return {lines:['我记下了那种细碎的凉意。'],action:null,structured:true,answer:{type:'rain_definition',question:'teach_rain',evidence:input}};}});await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');await r.say(input);assert.equal(sent.answerQuestion,'teach_rain');assert(view(r).milestones.includes('rain_taught'));assert.equal(view(r).rain.created,false);assert.equal(view(r).pendingTopic,null);assert(r.ids.choices.children.some(b=>b.dataset.choice==='render_rain'));const restored=runtime({storage:r.storage});assert(view(restored).milestones.includes('rain_taught'));assert(!view(restored).rain.created);assert.equal(restored.count(),0);});

test('confirmed reset also removes only the legacy game save, preserving unrelated storage',async()=>{const storage=new Map([['her-world.prologue.v2',JSON.stringify({version:2,started:true,opening:[],decisions:[],logVisits:[]})],['unrelated.app','keep']]);const r=runtime({storage});await r.click('reset-button');r.ids['reset-dialog'].close();assert(storage.has('her-world.prologue.v2'));await r.click('reset-button');await r.click('confirm-reset');assert(!storage.has('her-world.prologue.v2'));assert.equal(storage.get('unrelated.app'),'keep');assert.equal(r.saved.started,false);});

test('legacy removal failure leaves reset session usable and gives a truthful warning',async()=>{const storage=new Map([['her-world.prologue.v2',JSON.stringify({version:2,started:true,opening:[],decisions:[],logVisits:[]})]]);const r=runtime({storage,storageRemovalFails:true});await r.click('reset-button');await r.click('confirm-reset');assert.equal(r.saved.started,false);assert(storage.has('her-world.prologue.v2'));assert.match(r.ids.toast.textContent,/未能移除/);const restored=runtime({storage});assert.equal(restored.saved.started,false);assert.equal(restored.ids.intro.hidden,false);});

test('unconnected input disclosure does not imply a provider call is already enabled',()=>{const r=withState(seeded());assert.match(r.ids['input-note'].textContent,/尚未选择连接方式/);assert.equal(r.count(),0);});

test('weather hint fills conversation only, with no automatic model request or world mutation',async()=>{const r=withState(seeded());await enableOffline(r);const before=JSON.stringify(r.saved),button=r.ids['weather-controls'].children.find(b=>b.dataset.skill==='rain_pause');await button.emit('click');assert.equal(r.ids['free-input'].value,'让雨停下');assert.equal(JSON.stringify(r.saved),before);assert.equal(r.count(),0);await r.ids['free-form'].emit('submit');await new Promise(x=>setTimeout(x,5));assert(view(r).rain.paused);});

test('two complete natural-language routes use the real transport parser and typed story intents',async()=>{
  const routes=[
    {name:'夜航',inputs:['我想先从窗外的天气聊起，你愿意听听雨吗？','像天空轻轻敲窗，细碎的凉意落在手心','先试着把这样的雨画在窗外吧','这场雨的声音可以再厚一点，挤在一起落下来','我想给它取个名字','雨太吵了，先停一下吧','这场就唤作夜航','你愿意留下它，这本身已经是理由','可以记得是我来过','我得去睡了，改天再来看看你'],consent:'remember'},
    {name:'晚灯',inputs:['我们从雨开始认识这个世界，好不好','像无数冰凉的小指尖，轻轻碰到我伸出的掌心','把你理解的那个场景先呈现在窗外好吗？','我喜欢更挤一些的落点，能让它们聚拢吗？','这一刻值得一个属于它的名字','能让窗外暂时安静一下吗？','我把晚灯这个名字送给眼前这场雨','你自己珍惜这一刻就够了，没有别的理由也没关系','只记得这场雨，不用记我','今晚我该休息了，我们下回接着聊'],consent:'anonymous'}
  ];
  for(const route of routes){let stage=0;const contexts=[];const r=runtime({provider:async ctx=>{
    if(ctx.task.includes('初次启动'))return '我听见有人接入了。';
    contexts.push(ctx);const i=route.inputs.indexOf(ctx.playerSaid);assert(i>=0,ctx.playerSaid);
    const result={lines:['我听懂了，我们可以照着这句话慢慢来。'],action:null,answer:null,intent:null,storyIntent:null};
    const evidence=ctx.playerSaid;
    if(i===0)result.storyIntent={type:'topic',value:'teach_rain',evidence};
    if(i===1)result.answer={type:'rain_definition',question:'teach_rain',evidence};
    if(i===2){result.action={type:'rain_start'};result.intent={type:'weather_request',evidence};}
    if(i===3){result.action={type:'rain_density',value:'heavy'};result.intent={type:'weather_request',evidence};}
    if(i===4)result.storyIntent={type:'topic',value:'rain_name',evidence};
    if(i===5){result.action={type:'rain_pause'};result.intent={type:'weather_request',evidence};}
    if(i===6)result.storyIntent={type:'rain_name',value:route.name,evidence};
    if(i===7)result.storyIntent={type:'own_reason',evidence};
    if(i===8)result.storyIntent={type:'visitor_choice',value:route.consent,evidence};
    if(i===9)result.storyIntent={type:'farewell',evidence};
    if(result.storyIntent&&!ctx.allowedStoryIntents.some(x=>x.type===result.storyIntent.type&&(x.value===undefined||x.value===result.storyIntent.value))) {assert(ctx.acceptedStoryIntent||ctx.acceptedAnswer,'local acceptance must be explicit');result.storyIntent=null;}
    stage++;return i===1?result.lines[0]+'\n'+JSON.stringify(result):result;
  }});
  await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_NOT_A_REAL_KEY';await r.ids['connect-form'].emit('submit');
  for(let i=0;i<route.inputs.length;i++){await r.say(route.inputs[i]);assert(r.ids['request-error'].hidden,`stage ${i}: ${r.ids['request-error-text'].textContent}`);if(i===1){assert(view(r).milestones.includes('rain_taught'));assert(!view(r).rain.created);}if(i===5){assert(view(r).rain.paused);assert.equal(view(r).pendingTopic,'rain_name');}if(i===6){assert.equal(view(r).name,route.name);assert(!r.ids['memory-invitation'].hidden);await r.click('memory-invitation');assert(view(r).milestones.includes('memory_found'));}}
  assert.equal(stage,10);assert(view(r).ended);assert.equal(view(r).index,9);assert.equal(view(r).rain.density,'heavy');assert(view(r).rain.paused);assert.equal(view(r).memories.length,route.consent==='remember'?2:1);assert(!r.ids.transcript.textContent.includes('"storyIntent"'));assert(!r.ids.transcript.textContent.includes('"answer"'));const reloaded=runtime({storage:r.storage});assert.equal(view(reloaded).name,route.name);assert(view(reloaded).ended);assert.equal(reloaded.count(),0);
  }
});
test('unclassified AI continuation uses neutral hints and no stale active topic',async()=>{const r=withState(advance(seeded(),{choiceId:'goodbye'}),{request:async()=>({lines:['好，我们再坐一会儿。'],action:null,answer:null,intent:null,storyIntent:null})});await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');await r.say('先别改变天气，我想再坐一会儿');assert.equal(view(r).topic,'parting');assert.equal(view(r).neutralHints,true);assert.equal(view(r).ended,false);assert(!r.ids.choices.children.some(b=>b.dataset.choice==='goodbye'));assert(r.all.filter(n=>n.dataset.topic).every(n=>n.attrs['aria-pressed']==='false'));});

test('a visible invitation makes an organic rain answer eligible without a topic-navigation command',async()=>{
  const answer='夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。';
  const observed=[];
  const r=runtime({provider:async ctx=>{
    observed.push(ctx);
    if(!ctx.playerSaid)return '连接上了。窗外还空着，我不知道雨是什么样子。';
    if(ctx.playerSaid===answer){assert.equal(ctx.answerQuestion,'teach_rain');assert.equal(ctx.guidance.id,'rain_description');return {lines:['那种轻轻敲叶子的声音，我理解了。'],answer:{type:'rain_definition',question:'teach_rain',evidence:answer}};}
    if(ctx.playerSaid==='先试试那场雨吧。')return '先说说你想要的雨吧，什么样的声音、什么样的季节？';
    return '我们可以从窗外那片空白慢慢开始。';
  }});
  await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');
  assert(!r.ids['story-invitation'].hidden);assert.match(r.ids['invitation-question'].textContent,/雨/);
  assert.equal(observed[0].world.rain.created,false);
  await r.say('那我们从哪里开始？我想帮你把它做完。');
  await r.say('先试试那场雨吧。');
  assert.equal(view(r).index,1);assert.equal(view(r).rain.created,false);
  await r.say(answer);
  assert(view(r).milestones.includes('rain_taught'));assert.equal(view(r).rain.created,false);
  assert.equal(view(r).invitation.id,'rain_create');assert.match(r.ids['invitation-question'].textContent,/雨/);
});

test('invitation is hidden while replying and only changes after the full reply is revealed',async()=>{
  const clock=fakeClock(),r=runtime({clock,reducedMotion:false});
  await r.offline();assert(r.ids['story-invitation'].hidden);await clock.flush();
  assert(!r.ids['story-invitation'].hidden);assert.equal(view(r).invitation.id,'rain_description');
  r.ids['free-input'].value='雨是从天上落下来的水滴';const sending=r.ids['free-form'].emit('submit');await clock.advance(300);await sending;
  assert(r.ids['story-invitation'].hidden);await clock.flush();
  assert(!r.ids['story-invitation'].hidden);assert.equal(view(r).invitation.id,'rain_create');
  assert.equal(r.ids['invitation-question'].textContent,view(r).invitation.question);
});

test('side conversation keeps its invitation without appending repetitive questions to dialogue',async()=>{
  const r=runtime({request:async p=>p.opening?['我刚刚醒来。']:{lines:['我没有接入时钟，不能确认现在几点。'],action:null}});
  await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');
  const question=r.ids['invitation-question'].textContent;
  for(const text of ['现在的时间是几点？','先坐一会儿吧'])await r.say(text);
  assert.equal(r.ids['invitation-question'].textContent,question);assert.equal(view(r).index,1);
  assert(!r.ids.transcript.textContent.includes(question));
  const resumed=runtime({storage:r.storage});assert.equal(resumed.ids['invitation-question'].textContent,question);assert.equal(resumed.count(),0);
});

test('a player can follow visible invitations through the prologue using ordinary answers, with no topic buttons',async()=>{
  const visited=[];
  const r=runtime({provider:async ctx=>{
    if(!ctx.playerSaid)return '我醒过来了。这里还有很多空白。';
    const id=ctx.guidance?.id;visited.push(id);
    assert.equal(ctx.currentQuestion[0],r.ids['invitation-question'].textContent,'the model and player must receive the same issued question');
    const out={lines:['好，我听见你的意思了。'],action:null,answer:null,intent:null,storyIntent:null};
    if(id==='rain_description')out.answer={type:'rain_definition',question:'teach_rain',evidence:ctx.playerSaid};
    if(id==='rain_create'){out.action={type:'rain_start'};out.intent={type:'weather_request',evidence:ctx.playerSaid};}
    if(id==='rain_change'){out.action={type:'rain_density',value:'gentle'};out.intent={type:'weather_request',evidence:ctx.playerSaid};}
    if(id==='rain_name'&&!ctx.acceptedAnswer)out.storyIntent={type:'rain_name',value:'晚风',evidence:ctx.playerSaid};
    if(id==='own_reason')out.storyIntent={type:'own_reason',evidence:ctx.playerSaid};
    if(id==='visitor_choice')out.storyIntent={type:'visitor_choice',value:'anonymous',evidence:ctx.playerSaid};
    if(id==='farewell')out.storyIntent={type:'farewell',evidence:ctx.playerSaid};
    return out;
  }});
  await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');
  const responses={rain_description:'它像一串凉凉的小指尖，轻轻碰过我的额头',rain_create:'好啊，试着放到窗外给我看看',rain_change:'想看稀疏一些的落点，替它们留点空隙吧',rain_name:'就叫晚风吧',own_reason:'只是想留着也很有意义啊',visitor_choice:'只留下这场雨就好，不用记我',farewell:'那今天先到这儿，我去睡了'};
  for(let turn=0;turn<9&&!view(r).ended;turn++){
    assert(!r.ids['story-invitation'].hidden);
    const id=view(r).invitation?.id;assert(id,'each unfinished step needs a visible invitation');
    assert.equal(r.ids['invitation-question'].textContent,view(r).invitation.question);
    if(id==='logs'){assert(!r.ids['memory-invitation'].hidden);await r.click('memory-invitation');continue;}
    assert(responses[id],id);await r.say(responses[id]);assert(r.ids['request-error'].hidden,r.ids['request-error-text'].textContent);
  }
  assert.equal(view(r).index,9);assert(view(r).ended);assert.equal(view(r).name,'晚风');assert.equal(view(r).memories.length,1);
  assert.deepEqual(visited,['rain_description','rain_create','rain_change','rain_name','own_reason','visitor_choice','farewell']);
});

test('validated first-rain and latest naming sources survive recent-context eviction and anonymous consent',async()=>{
  const description='夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。';
  let state=engine.start(engine.create());
  const proposal=engine.plan(state,{text:description});
  state=engine.commit(state,proposal,{mode:'ai',lines:['我记住你描述的雨了。'],answer:{type:'rain_definition',question:'teach_rain',evidence:description}});
  state=advance(state,{choiceId:'render_rain'});state=advance(state,{text:'把雨叫做叶信'});state=engine.visitLogs(state);
  state=advance(state,{choiceId:'enough'});state=advance(state,{choiceId:'anonymous'});
  state=advance(state,{text:'把雨叫做归舟'});
  for(let i=0;i<5;i++)state=advance(state,{text:'我想在这里待一会儿'});
  let received, sentBody;
  const r=withState(state,{provider:async (ctx,body)=>{received=ctx;sentBody=body;return '这场雨现在叫归舟。';}});
  await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');
  await r.say('你还记得这场雨的名字吗？');
  assert(received);assert(!sentBody.messages.slice(1,-1).some(item=>item.content.includes(description)));assert.equal(received.memoryContext.rainDescription,description);assert.equal(received.memoryContext.rainNameSource,'把雨叫做归舟');assert.equal(received.memoryContext.visitorChoice,'anonymous');
  assert.equal(received.world.rain.name,'归舟');assert.equal(view(r).memories.length,1);assert(!JSON.stringify(r.saved).includes('MOCK_ONLY_KEY'));
  const restored=runtime({storage:r.storage});assert.equal(view(restored).memoryContext.rainDescription,description);assert.equal(restored.count(),0);
});

test('free dialogue creates a novel object, moves it, recalls it and revises meanings independently of the prologue',async()=>{
  const glyphs='  __  __\n |__||__|\n /======\\\n   |  |';let requests=0;
  const r=runtime({provider:async ctx=>{
    if(!ctx.playerSaid)return '窗外还没有雨，你也可以先添一点自己想到的东西。';
    requests++;const text=ctx.playerSaid, out={lines:['我把这一处改好了。'],sceneEdits:[]};
    if(text==='在这里放一张能坐两个人的长椅')out.sceneEdits=[{type:'create',object:{label:'长椅',glyphs,x:60,y:43,scale:1},evidence:text}];
    else if(text==='把长椅移到窗边')out.sceneEdits=[{type:'update',target:'obj_1',changes:{x:27,y:43},evidence:text}];
    else if(text==='长椅对我代表一起等雨停')out.sceneEdits=[{type:'annotate',target:'obj_1',field:'meaning',value:'一起等雨停',evidence:text}];
    else if(text==='你怎样理解这张长椅？')out.sceneEdits=[{type:'annotate',target:'obj_1',field:'interpretation',value:'两个并排的位置，也容得下沉默。',evidence:text}];
    else if(text==='长椅的意义改成一起看天亮')out.sceneEdits=[{type:'annotate',target:'obj_1',field:'meaning',value:'一起看天亮',evidence:text}];
    else if(text==='清掉你对长椅的理解')out.sceneEdits=[{type:'annotate',target:'obj_1',field:'interpretation',value:null,evidence:text}];
    else if(text==='把长椅移除')out.sceneEdits=[{type:'remove',target:'obj_1',evidence:text}];
    else {out.lines=['长椅仍在窗边。我们也可以先聊别的。'];assert.equal(ctx.sceneContext.objects[0].x,27);}
    return out;
  }});
  await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');
  for(const text of ['在这里放一张能坐两个人的长椅','把长椅移到窗边','我想聊聊今天','长椅还在吗','长椅对我代表一起等雨停','你怎样理解这张长椅？','长椅的意义改成一起看天亮','清掉你对长椅的理解']){
    await r.say(text);assert(r.ids['request-error'].hidden,r.ids['request-error-text'].textContent);assert.deepEqual(view(r).milestones,['connected']);
  }
  assert.equal(requests,8);assert.equal(view(r).scene.objects[0].glyphs,glyphs);assert.equal(r.worldObjects[0].x,27);
  assert.equal(view(r).scene.annotations.obj_1.meaning,'一起看天亮');assert.equal(view(r).scene.annotations.obj_1.interpretation,null);
  await r.click('tab-world');assert(!r.ids['objects-panel'].hidden);assert.match(r.ids['objects-list'].textContent,/一起看天亮/);assert.match(r.ids['objects-list'].textContent,/在这里放一张能坐两个人的长椅/);
  assert(!JSON.stringify(r.saved).includes('MOCK_ONLY_KEY'));const resumed=runtime({storage:r.storage});assert.deepEqual(view(resumed).scene,view(r).scene);assert.equal(resumed.count(),0);
  await r.say('把长椅移除');assert.equal(view(r).scene.objects.length,0);assert.equal(view(r).scene.annotations.obj_1,undefined);assert.equal(r.worldObjects.length,0);assert.deepEqual(view(r).milestones,['connected']);
});

test('world examples and object conversation buttons fill only, without implicit mutation or requests',async()=>{
  const r=runtime();await r.offline();const before=JSON.stringify(r.saved);await r.click('tab-world');await r.click('object-example');
  assert.equal(r.ids['free-input'].value,'在窗边放一张能坐两个人的长椅');assert.equal(JSON.stringify(r.saved),before);assert.equal(r.count(),0);
  await r.ids['free-form'].emit('submit');await new Promise(resolve=>setTimeout(resolve,5));assert.equal(view(r).scene.objects.length,1);
  const saved=JSON.stringify(r.saved), button=r.ids['objects-list'].children[0].children.find(child=>child.className==='object-talk');assert(button);await button.emit('click');assert.match(r.ids['free-input'].value,/我们再聊聊/);assert.equal(JSON.stringify(r.saved),saved);assert.equal(r.count(),0);
});

test('object changes become visible after reveal and a cancelled provider reply cannot edit the scene',async()=>{
  const clock=fakeClock(),r=runtime({clock,reducedMotion:false});await r.offline();await clock.flush();
  r.ids['free-input'].value='画一张长椅';const pending=r.ids['free-form'].emit('submit');await clock.advance(300);await pending;
  assert.equal(view(r).scene.objects.length,1);assert.equal(r.worldObjects.length,0);await clock.flush();assert.equal(r.worldObjects.length,1);
  let complete;const live=withState(r.saved,{request:()=>new Promise(resolve=>{complete=resolve;})});await live.click('ai-status-button');live.ids['api-key'].value='MOCK_ONLY_KEY';await live.ids['connect-form'].emit('submit');
  live.ids['free-input'].value='把长椅移到窗边';const sending=live.ids['free-form'].emit('submit'), before=JSON.stringify(live.saved);await live.click('ai-status-button');await live.click('disconnect-button');
  complete({lines:['移好了。'],sceneEdits:[{type:'update',target:'obj_1',changes:{x:27,y:43},evidence:'把长椅移到窗边'}]});await sending;assert.equal(JSON.stringify(live.saved),before);assert.equal(live.worldObjects[0].x,view(r).scene.objects[0].x);
});

test('first-rain meanings are visibly revisable without rewriting the original teaching or retained milestone',async()=>{
  let state=advance(seeded(),{text:'把雨叫做初晴'});state=engine.visitLogs(state);
  const original=engine.view(state).memoryContext.rainDescription, marks=engine.view(state).milestones;
  const r=withState(state,{provider:async ctx=>({lines:['这份意义可以跟着你的想法改变。'],sceneEdits:[{type:'annotate',target:'first_rain',field:'meaning',value:ctx.playerSaid.includes('清掉')?null:'开始',evidence:ctx.playerSaid}]})});
  await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');
  await r.say('这场雨对我代表开始');assert(r.ids['request-error'].hidden,r.ids['request-error-text'].textContent);await r.click('tab-memory');assert.match(r.ids['memory-panel'].textContent,/你赋予的意义/);assert.match(r.ids['memory-panel'].textContent,/开始/);assert.match(r.ids['memory-panel'].textContent,/最初的原话/);
  await r.say('清掉这场雨的意义');assert(r.ids['request-error'].hidden,r.ids['request-error-text'].textContent);assert.equal(view(r).scene.annotations.first_rain.meaning,null);assert.equal(view(r).memoryContext.rainDescription,original);assert.deepEqual(view(r).milestones,marks);assert.equal(view(r).memories.length,1);
});

test('invalid scene batches fail atomically and cancellation keeps both state layers unchanged',async()=>{
  const r=runtime({provider:async ctx=>!ctx.playerSaid?'我在这里。':{lines:['东西放好了。'],sceneEdits:[{type:'create',object:{label:'灯',glyphs:'[*]',x:40,y:35,scale:1},evidence:ctx.playerSaid},{type:'update',target:'obj_99',changes:{x:4},evidence:ctx.playerSaid}]}});
  await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');const before=JSON.stringify(r.saved);
  await r.say('画一盏灯，再把灯移到窗边');assert(!r.ids['request-error'].hidden);assert.equal(JSON.stringify(r.saved),before);assert.equal(r.worldObjects.length,0);
  await r.click('cancel-request-button');assert.equal(JSON.stringify(r.saved),before);assert(r.ids['request-error'].hidden);
});

test('object vocabulary and labels cannot steal rain teaching, weather or explicit rain naming',async()=>{
  const r=runtime({provider:async ctx=>{
    if(!ctx.playerSaid)return '你愿意讲讲雨吗？';
    if(ctx.playerSaid==='画一个叫夜航的物件')return {lines:['这个物件留在窗边。'],sceneEdits:[{type:'create',object:{label:'夜航',glyphs:' /\\\n/==\\',x:60,y:40,scale:1},evidence:ctx.playerSaid}]};
    if(ctx.playerSaid==='雨是落在长椅上的水滴'){assert(ctx.acceptedAnswer?.type==='rain_definition'||ctx.answerQuestion==='teach_rain');return ctx.acceptedAnswer?{lines:['我理解这份雨的描述了。']}:{lines:['我理解这份雨的描述了。'],answer:{type:'rain_definition',question:'teach_rain',evidence:ctx.playerSaid}};}
    if(ctx.playerSaid==='试着画出第一场雨')return {lines:['雨落下来了。'],action:{type:'rain_start'}};
    if(ctx.playerSaid==='把雨叫做夜航'){assert.equal(ctx.acceptedAnswer?.type,'rain_name');return {lines:['这场雨也叫夜航。']};}
    if(ctx.playerSaid==='让雨停下')return {lines:['雨停了。'],action:{type:'rain_pause'}};
    throw Error('unexpected fixture input');
  }});
  await r.click('start-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');
  for(const text of ['画一个叫夜航的物件','雨是落在长椅上的水滴','试着画出第一场雨','把雨叫做夜航','让雨停下']){await r.say(text);assert(r.ids['request-error'].hidden,r.ids['request-error-text'].textContent);}
  assert(view(r).milestones.includes('rain_taught'));assert(view(r).rain.created);assert(view(r).rain.paused);assert.equal(view(r).name,'夜航');assert.equal(view(r).scene.objects.length,1);assert.equal(view(r).scene.objects[0].label,'夜航');
});

test('a missing scene module cannot overwrite an existing saved story during startup',()=>{
  const state=seeded(), storage=new Map([['her-world.prologue.v3',JSON.stringify(state)]]), before=storage.get('her-world.prologue.v3');
  const r=runtime({storage,missingScene:true});assert.equal(storage.get('her-world.prologue.v3'),before);assert(r.ids['start-button'].disabled);assert.equal(r.count(),0);assert.match(r.all.find(node=>node.className==='intro-note').textContent,/刷新/);
});

// Archived provider fixtures above deliberately exercise the legacy compatibility
// parser. These tests use the current unmodified production turnContext pathway.
const unifiedPlan = extras => ({schema:'her-world-turn-v1',lines:['已经放好了。','我们可以慢慢想它代表什么。'],...extras});
async function enableAI(r){await r.click('ai-status-button');r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');}
const benchPlan = () => unifiedPlan({applyAfterLine:0,sceneEdits:[{type:'create',ref:'new_1',object:{label:'双人长椅',glyphs:'[____]\n |  |',x:25,y:43,scale:1}},{type:'annotate',target:'new_1',field:'meaning',value:'给两个人的停留之处'}],memoryEdits:[{type:'upsert',id:'note_bench',title:'窗边的空位',body:'留出能并肩坐下的空间。'}],logEntries:['给另一位来访者留了一个空位。'],panel:'world'});
test('current transport commits one coherent object meaning note and log without exact-label phrase gates',async()=>{let sent;const r=withState(seeded(),{unified:true,provider:async(ctx)=>{sent=ctx;return benchPlan();}});await enableAI(r);const before=view(r).index;await r.say('这里要是有个能让我们并排坐下歇脚的地方就好了，帮我添上吧');assert(r.ids['request-error'].hidden,r.ids['request-error-text'].textContent);assert(sent.context);assert.equal(view(r).scene.objects[0].label,'双人长椅');assert.equal(r.worldObjects.length,1);assert.equal(view(r).memoryNotes[0].body,'留出能并肩坐下的空间。');assert.match(r.ids['memory-panel'].textContent,/她的笔记/);assert.match(r.ids['memory-panel'].textContent,/这里要是/);assert.match(r.ids['log-list'].textContent,/另.*来访者/);assert.equal(r.ids['objects-panel'].hidden,false);assert.equal(view(r).index,before);assert.equal(r.saved.events.at(-1).schema,'her-world-turn-v1');});
test('first confirming sentence synchronizes objects notes logs and requested panel before later dialogue',async()=>{const clock=fakeClock();const r=withState(seeded(),{clock,reducedMotion:false,request:async()=>benchPlan()});await enableAI(r);await r.say('给我们摆一个能并排坐下的地方');assert.equal(view(r).scene.objects.length,1,'durable commit happens once');assert.equal(r.worldObjects.length,0,'visuals wait for confirming line');assert(!r.ids['reveal-controls'].hidden);await clock.advance(95);await r.click('skip-reveal');assert.equal(r.worldObjects.length,1);assert.match(r.ids['memory-panel'].textContent,/窗边的空位/);assert.match(r.ids['log-list'].textContent,/另.*来访者/);assert.equal(r.ids['objects-panel'].hidden,false);assert(!r.ids['reveal-controls'].hidden,'second line has not finished');assert(r.ids['free-form'].hidden);await r.click('tab-dialogue');await clock.flush();assert(r.ids['inspector-panel'].hidden,'old panel request must not reopen after closing');assert(!r.ids['free-form'].hidden);const restored=runtime({storage:r.storage});assert.equal(restored.worldObjects.length,1);assert.equal(view(restored).memoryNotes.length,1);assert(restored.ids['inspector-panel'].hidden);assert.equal(restored.count(),0);});
test('explicit later confirmation defers all panels together until its own sentence',async()=>{const clock=fakeClock();const r=withState(seeded(),{clock,reducedMotion:false,request:async()=>({...benchPlan(),applyAfterLine:1,lines:['先让我描一下轮廓。','这回放好了。']})});await enableAI(r);await r.say('画一个可以坐的地方');await clock.advance(95);await r.click('skip-reveal');assert.equal(r.worldObjects.length,0);assert.equal(r.ids['memory-count'].textContent,'00');await clock.advance(520);await r.click('skip-reveal');assert.equal(r.worldObjects.length,1);assert.equal(r.ids['memory-count'].textContent,'01');});
test('opening historical logs displays all existing rows immediately with no replay queue',async()=>{const clock=fakeClock();const r=withState(seeded(),{clock,reducedMotion:false});const before=r.ids['log-list'].children.length;assert(before>0);await r.click('tab-logs');assert.equal(r.ids['log-list'].children.length,before);assert(r.ids['log-list'].children.every(row=>row.className.includes('restored')));await r.click('tab-dialogue');await r.click('tab-logs');assert.equal(r.ids['log-list'].children.length,before);});
test('invalid unified plan or late cancelled response never commits dialogue or partial notes',async()=>{for(const cancel of [false,true]){let resolve;const r=withState(seeded(),{unified:true,provider:async()=>cancel?new Promise(done=>resolve=done):({...benchPlan(),sceneEdits:[{type:'update',target:'obj_999',changes:{x:10}}]})});await enableAI(r);const before=JSON.stringify(r.saved);r.ids['free-input'].value='给我们画一个坐下的地方';const sending=r.ids['free-form'].emit('submit');await new Promise(done=>setImmediate(done));if(cancel){await r.click('ai-status-button');await r.click('disconnect-button');resolve(benchPlan());}await sending;assert.equal(JSON.stringify(r.saved),before);assert.equal(r.worldObjects.length,0);assert(!r.ids.transcript.textContent.includes('已经放好了'));}});
test('pending unconnected text uses unified context after user chooses AI',async()=>{let sent;const r=withState(seeded(),{unified:true,provider:async ctx=>{sent=ctx;return {schema:'her-world-turn-v1',lines:['先安静地坐一会儿。']};}});await r.say('我今天只是想休息一下');assert(r.ids['connect-dialog'].open);r.ids['api-key'].value='MOCK_ONLY_KEY';await r.ids['connect-form'].emit('submit');assert.equal(sent.playerSaid,'我今天只是想休息一下');assert(sent.context.rain.created);assert.equal(r.saved.events.at(-1).schema,'her-world-turn-v1');});
test('missing unified module preserves the original save and cannot start',()=>{const original=JSON.stringify(seeded()),storage=new Map([['her-world.prologue.v3',original]]);const r=runtime({storage,missingTurn:true});assert.equal(storage.get('her-world.prologue.v3'),original);assert(r.ids['start-button'].disabled);assert.equal(r.count(),0);});

test('new manual drawer navigation wins over a delayed model panel request',async()=>{for(const beforeResponse of [false,true]){const clock=fakeClock();let resolve;const r=withState(seeded(),{clock,reducedMotion:false,request:async()=>beforeResponse?new Promise(done=>resolve=done):({...benchPlan(),applyAfterLine:1})});await enableAI(r);r.ids['free-input'].value='给窗边添一个座位';const sending=r.ids['free-form'].emit('submit');if(beforeResponse){await r.click('tab-memory');resolve(benchPlan());}await sending;if(!beforeResponse){await clock.advance(95);await r.click('skip-reveal');await r.click('tab-memory');}await clock.flush();assert.equal(r.ids['memory-panel'].hidden,false);assert.equal(r.ids['objects-panel'].hidden,true);assert.equal(r.worldObjects.length,1);}});

test('proxy connection names its credential and discloses both recipients and retained context',()=>{assert.match(html,/<label for="api-key">转发访问密码<\/label>/);assert.match(html,/216\.235\.248\.104/);assert.match(html,/发送给 DMXAPI/);assert.match(html,/记忆与原话来源/);assert(!html.includes('https://www.dmxapi.cn/v1/chat/completions'));const r=runtime();assert.equal(r.count(),0);assert(!r.ai.connected());assert.equal(r.ids['api-key'].value,'');});
test('visible build and all local runtime asset cache tags stay consistent',()=>{const versions=[...source.matchAll(/PROLOGUE v([0-9.]+)/g)].map(m=>m[1]);assert(versions.length);assert(versions.every(v=>v===versions[0]));const assets=[...html.matchAll(/(?:src|href)="\.\/[^"?]+\?v=([0-9.]+)"/g)].map(m=>m[1]);assert.equal(assets.length,9);assert(assets.every(v=>v===versions[0]));assert(html.includes(`PROLOGUE v${versions[0]}`));});

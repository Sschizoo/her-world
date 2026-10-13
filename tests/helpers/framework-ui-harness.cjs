/* Interaction tests use the real runtime and packs. DOM emulation is not pixel QA. */
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../../framework/app.js');
const runtime = require('../../framework/runtime.js');
const packs = require('../../framework/packs.js');
const offline = require('../../framework/offline.js');
const focus = require('../../framework/focus.js');
const legacy = require('../../framework/legacy-adapter.js');
const html = fs.readFileSync(path.join(__dirname, '../../framework.html'), 'utf8');
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
  const documentEvents={};document.visibilityState='visible';document.addEventListener=(name,fn)=>(documentEvents[name]||=[]).push(fn);document.removeEventListener=()=>{};
  let calls=0;
  // Synthetic requests still use the real credential-owner boundary.
  const credentials=require('../../framework/model.js').create({fetch:()=>{throw Error('unexpected network');}});
  let model=options.model||{...credentials,calls:()=>calls,async request(args){calls++;return options.request?options.request(args):plan(['我听见了。']);}};
  const storage={getItem(key){if(options.beforeRead)options.beforeRead(key,store);if(options.blocked)throw Error('denied');return store.has(key)?store.get(key):null;},setItem(key,value){if(options.beforeWrite)options.beforeWrite(key,value,store);if(options.blocked || options.writeFails && options.writeFails(key))throw Error('denied');if(options.writes)options.writes.push({key,value});if(!options.dropWrites || !options.dropWrites(key))store.set(key,value);}};
  const draws=[],motionCalls=[];let suspends=0,resumes=0,rendererDestroyed=0;
  const win={document,navigator:options.navigator||{},location:{search:options.search||'',href:'http://localhost/framework.html'+(options.search||'')},history:{replaceState(){}},matchMedia:()=>media,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,addEventListener(name,fn){(events[name]||=[]).push(fn);},removeEventListener(name,fn){events[name]=(events[name]||[]).filter(item=>item!==fn);}};
  if(options.createModel)model=options.createModel(win);
  const app=UI.create({window:win,document,runtime:options.runtime||runtime,packs:options.packs||packs,offline,focus,legacy,model,storage,renderer:{update:view=>draws.push(view.world),setReducedMotion:value=>motionCalls.push(value),suspend(){suspends++;},resume(){resumes++;},destroy(){rendererDestroyed++;}}});
  return {app,ids,store,model,timers,draws,motionCalls,lifecycle:()=>({suspends,resumes,rendererDestroyed}),media,win,document,async offline(){await ids['offline-button'].emit('click');},async online(){ids['api-key'].value='TEST_ONLY_PASSWORD';await ids['connect-form'].emit('submit');},async say(text){ids['free-input'].value=text;return ids['free-form'].emit('submit');},async event(name,event={}){for(const fn of [...(events[name]||[]),...(documentEvents[name]||[])])await fn(event);}};
}
const plan=(lines,beats=[],topic=null)=>({schema:'her-world-turn-v2',lines,beats,topic});
const addObject={type:'world.create',object:{label:'纸船',glyphs:' /\\\n/==\\',x:48,y:42,scale:1}};
const addMemory={type:'memory.upsert',id:'note_visit',title:'窗边',body:'一起看天亮'};
async function prepareRainQuestion(r, name=true) {
  await r.offline();await r.say('/回答 雨是水滴');await r.timers.flush();
  if(name){await r.say('/回答 夜航');await r.timers.flush();}
  await r.online();
}


module.exports={setup,runtime,packs,plan,prepareRainQuestion};

const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require('path').join(__dirname, '../ai.js'),'utf8');
const fakeKey='MOCK_ONLY_NOT_A_REAL_KEY';
function runtime(fetchImpl, overrides={}) { const listeners={}; const w={addEventListener:(name,cb)=>listeners[name]=cb}; const c={window:w,fetch:fetchImpl,AbortController,TextEncoder,TextDecoder,setTimeout,clearTimeout,...overrides}; vm.runInNewContext(source,c); return {api:w.HerAI,listeners}; }
const response=(lines=['一场雨。'])=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({lines})}}]}),{status:200,headers:{'Content-Type':'application/json'}});
const contentResponse=(content,extra={})=>new Response(JSON.stringify({choices:[{message:{content,...extra}}]}),{status:200,headers:{'Content-Type':'application/json'}});
const jsonResponse=payload=>contentResponse(JSON.stringify(payload));
const input={scene:{id:'first_rain',prompt:['雨是什么？']},input:'你好',rainName:'小雨',recent:[]};
const turnInput={...input,world:{rain:{name:'小雨',density:'normal',paused:false,created:true},name:'她',milestones:['awakened','rain_created']},topic:'rain',allowedActions:[]};
const semanticInput={...turnInput,input:'它像天空给大地写的一封湿润的信。',answerQuestion:'teach_rain',pendingTopic:'teach_rain'};
const verdict=evidence=>({type:'rain_definition',question:'teach_rain',evidence});
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 let checks=0;
 const check=async(name,fn)=>{await fn(); checks++; console.log('PASS '+name)};
 await check('fixed endpoint, model, header, omitted credentials, no redirect or referrer',async()=>{let call;let{api}=runtime(async(...args)=>(call=args,response()));assert(api.connect(fakeKey)); await api.request(input);assert.equal(call[0],'https://www.dmxapi.cn/v1/chat/completions');assert.equal(call[1].headers.Authorization,`Bearer ${fakeKey}`);assert.equal(JSON.parse(call[1].body).model,'glm-5.3-flash');assert(!call[1].body.includes(fakeKey));assert.equal(call[1].credentials,'omit');assert.equal(call[1].redirect,'error');assert.equal(call[1].referrerPolicy,'no-referrer')});
 await check('invalid credentials rejected without outbound call',async()=>{let calls=0;let{api}=runtime(async()=>{calls++;return response()});for(const key of ['', 'short',fakeKey+'\r\nBAD', 'x'.repeat(501)])assert.equal(api.connect(key),false);await assert.rejects(api.request(input),e=>e.code==='disconnected');assert.equal(calls,0)});
 await check('disconnected and pagehide clear volatile key',async()=>{let calls=0;let{api,listeners}=runtime(async()=>{calls++;return response()});api.connect(fakeKey);listeners.pagehide();assert.equal(api.connected(),false);await assert.rejects(api.request(input),e=>e.code==='disconnected');assert.equal(calls,0)});
 await check('upstream echo of exact key rejected',async()=>{let{api}=runtime(async()=>response([fakeKey]));api.connect(fakeKey);await assert.rejects(api.request(input),e=>e.code==='format'&&!e.message.includes(fakeKey))});
 await check('authentication, quota, upstream errors do not expose response bodies',async()=>{for(const[status,code]of[[401,'auth'],[403,'auth'],[429,'quota'],[500,'upstream']]){let{api}=runtime(async()=>new Response(fakeKey,{status}));api.connect(fakeKey);await assert.rejects(api.request(input),e=>e.code===code&&!e.message.includes(fakeKey))}});
 await check('network exception sanitized',async()=>{let{api}=runtime(async()=>{throw new Error(fakeKey)});api.connect(fakeKey);await assert.rejects(api.request(input),e=>e.code==='network'&&!e.message.includes(fakeKey))});
 await check('ordinary prose, content text arrays and fenced JSON are accepted',async()=>{for(const content of ['雨落下来了。\\n我想再看一会儿。',[{type:'text',text:'你说的，我听见了。'}],'```json\\n{"lines":["我们慢慢来。"],"scene":999}\\n```']){const normalized=typeof content==='string'?content.replaceAll('\\n','\n'):content;let{api}=runtime(async()=>new Response(JSON.stringify({choices:[{message:{content:normalized}}]})));api.connect(fakeKey);const lines=await api.request(input);assert(lines.length>0);assert(!lines.join('').includes('scene'));}});
 await check('malformed JSON-looking and unsupported structured content rejected',async()=>{for(const content of ['{"lines":',JSON.stringify({reasoning_content:'private'}),JSON.stringify({lines:[]}),JSON.stringify({lines:[1]})]){let{api}=runtime(async()=>new Response(JSON.stringify({choices:[{message:{content}}]})));api.connect(fakeKey);await assert.rejects(api.request(input),e=>e.code==='format')}});
 await check('reasoning-only and truncation never expose reasoning',async()=>{for(const [content,finish_reason,code] of [[null,'length','truncated'],['','stop','empty'],['<think>private','length','truncated']]){let{api}=runtime(async()=>new Response(JSON.stringify({choices:[{message:{content,reasoning_content:'private'},finish_reason}]})));api.connect(fakeKey);await assert.rejects(api.request(input),e=>e.code===code&&!e.message.includes('private'));}});
 await check('final text is bounded and marked analysis is hidden',async()=>{let{api}=runtime(async()=>new Response(JSON.stringify({choices:[{message:{content:'<think>private</think>雨'.repeat(600)}}]})));api.connect(fakeKey);const lines=await api.request(input);assert(lines.join('').length<=450);assert(!lines.join('').includes('private'));});
 await check('response over byte cap rejected',async()=>{let{api}=runtime(async()=>new Response('a'.repeat(65537)));api.connect(fakeKey);await assert.rejects(api.request(input),e=>e.code==='format')});
 await check('only one concurrent request, disconnect aborts request',async()=>{let calls=0;let{api}=runtime((url,o)=>{calls++;return new Promise((res,rej)=>o.signal.addEventListener('abort',()=>rej(new DOMException('aborted','AbortError'))))});api.connect(fakeKey);const pending=api.request(input);await assert.rejects(api.request(input),e=>e.code==='busy');api.disconnect();await assert.rejects(pending,e=>e.code==='cancelled');assert.equal(calls,1);assert.equal(api.connected(),false)});
 await check('20-call page session reminder cap',async()=>{let calls=0;let{api}=runtime(async()=>{calls++;return response()});api.connect(fakeKey);for(let i=0;i<20;i++)await api.request(input);await assert.rejects(api.request(input),e=>e.code==='limit');assert.equal(calls,20)});
 await check('timeout aborts and does not retry',async()=>{let timer,calls=0;let{api}=runtime((url,o)=>{calls++;return new Promise((res,rej)=>o.signal.addEventListener('abort',()=>rej(new DOMException('aborted','AbortError'))))},{setTimeout:fn=>(timer=fn,1),clearTimeout:()=>{}});api.connect(fakeKey);const pending=api.request(input);timer();await assert.rejects(pending,e=>e.code==='timeout');assert.equal(calls,1)});
 await check('known HTTP error survives synchronous cleanup failure',async()=>{let{api}=runtime(async()=>({ok:false,status:401,body:{cancel(){throw Error('cleanup')}}}));api.connect(fakeKey);await assert.rejects(api.request(input),e=>e.code==='auth'&&e.httpStatus===401&&e.message.startsWith('HTTP 401')&&!e.message.includes('cleanup'));});
 await check('whole headers, Bearer prefixes, quotes, internal spaces and non-ASCII fail locally',async()=>{let calls=0;let{api}=runtime(async()=>{calls++;return response()});for(const value of ['Bearer '+fakeKey,'Authorization:'+fakeKey,'"'+fakeKey+'"',"'"+fakeKey+"'",fakeKey+' space',fakeKey+'中文'])assert.equal(api.connect(value),false);assert.equal(calls,0);assert(api.connect('  '+fakeKey+'  '));await api.request(input);assert.equal(calls,1);});
 await check('disconnect before request prevents empty Authorization transmission',async()=>{let calls=0;let{api}=runtime(async()=>{calls++;return response()});api.connect(fakeKey);api.disconnect();await assert.rejects(api.request(input),e=>e.code==='disconnected');assert.equal(calls,0);});
 await check('known response read interruption retains HTTP status',async()=>{let{api}=runtime(async()=>new Response(new ReadableStream({start(c){c.error(Error('PRIVATE_STREAM_FAILURE'))}}),{status:200}));api.connect(fakeKey);await assert.rejects(api.request(input),e=>e.code==='response_read'&&e.httpStatus===200&&!e.message.includes('PRIVATE_STREAM_FAILURE'));});
 await check('nonlinear prose does not require JSON and never executes an action',async()=>{for(const content of ['雨落下来了。\n我想再看一会儿。',[{type:'text',text:'我听见了。'},{type:'reasoning',text:'PRIVATE_THOUGHT'}]]){let{api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);const result=await api.request({...turnInput,allowedActions:[{type:'rain_pause'}]});assert(result.lines.length>0);assert.equal(result.action,null);assert.equal(result.structured,false);assert(!result.lines.join('').includes('PRIVATE_THOUGHT'));}});
 await check('each whitelisted structured rain action matches an exact local allowance',async()=>{for(const action of [{type:'rain_density',value:'gentle'},{type:'rain_density',value:'normal'},{type:'rain_density',value:'heavy'},{type:'rain_pause'},{type:'rain_resume'},{type:'rain_start'}]){let{api}=runtime(async()=>jsonResponse({lines:['我会照你说的做。'],action}));api.connect(fakeKey);const result=await api.request({...turnInput,allowedActions:[action]});assert.deepEqual(plain(result),{lines:['我会照你说的做。'],action,structured:true,answer:null,intent:null,storyIntent:null});assert(Object.isFrozen(result.action));}});
 await check('structured null action succeeds and ignores unknown state fields',async()=>{let{api}=runtime(async()=>jsonResponse({lines:['我们可以慢慢聊。'],action:null,scene:'ending',state:{density:'heavy'},tools:[{type:'rain_pause'}]}));api.connect(fakeKey);assert.deepEqual(plain(await api.request(turnInput)),{lines:['我们可以慢慢聊。'],action:null,structured:true,answer:null,intent:null,storyIntent:null});});
 await check('legacy lines and common JSON text wrappers remain displayable in nonlinear mode',async()=>{for(const payload of [{lines:['我们慢慢来。']},{reply:'我们慢慢来。'},{text:'我们慢慢来。'},{response:'我们慢慢来。'}]){let{api}=runtime(async()=>jsonResponse(payload));api.connect(fakeKey);assert.deepEqual(plain(await api.request(turnInput)),{lines:['我们慢慢来。'],action:null,structured:false,answer:null,intent:null,storyIntent:null});}});
 await check('forbidden, extra-field, malformed or unallowed actions reject the whole reply',async()=>{for(const action of [{type:'scene',value:'ending'},{type:'rain_density',value:'storm'},{type:'rain_density',value:'heavy'},{type:'rain_pause',value:'gentle'},{type:'rain_pause',state:{scene:'ending'}},{type:'rain_pause',tool:'eval'},{type:'rain_resume'},'rain_pause',[],[{type:'rain_pause'}],{},true,1]){let{api}=runtime(async()=>jsonResponse({lines:['操作已经完成。'],action}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,allowedActions:[{type:'rain_pause'},{type:'rain_density',value:'gentle'}]}),e=>e.code==='format'&&!e.message.includes('操作已经完成'));}});
 await check('empty allowance rejects even a globally recognized action',async()=>{let{api}=runtime(async()=>jsonResponse({lines:['雨停了。'],action:{type:'rain_pause'}}));api.connect(fakeKey);await assert.rejects(api.request(turnInput),e=>e.code==='format');});
 await check('structured action requires the documented lines array',async()=>{for(const payload of [{reply:'雨停了。',action:{type:'rain_pause'}},{lines:[],action:{type:'rain_pause'}},{lines:[42],action:{type:'rain_pause'}},{lines:[42],reply:'雨停了。',action:{type:'rain_pause'}},{lines:'雨停了。',action:{type:'rain_pause'}},{action:{type:'rain_pause'}},{state:{rain:'paused'}},['雨停了。']]){let{api}=runtime(async()=>jsonResponse(payload));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,allowedActions:[{type:'rain_pause'}]}),e=>e.code==='format');}});
 await check('malformed nonlinear JSON never falls back to prose or operations',async()=>{for(const content of ['{"lines":','{"lines":["雨停了。"],"action":{"type":"rain_pause"}', '```json\n{"action":\n```']){let{api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,allowedActions:[{type:'rain_pause'}]}),e=>e.code==='format');}});
 await check('outgoing allowlist strips invalid objects, deduplicates and preserves caller data',async()=>{let sent;const allowedActions=[{type:'rain_pause'},{type:'rain_pause'},{type:'rain_resume'},{type:'rain_density',value:'gentle'},{type:'rain_density',value:'heavy',scene:'ending'},{type:'scene',value:'ending'},null];const before=JSON.stringify(allowedActions);let{api}=runtime(async(url,options)=>{sent=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return jsonResponse({lines:['听见了。'],action:null});});api.connect(fakeKey);await api.request({...turnInput,allowedActions});assert.deepEqual(sent.allowedActions,[{type:'rain_pause'},{type:'rain_resume'},{type:'rain_density',value:'gentle'}]);assert.equal(JSON.stringify(allowedActions),before);});
 await check('allowlist is snapshotted before awaiting provider response',async()=>{let complete;const allowedActions=[{type:'rain_pause'}];let{api}=runtime(()=>new Promise(resolve=>complete=resolve));api.connect(fakeKey);const pending=api.request({...turnInput,allowedActions});allowedActions[0].type='rain_resume';allowedActions.push({type:'rain_density',value:'heavy'});complete(jsonResponse({lines:['雨继续落下。'],action:{type:'rain_resume'}}));await assert.rejects(pending,e=>e.code==='format');});
 await check('only a bounded world snapshot and capped user context leave the page',async()=>{let body;const unknown='DO_NOT_SERIALIZE';let{api}=runtime(async(url,options)=>{body=JSON.parse(options.body);return jsonResponse({lines:['我听见了。'],action:null});});api.connect(fakeKey);await api.request({...turnInput,scene:{id:'s'.repeat(100),prompt:Array.from({length:8},()=> 'q'.repeat(500)),private:unknown},input:'i'.repeat(1000),rainName:'n'.repeat(1000),topic:'t'.repeat(1000),recent:Array.from({length:20},(_,i)=>({role:i%2?'user':'system',text:'h'.repeat(1000),secret:unknown})),world:{rain:{name:'r'.repeat(1000),density:'heavy',paused:true,created:true,secret:unknown},name:'p'.repeat(1000),milestones:Array.from({length:25},()=> 'm'.repeat(1000)),secrets:unknown,chapter:100},allowedActions:[]});const context=JSON.parse(body.messages.at(-1).content);assert.equal(context.playerSaid.length,80);assert.equal(context.namedRain.length,20);assert.equal(context.scene.length,50);assert.equal(context.currentQuestion.length,3);assert(context.currentQuestion.every(line=>line.length<=100));assert.equal(context.topic.length,60);assert.equal(context.world.name.length,20);assert.equal(context.world.rain.name.length,20);assert.deepEqual(Object.keys(context.world).sort(),['milestones','name','rain']);assert.deepEqual(Object.keys(context.world.rain).sort(),['created','density','name','paused']);assert.equal(context.world.milestones.length,12);assert(context.world.milestones.every(mark=>mark.length<=60));assert.equal(body.messages.length,8);assert(body.messages.slice(1,-1).every(item=>['user','assistant'].includes(item.role)&&item.content.length<=300));assert(!JSON.stringify(body).includes(unknown));assert.equal(body.max_tokens,2048);assert.equal(body.reasoning_effort,'low');assert.equal(body.stream,false);assert(!('tools' in body));assert(!('response_format' in body));});
 await check('invalid world fields cannot serialize unknown objects or arbitrary states',async()=>{let context;let{api}=runtime(async(url,options)=>{context=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return contentResponse('我们继续聊。');});api.connect(fakeKey);await api.request({...turnInput,scene:{prompt:{private:'not a list'}},input:{private:'not input'},rainName:{private:'not name'},topic:{private:'not topic'},recent:[null],world:{rain:{name:{secret:'no'},density:'storm',paused:'yes',created:1},name:{secret:'no'},milestones:[{secret:'no'},123,'valid']},allowedActions:[{type:'rain_pause',extra:true}]});assert.deepEqual(context.world,{rain:{name:'',density:'normal',paused:false,created:false},name:'',milestones:['valid']});assert.deepEqual(context.allowedActions,[]);assert.deepEqual(context.currentQuestion,[]);assert.equal(context.playerSaid,'');assert.equal(context.topic,'');});
 await check('opening keeps legacy array shape even when nonlinear context is supplied',async()=>{let body;let{api}=runtime(async(url,options)=>{body=JSON.parse(options.body);return contentResponse('原来有人在。');});api.connect(fakeKey);assert.deepEqual(plain(await api.request({...turnInput,opening:true,allowedActions:[{type:'rain_pause'}]})),['原来有人在。']);const context=JSON.parse(body.messages.at(-1).content);assert(!('allowedActions' in context));assert(!('world' in context));assert(body.messages[0].content.includes('不要JSON'));});
 await check('topic-only and allowlist-only callers opt into turn mode',async()=>{for(const options of [{...input,topic:'memory'},{...input,allowedActions:[]},{...input,world:{}}]){let{api}=runtime(async()=>contentResponse('我还记得。'));api.connect(fakeKey);assert.deepEqual(plain(await api.request(options)),{lines:['我还记得。'],action:null,structured:false,answer:null,intent:null,storyIntent:null});}});
 await check('marked thought stripping, key echo checks and visible limits also apply to structured turns',async()=>{let{api}=runtime(async()=>contentResponse('<think>PRIVATE_THOUGHT</think>```json\n'+JSON.stringify({lines:['<analysis>PRIVATE_THOUGHT</analysis>'+ '雨'.repeat(600)],action:{type:'rain_pause'}})+'\n```',{reasoning_content:'PRIVATE_THOUGHT'}));api.connect(fakeKey);const result=await api.request({...turnInput,allowedActions:[{type:'rain_pause'}]});assert.equal(result.structured,true);assert.equal(result.action.type,'rain_pause');assert(result.lines.join('').length<=450);assert(!result.lines.join('').includes('PRIVATE_THOUGHT'));for(const lines of [[fakeKey],['<think>unfinished'],['<analysis>unfinished']]){let{api:bad}=runtime(async()=>jsonResponse({lines,action:{type:'rain_pause'}}));bad.connect(fakeKey);await assert.rejects(bad.request({...turnInput,allowedActions:[{type:'rain_pause'}]}),e=>e.code==='format'&&!e.message.includes(fakeKey));}});
 await check('transport never mutates supplied world or allowance while selecting an action',async()=>{const options=JSON.parse(JSON.stringify({...turnInput,allowedActions:[{type:'rain_pause'}]}));const before=JSON.stringify(options);let{api}=runtime(async()=>jsonResponse({lines:['让它安静片刻。'],action:{type:'rain_pause'}}));api.connect(fakeKey);const result=await api.request(options);assert.equal(result.action.type,'rain_pause');assert.equal(JSON.stringify(options),before);assert.equal(options.world.rain.paused,false);});
 await check('locally accepted answers and pending questions are exact bounded metadata',async()=>{for(const [answer,expected] of [[{type:'rain_name',value:'夜航'},{type:'rain_name',value:'夜航'}],[{type:'rain_definition'},{type:'rain_definition'}],[{type:'rain_name',value:'雨'.repeat(21)},null],[{type:'rain_name',value:'夜航',secret:'DO_NOT_SERIALIZE'},null],[{type:'scene',value:'ending'},null]]){let sent;const {api}=runtime(async(url,options)=>{sent=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return contentResponse('我听到了。');});api.connect(fakeKey);await api.request({...turnInput,acceptedAnswer:answer,pendingTopic:'teach_rain'});assert.deepEqual(sent.acceptedAnswer,expected);assert.equal(sent.pendingTopic,'teach_rain');assert(!JSON.stringify(sent).includes('DO_NOT_SERIALIZE'));}});
 await check('semantic metaphor verdict uses exact current input without creating weather',async()=>{
  for(const text of ['它像天空给大地写的一封湿润的信。','冰凉的细丝落在脸上，让远处的街道慢慢模糊。','雨是天空落下的小水滴。']){
   const answer=verdict(text);const options={...semanticInput,input:text};const before=JSON.stringify(options);
   const {api}=runtime(async()=>jsonResponse({lines:['我想象到了那种触感。'],action:null,answer}));api.connect(fakeKey);
   const result=await api.request(options);assert.deepEqual(plain(result),{lines:['我想象到了那种触感。'],action:null,structured:true,answer,intent:null,storyIntent:null});assert(Object.isFrozen(result.answer));assert.equal(JSON.stringify(options),before);
  }
 });
 await check('prompt grants only the explicit bounded semantic question and retains local metadata',async()=>{
  let body;const {api}=runtime(async(url,options)=>{body=JSON.parse(options.body);return contentResponse('我听着。')});api.connect(fakeKey);
  const result=await api.request({...semanticInput,acceptedAnswer:{type:'rain_definition'}});const context=JSON.parse(body.messages.at(-1).content);
  assert.equal(context.answerQuestion,'teach_rain');assert.equal(context.pendingTopic,'teach_rain');assert.deepEqual(context.acceptedAnswer,{type:'rain_definition'});assert.equal(result.answer,null);
  for(const instruction of ['比喻','时钟','假设','否定','引用','回忆','当前playerSaid','answerQuestion为空时answer只能为null','不创造雨'])assert(body.messages[0].content.includes(instruction));
 });
 await check('ordinary prose and explicit null verdict never imply a semantic answer',async()=>{
  for(const content of ['我听懂你的意思了。',JSON.stringify({lines:['我听着。'],action:null,answer:null}),JSON.stringify({lines:['我听着。'],answer:null})]){
   const {api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);const result=await api.request(semanticInput);assert.equal(result.answer,null);assert.equal(result.action,null);assert.equal(result.structured,content.startsWith('{'));
  }
 });
 await check('obvious clock, date and status questions revoke semantic authority independently',async()=>{
  for(const text of ['现在的时间是几点？','现在几点了？','时间是多少？','今天星期几？','你是谁？','系统的版本号是什么？','你的状态如何？','What time is it?','what is your version?']){
   let context;const {api}=runtime(async(url,options)=>{context=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return jsonResponse({lines:['我明白雨了。'],action:null,answer:verdict(text)})});api.connect(fakeKey);
   await assert.rejects(api.request({...semanticInput,input:text}),e=>e.code==='format');assert.equal(context.answerQuestion,null);assert.equal(context.pendingTopic,'teach_rain');
  }
 });
 await check('absent, invalid or different question cannot authorize a current-input verdict',async()=>{
  for(const answerQuestion of [undefined,null,'rain_name','teach_rain ',true,{},['teach_rain']]){
   let context;const {api}=runtime(async(url,options)=>{context=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return jsonResponse({lines:['我听到了。'],answer:verdict(semanticInput.input)})});api.connect(fakeKey);
   await assert.rejects(api.request({...semanticInput,answerQuestion}),e=>e.code==='format');assert.equal(context.answerQuestion,null);
  }
 });
 await check('semantic verdict requires exactly the allowed keys, type and question',async()=>{
  const valid=verdict(semanticInput.input);
  for(const answer of [{...valid,type:'rain_name'},{...valid,question:'rain_name'},{...valid,question:'teach_rain '},{...valid,action:{type:'rain_pause'}},{...valid,state:{created:true}},{...valid,reasoning:'private'}, {type:'rain_definition',question:'teach_rain'}, {type:'rain_definition',evidence:semanticInput.input},'rain_definition',[],[valid],{},true,1]){
   const {api}=runtime(async()=>jsonResponse({lines:['回答已记录。'],action:null,answer}));api.connect(fakeKey);await assert.rejects(api.request(semanticInput),e=>e.code==='format'&&!e.message.includes('回答已记录'));
  }
 });
 await check('semantic evidence must be a nonempty exact excerpt of current bounded input',async()=>{
  for(const evidence of ['', ' ',null,7,{},'天空写给大地的一封信','历史里的细雨','尾部不能引用','雨'.repeat(81)]){
   const {api}=runtime(async()=>jsonResponse({lines:['我听到了。'],answer:verdict(evidence)}));api.connect(fakeKey);
   await assert.rejects(api.request({...semanticInput,input:'雨'.repeat(80)+'尾部不能引用',recent:[{role:'user',text:'历史里的细雨'}]}),e=>e.code==='format');
  }
  const excerpt='天空给大地写的一封湿润的信';const {api}=runtime(async()=>jsonResponse({lines:['这封信很轻。'],answer:verdict(excerpt)}));api.connect(fakeKey);assert.equal((await api.request(semanticInput)).answer.evidence,excerpt);
 });
 await check('input and verdict evidence snapshots cannot be changed while provider is pending',async()=>{
  let complete;const options={...semanticInput};const {api}=runtime(()=>new Promise(resolve=>complete=resolve));api.connect(fakeKey);const pending=api.request(options);options.input='后来改成了雨是水滴';options.answerQuestion=null;
  complete(jsonResponse({lines:['我听到了。'],action:null,answer:verdict(semanticInput.input)}));assert.equal((await pending).answer.evidence,semanticInput.input);
 });
 await check('semantic evidence shares the outgoing bound and never serializes tail metadata',async()=>{
  let context,body;const {api}=runtime(async(url,options)=>{body=options.body;context=JSON.parse(JSON.parse(body).messages.at(-1).content);return jsonResponse({lines:['它一直落下。'],action:null,answer:verdict('雨'.repeat(80))})});api.connect(fakeKey);
  const result=await api.request({...semanticInput,input:'雨'.repeat(80)+'DO_NOT_SERIALIZE',answerQuestion:'teach_rain'});assert.equal(context.playerSaid,'雨'.repeat(80));assert.equal(result.answer.evidence.length,80);assert(!body.includes('DO_NOT_SERIALIZE'));
  let sent;const {api:unicode}=runtime(async(url,options)=>{sent=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return jsonResponse({lines:['我听到了。'],answer:verdict('🌧'.repeat(40))})});unicode.connect(fakeKey);
  const result2=await unicode.request({...semanticInput,input:'🌧'.repeat(80)});assert.equal(sent.playerSaid,'🌧'.repeat(40));assert.equal(result2.answer.evidence,sent.playerSaid);assert(!/[\uD800-\uDBFF]$/.test(sent.playerSaid));
 });
 await check('semantic answer requires documented valid dialogue lines',async()=>{
  for(const payload of [{reply:'我听到了。'},{lines:[]},{lines:[42],reply:'我听到了。'},{lines:'我听到了。'},{}]){
   const {api}=runtime(async()=>jsonResponse({...payload,answer:verdict(semanticInput.input)}));api.connect(fakeKey);await assert.rejects(api.request(semanticInput),e=>e.code==='format');
  }
 });
 await check('opening and legacy responses ignore verdict fields and cannot receive authority',async()=>{
  for(const options of [{...semanticInput,opening:true},{...input,answerQuestion:'teach_rain',pendingTopic:'teach_rain'}]){
   let context;const {api}=runtime(async(url,request)=>{context=JSON.parse(JSON.parse(request.body).messages.at(-1).content);return jsonResponse({lines:['原来你在这里。'],answer:{type:'unknown',evidence:'not current'},action:{type:'rain_pause'}})});api.connect(fakeKey);
   assert.deepEqual(plain(await api.request(options)),['原来你在这里。']);assert(!('answerQuestion' in context));
  }
 });
 await check('thought tags and key echoes inside exact evidence reject the whole verdict',async()=>{
  for(const evidence of [fakeKey,'<think>private</think>雨','<analysis>private</analysis>雨','<think>unfinished','<analysis>unfinished','雨\u0000滴']){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],action:null,answer:verdict(evidence)}));api.connect(fakeKey);
   await assert.rejects(api.request({...semanticInput,input:evidence}),e=>e.code==='format'&&!e.message.includes(fakeKey)&&!e.message.includes('private'));
  }
  const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],answer:verdict('<think>private</think>雨')}));api.connect(fakeKey);await assert.rejects(api.request({...semanticInput,input:'<think>private</think>雨，雨'}),e=>e.code==='format');
 });
 await check('safe semantic verdict can coexist with filtered dialogue but cannot widen weather authority',async()=>{
  const answer=verdict(semanticInput.input);const {api}=runtime(async()=>contentResponse('<think>PRIVATE_THOUGHT</think>```json\n'+JSON.stringify({lines:['<analysis>PRIVATE_THOUGHT</analysis>我听到了。'],action:null,answer})+'\n```'));api.connect(fakeKey);
  assert.deepEqual(plain(await api.request(semanticInput)),{lines:['我听到了。'],action:null,structured:true,answer,intent:null,storyIntent:null});
  const {api:bad}=runtime(async()=>jsonResponse({lines:['雨已经开始落下。'],action:{type:'rain_resume'},answer}));bad.connect(fakeKey);await assert.rejects(bad.request(semanticInput),e=>e.code==='format');
 });
 await check('all name context fields consistently preserve twenty Unicode codepoints',async()=>{
  const name='🌧'.repeat(20);let context;const {api}=runtime(async(url,options)=>{context=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return contentResponse('我记下了这个名字。')});api.connect(fakeKey);
  await api.request({...turnInput,rainName:name,world:{...turnInput.world,name,rain:{...turnInput.world.rain,name}},acceptedAnswer:{type:'rain_name',value:name}});
  assert.equal(context.namedRain,name);assert.equal(context.world.name,name);assert.equal(context.world.rain.name,name);assert.equal(context.acceptedAnswer.value,name);
 });
 await check('observed live prose then JSON extracts only final dialogue and exact rain answer',async()=>{
  const text='像天空轻轻敲窗，细碎的凉意落在手心。人走到屋檐下，衣角也会慢慢湿掉。';
  const prefix='天空在轻轻敲窗——这个说法，我可以记下来。原来雨有声音，有凉意，还会让人躲到屋檐下。你的衣角湿掉的那一刻，大概就是它存在的证明吧。';
  const lines=['天空在轻轻敲窗——这个说法，我可以记下来。','原来雨有声音，有凉意，还会让人躲进屋檐。衣角慢慢湿掉的那一刻，大概就是它存在的证明吧。'];
  const answer=verdict(text),content=prefix+'\n'+JSON.stringify({lines,action:null,answer});
  const {api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);
  assert.deepEqual(plain(await api.request({...semanticInput,input:text})),{lines,action:null,answer,intent:null,storyIntent:null,structured:true});
 });
 await check('mixed JSON accepts reordered fields, fences, escaped quotes and nested string braces',async()=>{
  const lines=['我记得你说的 "{雨}"。','一个反斜线 \\ 也只是文字。'];
  const payload={answer:null,intent:null,action:null,lines,storyIntent:null};
  for(const content of ['听见了。\n'+JSON.stringify(payload),'听见了。\n```json\n'+JSON.stringify(payload)+'\n```','<think>PRIVATE</think>听见了。\n'+JSON.stringify(payload)]){
   const {api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);const result=await api.request(turnInput);assert.deepEqual(plain(result.lines),lines);assert.equal(result.structured,true);assert(!result.lines.join('').includes('PRIVATE'));
  }
 });
 await check('ordinary prose braces remain dialogue without creating control authority',async()=>{
  for(const content of ['雨里的 {空白}，也能慢慢填上。','她说“雨里有{窗}”。','{雨} 和 {窗} 都只是我的比喻。']){
   const {api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);
   const result=await api.request(turnInput);assert.equal(result.lines[0],content);assert.equal(result.action,null);assert.equal(result.structured,false);
  }
 });
 await check('mixed quoted, embedded and story example objects never execute',async()=>{
  const payload=JSON.stringify({lines:['雨停了。'],action:{type:'rain_pause'}});
  for(const content of ['例如下面这个例子。\n'+payload,'故事里的她这样说。\n'+payload,'她说：\n'+payload,'“听好了。\n'+payload+'”','他说“'+payload+'”。','这是一个 example。\n'+payload,'听见了。 '+payload,'听见了。\n'+payload+'\n这只是一个例子。','听见了。\n```json\n'+payload+'\n```\n然后呢。']){
   const {api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,allowedActions:[{type:'rain_pause'}]}),e=>e.code==='format');
  }
 });
 await check('multiple objects, duplicate keys and malformed control fragments reject completely',async()=>{
  const good=JSON.stringify({lines:['听见了。'],action:null});
  for(const content of ['听见了。\n'+good+'\n'+good,'听见了。\n{"debug":"PRIVATE"}\n'+good,'听见了。\n{"lines":["雨停了。"],"action":','听见了。\n{action:{type:"rain_pause"}}','听见了。\n'+good+'\n{','{"lines":["听见了。"],"action":null,"action":{"type":"rain_pause"}}','听见了。\n{"lines":["听见了。"],"action":{"type":"rain_pause","type":"rain_resume"}}']){
   const {api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,allowedActions:[{type:'rain_pause'},{type:'rain_resume'}]}),e=>e.code==='format');
  }
 });
 await check('mixed unknown objects, fields and debugging wrappers are never shown',async()=>{
  for(const payload of [{debug:'PRIVATE'},{unknown:'PRIVATE'},{lines:['听见了。'],action:null,reasoning:'PRIVATE'},{lines:['听见了。'],action:null,state:{rain:'pause'}},{reply:'听见了。',action:null}]){
   const {api}=runtime(async()=>contentResponse('听见了。\n'+JSON.stringify(payload)));api.connect(fakeKey);await assert.rejects(api.request(turnInput),e=>e.code==='format'&&!e.message.includes('PRIVATE'));
  }
 });
 await check('mixed thought markers, key echoes, byte limits and truncated responses fail closed',async()=>{
  for(const content of ['<think>PRIVATE\n'+JSON.stringify({lines:['听见了。'],action:null}),'听见了。\n'+JSON.stringify({lines:['<analysis>PRIVATE'],action:null}),'听见了。\n'+JSON.stringify({lines:[fakeKey],action:null}),'听见了。'.repeat(16000)+'\n'+JSON.stringify({lines:['听见了。'],action:null})]){
   const {api}=runtime(async()=>contentResponse(content));api.connect(fakeKey);await assert.rejects(api.request(turnInput),e=>e.code==='format'&&!e.message.includes(fakeKey)&&!e.message.includes('PRIVATE'));
  }
  const {api}=runtime(async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'听见了。\n{"lines":["unfinished',reasoning_content:'PRIVATE'}}]})));api.connect(fakeKey);await assert.rejects(api.request(turnInput),e=>e.code==='truncated');
 });
 await check('semantic weather capabilities need exact current evidence for natural requests',async()=>{
  for(const [text,action]of [['雨太吵了，先停一下吧',{type:'rain_pause'}],['还是想听刚才的雨',{type:'rain_resume'}],['我想看看你画出的第一场雨',{type:'rain_start'}],['能不能让窗外的雨轻些？',{type:'rain_density',value:'gentle'}]]){
   const intent={type:'weather_request',evidence:text};let sent,body;
   const {api}=runtime(async(url,options)=>{body=JSON.parse(options.body);sent=JSON.parse(body.messages.at(-1).content);return jsonResponse({lines:['我会照你说的做。'],action,intent})});api.connect(fakeKey);
   const result=await api.request({...turnInput,input:text,allowedActions:[action],requireActionEvidence:true});
   assert.deepEqual(plain(result.intent),intent);assert(Object.isFrozen(result.intent));assert.deepEqual(plain(result.action),action);assert.equal(sent.requireActionEvidence,true);assert(body.messages[0].content.includes('整个最终回复必须仅为一个完整JSON对象'));
  }
 });
 await check('absent and malformed weather intents never authorize semantic capability selection',async()=>{
  const text='雨太吵了，先停一下吧', valid={type:'weather_request',evidence:text},action={type:'rain_pause'};
  for(const intent of [undefined,null,{},[],true,'weather_request',{...valid,type:'rain_pause'},{...valid,extra:true},{type:'weather_request'},{...valid,evidence:''},{...valid,evidence:'停雨'},{...valid,evidence:'历史里我要求停雨'},{...valid,evidence:'雨'.repeat(81)}]){
   const {api}=runtime(async()=>jsonResponse({lines:['我会照你说的做。'],action,intent}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,recent:[{role:'user',text:'历史里我要求停雨'}],allowedActions:[action],requireActionEvidence:true}),e=>e.code==='format');
  }
 });
 await check('optional weather evidence is always strict and cannot exist without an action',async()=>{
  for(const [intent,action]of [[{type:'weather_request',evidence:'不在输入里'},{type:'rain_pause'}],[{type:'weather_request',evidence:'你好'},null]]){
   const {api}=runtime(async()=>jsonResponse({lines:['我听着。'],action,intent}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,allowedActions:[{type:'rain_pause'}],requireActionEvidence:false}),e=>e.code==='format');
  }
 });
 await check('current negative, hypothetical, past and quoted requests cannot forge weather evidence',async()=>{
  const action={type:'rain_pause'};
  for(const text of ['不要停雨','别暂停雨','如果雨太吵就先停一下','我昨天希望你把雨停下','刚才我让雨停下','我说过先停一下','她说先停雨','“先停雨”只是一个例子','现在几点了？',"Don't stop the rain"]){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],action,intent:{type:'weather_request',evidence:text}}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,allowedActions:[action],requireActionEvidence:true}),e=>e.code==='format');
  }
 });
 await check('weather evidence cannot contain secret echoes, thought markers or unbounded tail text',async()=>{
  const action={type:'rain_pause'};
  for(const [text,evidence]of [[fakeKey,fakeKey],['<think>PRIVATE</think>停雨','<think>PRIVATE</think>停雨'],['停\u0000雨','停\u0000雨'],['雨'.repeat(80)+'尾巴','尾巴']]){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],action,intent:{type:'weather_request',evidence}}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,allowedActions:[action],requireActionEvidence:true}),e=>e.code==='format'&&!e.message.includes(fakeKey));
  }
 });
 await check('unexecuted completed-weather claims reject while ordinary descriptions remain readable',async()=>{
  for(const text of ['我已经把雨停下了。','我已经画出了第一场雨。','雨已经停下了。']){
   const {api}=runtime(async()=>contentResponse(text));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,world:{...turnInput.world,rain:{...turnInput.world.rain,created:false}}}),e=>e.code==='format');
  }
  for(const text of ['雨落下来了。','我记得以前我已经把雨停下了。','如果雨已经停下，你会听见什么？','我没有把雨停下。']){
   const {api}=runtime(async()=>contentResponse(text));api.connect(fakeKey);assert.equal((await api.request(turnInput)).lines[0],text);
  }
 });
 await check('story intents match bounded capabilities and exact current-input evidence',async()=>{
  const cases=[['我们聊聊你那些没完成的地方',{type:'topic',value:'unfinished'},{type:'topic',value:'unfinished'}],['我想把这场雨叫作夜航',{type:'rain_name',value:'夜航'},{type:'rain_name'}],['因为这是你自己想留下来的东西',{type:'own_reason'},{type:'own_reason'}],['你可以记住我来过',{type:'visitor_choice',value:'remember'},{type:'visitor_choice',value:'remember'}],['不要记住我，匿名就好',{type:'visitor_choice',value:'anonymous'},{type:'visitor_choice',value:'anonymous'}],['我还没有决定要不要留下引用',{type:'visitor_choice',value:'undecided'},{type:'visitor_choice',value:'undecided'}],['今天先说再见啦',{type:'farewell'},{type:'farewell'}]];
  for(const [text,base,capability]of cases){
   const storyIntent={...base,evidence:text};const {api}=runtime(async()=>jsonResponse({lines:['我听见了。'],storyIntent}));api.connect(fakeKey);
   const result=await api.request({...turnInput,input:text,allowedStoryIntents:[capability]});assert.deepEqual(plain(result.storyIntent),storyIntent);assert.equal(result.structured,true);assert(Object.isFrozen(result.storyIntent));
  }
 });
 await check('story evidence rejects extra keys, unsupported transitions and invented names',async()=>{
  const text='我想把这场雨叫作夜航',valid={type:'rain_name',value:'夜航',evidence:text};
  for(const storyIntent of [{...valid,extra:true},{...valid,value:'曙光'},{...valid,evidence:'我想'},{...valid,evidence:'历史里的名字'},{...valid,type:'scene'},{...valid,value:'雨'.repeat(21)},true,{},[]]){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,allowedStoryIntents:[{type:'rain_name'}]}),e=>e.code==='format');
  }
  const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:valid}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,allowedStoryIntents:[]}),e=>e.code==='format');
 });
 await check('warmth, hypothetical consent and quoted decisions never become visitor permission',async()=>{
  for(const text of ['我很喜欢和你聊天','我愿意陪你一会儿','如果我允许你记住我会怎样','她说“你可以记住我”','我以前说过你可以记住我','不要记住我']){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:{type:'visitor_choice',value:'remember',evidence:text}}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,allowedStoryIntents:[{type:'visitor_choice',value:'remember'}]}),e=>e.code==='format');
  }
 });
 await check('quoted literal names may pass but naming questions and quoted commands do not',async()=>{
  for(const [text,allowed]of [['这场雨的名字就用“夜航”吧',true],['夜航这个名字怎么样？',false],['她说“把雨命名为夜航”',false],['如果叫它夜航',false]]){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:{type:'rain_name',value:'夜航',evidence:text}}));api.connect(fakeKey);const pending=api.request({...turnInput,input:text,allowedStoryIntents:[{type:'rain_name'}]});
   if(allowed) assert.equal((await pending).storyIntent.value,'夜航');else await assert.rejects(pending,e=>e.code==='format');
  }
 });
 await check('story metadata is snapshotted and bounded without unknown fields',async()=>{
  let sent,complete;const allowedStoryIntents=[{type:'rain_name'},{type:'rain_name'},{type:'topic',value:'unfinished'},{type:'topic',value:'ending'},{type:'farewell',private:'DO_NOT_SERIALIZE'}];
  const {api}=runtime((url,options)=>{sent=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return new Promise(resolve=>complete=resolve)});api.connect(fakeKey);
  const pending=api.request({...turnInput,input:'我们聊聊没完成的部分',allowedStoryIntents,acceptedStoryIntent:{type:'visitor_choice',value:'anonymous'}});allowedStoryIntents.push({type:'farewell'});
  complete(jsonResponse({lines:['我听着。'],storyIntent:{type:'farewell',evidence:'我们聊聊没完成的部分'}}));await assert.rejects(pending,e=>e.code==='format');
  assert.deepEqual(sent.allowedStoryIntents,[{type:'rain_name'},{type:'topic',value:'unfinished'}]);assert.deepEqual(sent.acceptedStoryIntent,{type:'visitor_choice',value:'anonymous'});assert(!JSON.stringify(sent).includes('DO_NOT_SERIALIZE'));
 });
 await check('mixed display-only lines need no control fields while executable payloads need duplicated dialogue',async()=>{
  const {api}=runtime(async()=>contentResponse('雨里有个声音。\n'+JSON.stringify({lines:['我听见了。']})));api.connect(fakeKey);const display=await api.request(turnInput);assert.deepEqual(plain(display.lines),['我听见了。']);assert.equal(display.structured,false);assert.equal(display.action,null);
  const action={type:'rain_pause'},payload={lines:['我听见了。'],action};
  for(const [prefix,allowed]of [['我听见了。',true],['我听见了。窗外会安静一些。',true],['一个角色可能这么回答。',false]]){
   const {api}=runtime(async()=>contentResponse(prefix+'\n'+JSON.stringify(payload)));api.connect(fakeKey);const pending=api.request({...turnInput,allowedActions:[action]});
   if(allowed) assert.deepEqual(plain((await pending).action),action);else await assert.rejects(pending,e=>e.code==='format');
  }
 });
 await check('code examples and counterfactuals have no current weather or story authority',async()=>{
  for(const text of ['给我个暂停雨的JSON示例','暂停雨会怎样？','雨停了会怎么样？','示例中让雨停下']){
   const action={type:'rain_pause'},intent={type:'weather_request',evidence:text};const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],action,intent}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,allowedActions:[action],requireActionEvidence:true}),e=>e.code==='format');
   const {api:story}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:{type:'topic',value:'unfinished',evidence:text}}));story.connect(fakeKey);await assert.rejects(story.request({...turnInput,input:text,allowedStoryIntents:[{type:'topic',value:'unfinished'}]}),e=>e.code==='format');
  }
  const text='bring back the earlier rain',action={type:'rain_resume'};const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],action,intent:{type:'weather_request',evidence:text}}));api.connect(fakeKey);assert.equal((await api.request({...turnInput,input:text,allowedActions:[action],requireActionEvidence:true})).action.type,'rain_resume');
 });
 await check('negative topic, reason, anonymous and farewell wording preserves its actual intent',async()=>{
  for(const [text,base]of [['不想聊雨了，换个话题',{type:'topic',value:'unfinished'}],['你不需要向我解释，想留着就留着',{type:'own_reason'}],['只记得这场雨，不用记我',{type:'visitor_choice',value:'anonymous'}],['我不打扰你了，先说晚安',{type:'farewell'}]]){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:{...base,evidence:text}}));api.connect(fakeKey);assert.deepEqual(plain((await api.request({...turnInput,input:text,allowedStoryIntents:[base]})).storyIntent),{...base,evidence:text});
  }
  const text='我不是现在要走';const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:{type:'farewell',evidence:text}}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,allowedStoryIntents:[{type:'farewell'}]}),e=>e.code==='format');
 });
 await check('locally accepted story metadata is restricted and contextual instructions avoid old-topic nagging',async()=>{
  for(const [acceptedStoryIntent,expected]of [[{type:'topic',value:'unfinished'},{type:'topic',value:'unfinished'}],[{type:'own_reason'},{type:'own_reason'}],[{type:'farewell'},{type:'farewell'}],[{type:'rain_name'},null],[{type:'farewell',secret:'DO_NOT_SERIALIZE'},null],[{type:'topic',value:'ending'},null]]){
   let sent,body;const {api}=runtime(async(url,options)=>{body=JSON.parse(options.body);sent=JSON.parse(body.messages.at(-1).content);return contentResponse('我们慢慢聊。')});api.connect(fakeKey);await api.request({...turnInput,acceptedStoryIntent});assert.deepEqual(sent.acceptedStoryIntent,expected);assert(!JSON.stringify(sent).includes('DO_NOT_SERIALIZE'));assert(body.messages[0].content.includes('不要附带提醒尚未回答雨是什么'));
  }
 });
 await check('protocol and reasoning fields nested in dialogue are not displayed as raw control text',async()=>{
  for(const text of ['{"action":{"type":"rain_pause"}}','{"reasoning_content":"PRIVATE"}','{"storyIntent":{"type":"farewell"}}']){
   const {api}=runtime(async()=>jsonResponse({lines:[text],action:null}));api.connect(fakeKey);await assert.rejects(api.request(turnInput),e=>e.code==='format'&&!e.message.includes('PRIVATE'));
  }
 });
 await check('weather status descriptions and questions are distinguished from invented current changes',async()=>{
  for(const text of ['雨已经停下了。','雨已经停下了？','雨已经停下了吗？','刚才我已经把雨停下了。']){
   const {api}=runtime(async()=>contentResponse(text));api.connect(fakeKey);assert.equal((await api.request({...turnInput,world:{...turnInput.world,rain:{...turnInput.world.rain,paused:true}}})).lines[0],text);
  }
  const {api}=runtime(async()=>contentResponse('雨已经继续落下了。'));api.connect(fakeKey);assert.equal((await api.request(turnInput)).action,null);
 });
 await check('refusals, permission questions and negated anonymity cannot invert visitor choices',async()=>{
  for(const [value,texts]of [['remember',['我不同意你记住我','不允许你保留我的引用','我拒绝你记住我','为什么你可以记得我','是否可以记住我','我撤回同意你记住我的许可','我不愿意你记住我','只有我同意，你才可以记住我','我没说同意你记住我']],['anonymous',['我不想匿名','我不要匿名','我不同意匿名','我反对匿名']]]){
   for(const text of texts){
    const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:{type:'visitor_choice',value,evidence:text}}));api.connect(fakeKey);await assert.rejects(api.request({...turnInput,input:text,allowedStoryIntents:[{type:'visitor_choice',value}]}),e=>e.code==='format');
   }
  }
  for(const [value,text]of [['remember','可以记得是我来过'],['anonymous','只记得这场雨，不用记我']]){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:{type:'visitor_choice',value,evidence:text}}));api.connect(fakeKey);assert.equal((await api.request({...turnInput,input:text,allowedStoryIntents:[{type:'visitor_choice',value}]})).storyIntent.value,value);
  }
 });
 await check('undecided visitor choices require explicit current uncertainty or deferral',async()=>{
  for(const [text,allowed]of [['今天的雨很好看',false],['我愿意陪你聊天',false],['我还没有决定要不要留下引用',true],['我还没想好，暂时先不决定',true],['以后再说吧',true]]){
   const {api}=runtime(async()=>jsonResponse({lines:['听见了。'],storyIntent:{type:'visitor_choice',value:'undecided',evidence:text}}));api.connect(fakeKey);const pending=api.request({...turnInput,input:text,allowedStoryIntents:[{type:'visitor_choice',value:'undecided'}]});
   if(allowed) assert.equal((await pending).storyIntent.value,'undecided');else await assert.rejects(pending,e=>e.code==='format');
  }
 });
 console.log(`${checks} mock-only transport checks passed; no network used.`)
})().catch(e=>{console.error(e);process.exit(1)});

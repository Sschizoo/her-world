'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const R=require('../framework/runtime.js'),P=require('../framework/packs.js'),M=require('../framework/model.js');
const fixture=require('./fixtures/framework-intent-surrogate.json');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const size=o=>({w:Math.max(...o.glyphs.split('\n').map(row=>row.length))*o.scale,h:o.glyphs.split('\n').length*o.scale});
function separate(objects){for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){const a=objects[i],b=objects[j],x=size(a),y=size(b);assert.equal(a.x<b.x+y.w&&a.x+x.w>b.x&&a.y<b.y+y.h&&a.y+x.h>b.y,false);}}
test('seven independently attested current v4 turns preserve intention, geometry, sources and sentence timing',async()=>{
  assert.equal(fixture.records.length,7);assert.equal(fixture.modelProtocol,'her-world-turn-v4');
  let state=R.create(P.get(fixture.pack)),originalPreference,smallId;
  for(const [index,record]of fixture.records.entries()){
    const request=M.buildRequest(R.context(state),record.input);
    assert.equal(sha(JSON.stringify(request)),record.requestSha256);
    assert.equal(sha(JSON.stringify(request,null,2)),record.requestFileSha256);
    assert.equal(sha(record.raw),record.sha256);
    assert.deepEqual(record.responderReceipt,{requestFileSha256:record.requestFileSha256,responseSha256:record.sha256});
    assert(!Number.isNaN(Date.parse(record.capturedAt)));
    const raw=JSON.parse(record.raw);assert.equal(raw.schema,'her-world-turn-v4');
    const adapter=M.create({fetch:async()=>new Response(JSON.stringify({choices:[{message:{content:record.raw},finish_reason:'stop'}]}),{status:200})});
    adapter.connect('DUMMY_ATTESTED_SURROGATE_ONLY');
    const canonical=await adapter.request({context:R.context(state),input:record.input});adapter.disconnect();
    const before=state,result=R.commitModel(state,R.propose(state,{text:record.input}),canonical);assert(result.ok,JSON.stringify(result.error));state=result.state;
    assert.deepEqual(R.restore(R.serialize(state),state.pack).state,state);
    result.frames.forEach(frame=>separate(frame.world.objects));
    if(index<6){assert.equal(state.world.weather.paused,true);assert.equal(state.world.weather.intensity,0);assert.deepEqual(state.story.completed,[]);}
    if(index===0){assert.equal(state.memories.length,1);assert.equal(state.memories[0].perspective,'player_report');assert.match(state.memories[0].body,/风声/);originalPreference=state.memories[0].source;assert(state.story.deferred.includes('q_rain'));}
    if(index===1){assert.equal(state.world.objects.length,2);const [a,b]=state.world.objects,x=size(a),y=size(b);assert.notEqual(x.w*x.h,y.w*y.h);smallId=x.w*x.h<y.w*y.h?a.id:b.id;}
    if(index===2){assert.equal(state.memories.length,1);assert.equal(state.memories[0].currentRevision.number,2);assert.deepEqual(state.memories[0].source,originalPreference);assert.match(state.memories[0].body,/雨落在叶子/);assert.deepEqual(state.world,before.world);}
    if(index===3){assert.equal(state.world.objects.length,2);assert(state.world.objects.find(o=>o.id===smallId).x>before.world.objects.find(o=>o.id===smallId).x);for(const o of before.world.objects.filter(o=>o.id!==smallId))assert.deepEqual(state.world.objects.find(n=>n.id===o.id),o);}
    if(index===4){assert.equal(state.world.objects.length,3);const a=size(before.world.objects.find(o=>o.id===smallId)),b=size(state.world.objects.find(o=>o.id===smallId));assert(b.w*b.h>a.w*a.h);}
    if(index===5){assert.deepEqual(state.world,before.world);assert.equal(raw.requestedChanges.length,0);}
    if(index===6){assert.deepEqual(state.story.completed,['describe']);assert.equal(state.world.weather.paused,false);assert.equal(state.world.weather.intensity,1);assert.equal(state.world.objects.length,3);const at=canonical.beats.find(b=>b.operations.some(op=>op.type==='weather.set')).afterLine;result.frames.forEach((frame,line)=>assert.equal(frame.world.weather.paused,line<at));}
  }
});

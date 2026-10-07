'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const R=require('../framework/runtime.js'),P=require('../framework/packs.js'),M=require('../framework/model.js');
const fixture=require('./fixtures/framework-report-surrogate.json');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
test('four independent current responses use quoted sources, separate clouds and explicit memory revisions',async()=>{
  let state=R.create(P.get(fixture.pack));let firstSource;
  assert.equal(fixture.records.length,4);assert.equal(fixture.modelProtocol,'her-world-turn-v3');
  for(const [index,record] of fixture.records.entries()){
    assert.equal(sha(record.raw),record.sha256);
    assert.equal(sha(JSON.stringify(M.buildRequest(R.context(state),record.input))),record.requestSha256);
    const adapter=M.create({fetch:async()=>new Response(JSON.stringify({choices:[{message:{content:record.raw},finish_reason:'stop'}]}),{status:200})});
    adapter.connect('DUMMY_REPORT_SURROGATE_ONLY');
    const plan=await adapter.request({context:R.context(state),input:record.input});adapter.disconnect();
    const result=R.commitModel(state,R.propose(state,{text:record.input}),plan);assert(result.ok,JSON.stringify(result.error));state=result.state;
    assert.deepEqual(R.restore(R.serialize(state),P.get(fixture.pack)).state,state);
    if(index===0){
      assert.equal(result.frames[0].memories.length,0);assert.equal(result.frames[1].memories.length,1);
      assert.equal(state.memories[0].body,'我更喜欢风声，听着会让我安静下来。');
      assert.equal(state.memories[0].perspective,'player_report');firstSource=state.memories[0].source;
      assert.deepEqual(state.story.completed,[]);assert(state.story.deferred.includes('q_rain'));
    }
    if(index===1){
      assert.equal(state.memories.length,1);assert.equal(state.world.objects.length,2);assert.deepEqual(state.story.completed,[]);
      const [a,b]=state.world.objects,dim=o=>({w:Math.max(...o.glyphs.split('\n').map(row=>row.length))*o.scale,h:o.glyphs.split('\n').length*o.scale}),x=dim(a),y=dim(b);
      assert.notEqual(a.scale,b.scale);assert.equal(a.x<b.x+y.w&&a.x+x.w>b.x&&a.y<b.y+y.h&&a.y+x.h>b.y,false);
      for(const o of state.world.objects){assert.equal(o.source.createdBy,record.input);assert(o.y>=state.world.landmarks.sky.y);assert(o.y+dim(o).h<=state.world.landmarks.sky.y+state.world.landmarks.sky.height);}
    }
    if(index===2){assert.deepEqual(state.story.completed,['describe']);assert.equal(result.frames[0].world.weather.intensity,0);assert.equal(result.frames[1].world.weather.intensity,1);assert.equal(state.memories.length,2);}
    if(index===3){
      assert.equal(state.memories.length,2);const preference=state.memories.find(note=>note.kind==='preference');
      assert.equal(preference.currentRevision.number,2);assert.deepEqual(preference.source,firstSource);
      assert.equal(preference.currentRevision.text,record.input);assert.match(preference.body,/更喜欢雨落在叶子上的声音/);
      assert.deepEqual(state.story.completed,['describe']);assert.equal(state.world.objects.length,2);
    }
  }
});

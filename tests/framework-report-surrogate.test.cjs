'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../framework/runtime.js'),P=require('../framework/packs.js');
const {historicalCanonicalTurn,assertCurrentModelBoundary}=require('./fixtures/historical-turn.cjs');
const fixture=require('./fixtures/framework-report-surrogate.json');
test('four historical v0.1.7 canonical plans preserve quoted sources, placement, revisions and replay; current model physical proposals fail closed',async()=>{
  let state=R.create(P.get(fixture.pack));let firstSource;
  assert.equal(fixture.records.length,4);assert.equal(fixture.modelProtocol,'her-world-turn-v3');
  for(const [index,record] of fixture.records.entries()){
    const plan=historicalCanonicalTurn(record,fixture.rulesVersion);
    await assertCurrentModelBoundary(record,R.context(state),plan);
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

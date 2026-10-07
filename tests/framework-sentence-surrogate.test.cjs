'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../framework/runtime.js'),P=require('../framework/packs.js');
const {historicalCanonicalTurn,assertCurrentModelBoundary}=require('./fixtures/historical-turn.cjs');
const fixture=require('./fixtures/framework-sentence-surrogate.json');
test('three historical v0.1.6 canonical plans preserve sources, frames and saves; current model physical proposals fail closed',async()=>{
  let state=R.create(P.get(fixture.pack));assert.equal(fixture.modelProtocol,'her-world-turn-v3');assert.equal(fixture.records.length,3);
  for(const [index,record] of fixture.records.entries()){
    const proposed=historicalCanonicalTurn(record,fixture.rulesVersion);
    const original=JSON.parse(record.raw);assert.equal(original.schema,'her-world-turn-v3');assert(!Object.hasOwn(original,'beats'));
    await assertCurrentModelBoundary(record,R.context(state),proposed);assert.equal(proposed.schema,'her-world-turn-v2');
    const result=R.commit(state,R.propose(state,{text:record.input}),proposed);assert.equal(result.ok,true,JSON.stringify(result.error));state=result.state;
    assert.deepEqual(R.restore(R.serialize(state),P.get(fixture.pack)).state,state);
    assert(state.events.filter(event=>event.type==='turn').every(event=>event.plan.schema==='her-world-turn-v2'));
    if(index===0){assert.equal(state.memories.length,1);assert.equal(result.frames[0].memories.length,0);assert.equal(result.frames[1].memories.length,1);assert.deepEqual(state.story.completed,[]);}
    if(index===1){
      assert.deepEqual(result.frames.map(frame=>frame.world.objects.length),[1,2]);assert.deepEqual(state.story.completed,[]);
      const [a,b]=state.world.objects,dim=o=>({w:Math.max(...o.glyphs.split('\n').map(row=>row.length))*o.scale,h:o.glyphs.split('\n').length*o.scale}),x=dim(a),y=dim(b);
      assert.equal(a.x<b.x+y.w&&a.x+x.w>b.x&&a.y<b.y+y.h&&a.y+x.h>b.y,false);assert.notEqual(a.scale,b.scale);
      for(const object of state.world.objects){assert.equal(object.source.createdBy,record.input);assert(object.y>=state.world.landmarks.sky.y);assert(object.y+dim(object).h<=state.world.landmarks.sky.y+state.world.landmarks.sky.height);}
    }
    if(index===2){assert.deepEqual(state.story.completed,['describe']);assert.equal(result.frames[0].world.weather.intensity,0);assert.equal(result.frames[1].world.weather.intensity,1);assert.equal(state.world.weather.paused,false);assert.equal(state.world.objects.length,2);assert(state.memories.some(note=>note.kind==='concept'));}
  }
});

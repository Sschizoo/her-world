'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../framework/runtime.js'),P=require('../framework/packs.js'),M=require('../framework/model.js'),C=require('../framework/capabilities.js');
const archived=require('./fixtures/framework-v017-dense-save.json');
test('near-capacity accepted v0.1.7 archive remains readable and can request removal with new reference schemas',()=>{
  const before=JSON.stringify(archived),restored=R.restore(archived,P.get('rain-lab'));assert(restored.ok,JSON.stringify(restored.error));
  const state=restored.state,context=R.context(state),input='忘记第一条记录。';
  assert.equal(state.memories.length,14);assert.equal(state.world.objects.length,1);
  assert.deepEqual(state.events,archived.events);assert.equal(JSON.stringify(archived),before);
  assert(C.requestContextBytes(context)<=R.constants.MAX_CONTEXT_BYTES);
  assert(Buffer.byteLength(JSON.stringify(M.buildRequest(context,input)))<=131072);
  const result=R.commitModel(state,R.propose(state,{text:input}),{schema:'her-world-turn-v2',lines:['移除第一条记录。'],beats:[{afterLine:0,operations:[{type:'memory.remove',id:context.memories[0].id}]}],topic:null});
  assert(result.ok,JSON.stringify(result.error));assert.equal(result.state.memories.length,13);
  assert.deepEqual(result.state.world,state.world);
  assert(Buffer.byteLength(JSON.stringify(M.buildRequest(R.context(result.state),'你好')))<131072);
  assert.deepEqual(R.restore(R.serialize(result.state),state.pack).state,result.state);
});

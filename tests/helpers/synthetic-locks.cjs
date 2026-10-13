/* Deterministic cooperative LockManager substitute, never a real browser API. */
module.exports=function syntheticLocks(){
  let held=false;const pending=[],active=new Set(),calls=[];
  function drain(){if(held)return;for(const entry of [...pending]){if(entry.cancelled||active.has(entry.name))continue;pending.splice(pending.indexOf(entry),1);entry.granted=true;active.add(entry.name);Promise.resolve().then(()=>entry.callback({name:entry.name,mode:entry.options.mode})).then(entry.resolve,entry.reject).finally(()=>{active.delete(entry.name);drain();});}}
  return {calls,hold(){held=true;},release(){held=false;drain();},request(name,options,callback){calls.push({name,options});return new Promise((resolve,reject)=>{const entry={name,options,callback,resolve,reject,granted:false,cancelled:false};const abort=()=>{if(entry.granted)return;entry.cancelled=true;const index=pending.indexOf(entry);if(index>=0)pending.splice(index,1);const error=Error('cancelled');error.name='AbortError';reject(error);};if(options.signal?.aborted){abort();return;}options.signal?.addEventListener('abort',abort,{once:true});pending.push(entry);queueMicrotask(drain);});}};
};

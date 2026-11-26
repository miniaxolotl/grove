import assert from 'node:assert/strict';
import test from 'node:test';
import {retireHeldControls} from './held-retirement.mjs';
import {receiptHash} from './held-state.mjs';
function fixture(){
  const identity={source:'a'.repeat(40),digest:'sha256:'+'b'.repeat(64)},approval='c'.repeat(64),control={key:'GROVE_RELEASE_APPROVAL',scope:'RUN_TIME',value:JSON.stringify({schema:1,identity,approval})};
  const component=name=>({name,instance_count:1,image:{digest:identity.digest},envs:[{key:'PRIVATE',value:'retained',type:'SECRET'},control]});
  const spec={name:'grove',services:[{...component('api'),health_check:{http_path:'/health/ready'}}],workers:[component('worker')]};
  const app={id:'app',spec,active_deployment:{id:'generation',phase:'ACTIVE',spec}};
  const next=globalThis.structuredClone(spec);for(const c of [...next.services,...next.workers])c.image.digest='sha256:'+'d'.repeat(64);
  const evidence={release:receiptHash(identity),receipt:'e'.repeat(64),generation:'1',customers:0,remoteVerified:0,pending:0,uncertain:0,caughtUp:true,authorityHash:'f'.repeat(64),remoteHash:'1'.repeat(64),control:{phase:'public',approvalHash:approval,publicHash:'2'.repeat(64)}};
  const io={getInstances:async()=>[{component_name:'api',instance_name:'api-one'},{component_name:'worker',instance_name:'worker-one'}],probe:async scope=>({status:'runtime_verified',role:scope.component,schema:'verified',challenge:scope.challenge,identity,approval,evidence}),ready:async()=>({status:'ready'})};
  return {app,next,io,evidence};
}
test('ordinary successor strips only obsolete controls after two current public proofs, preserving history and secrets',async()=>{
  const {app,next,io}=fixture(),before=globalThis.structuredClone(app);
  const result=await retireHeldControls(app,next,io);
  assert.deepEqual(app,before);for(const c of [...result.services,...result.workers])assert.deepEqual(c.envs,[{key:'PRIVATE',value:'retained',type:'SECRET'}]);
  assert.equal(app.spec.services[0].envs.length,2);
});
test('held, unreconciled, foreign, partial or non-public runtime cannot retire controls',async()=>{
  for(const phase of ['reconcile','handoff','released']){const {app,next,io,evidence}=fixture();evidence.control.phase=phase;await assert.rejects(retireHeldControls(app,next,io));}
  const {app,next,io}=fixture();
  await assert.rejects(retireHeldControls(app,app.spec,io));
  await assert.rejects(retireHeldControls(app,next,{...io,ready:async()=>({status:'release_held'})}));
  await assert.rejects(retireHeldControls({...app,pending_deployment:{id:'pending'}},next,io));
  await assert.rejects(retireHeldControls(app,next,{...io,getInstances:async()=>[{component_name:'api',instance_name:'api-one'}]}));
  await assert.rejects(retireHeldControls(app,next,{...io,probe:async scope=>({...await io.probe(scope),identity:{source:'other'}})}));
});

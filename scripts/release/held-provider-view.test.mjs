import assert from 'node:assert/strict';
import test from 'node:test';
import {heldProviderView,heldReleaseSpecView} from './held-provider-view.mjs';
test('explicit semantic view is bounded to maintenance and release-control defaults, preserving raw objects',()=>{
  const spec={name:'grove',maintenance:{enabled:true},services:[{envs:[{key:'PRIVATE',type:'SECRET',value:'retained'},{key:'GROVE_RELEASE_HOLD',scope:'RUN_TIME',value:'identity'}]}]};
  const raw={spec,active_deployment:{spec}},before=globalThis.structuredClone(raw);
  const view=heldProviderView(raw);
  assert.deepEqual(raw,before);assert.equal(view.app.spec.maintenance.archive,false);
  assert.equal(view.app.spec.services[0].envs[1].type,'GENERAL');assert.equal(view.app.spec.services[0].envs[0].type,'SECRET');
  assert.equal(view.changes.length,4);
  for(const maintenance of [null,[],true,{archive:null},{enabled:'false'}])assert.throws(()=>heldReleaseSpecView({...spec,maintenance}));
  assert.throws(()=>heldReleaseSpecView({...spec,services:[{envs:[{key:'GROVE_RELEASE_HOLD',scope:'RUN_TIME',type:'SECRET'}]}]}));
});

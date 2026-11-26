// Explicit ordinary-image successor only. Never remove controls from a running
// held image separately; require both current public-runtime proofs first.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {receiptHash,validateLifecycleEvidence} from './held-state.mjs';
import {validateCompleteInstanceInventory} from './held-instance-inventory.mjs';
const controls=['GROVE_RELEASE_HOLD','GROVE_RELEASE_RECONCILE','GROVE_RELEASE_APPROVAL'];
export async function retireHeldControls(app,proposed,io){
  assert(!app.pending_deployment&&!app.in_progress_deployment);
  assert.equal(app.active_deployment?.phase,'ACTIVE');assert(isDeepStrictEqual(app.spec,app.active_deployment.spec));
  assert.equal(app.spec.services?.length,1);assert.equal(app.spec.workers?.length,1);
  assert(app.spec.maintenance===undefined||(app.spec.maintenance&&Object.getPrototypeOf(app.spec.maintenance)===Object.prototype));
  for(const key of ['enabled','archive'])assert(app.spec.maintenance?.[key]===undefined||app.spec.maintenance[key]===false);
  assert.equal(app.spec.services[0].health_check?.http_path,'/health/ready');
  const instances=validateCompleteInstanceInventory({instances:await io.getInstances()});
  assert.deepEqual(instances.map(i=>i.component_name).sort(),['api','worker']);
  let value,evidence;
  for(const [component,name] of [[app.spec.services[0],'api'],[app.spec.workers[0],'worker']]){
    assert.equal(component.name,name);assert.equal(component.instance_count,1);assert(!component.autoscaling);
    const entries=(component.envs??[]).filter(e=>controls.includes(e.key));assert.equal(entries.length,1);
    const entry=entries[0];assert.equal(entry.key,'GROVE_RELEASE_APPROVAL');assert.equal(entry.scope,'RUN_TIME');assert(entry.type===undefined||entry.type==='GENERAL');
    const current=JSON.parse(entry.value);assert.equal(current.schema,1);assert.match(current.approval??'',/^[a-f0-9]{64}$/);
    assert.match(current.identity?.source??'',/^[a-f0-9]{40}$/);assert.equal(current.identity.digest,component.image.digest);
    if(value)assert.deepEqual(current,value);else value=current;
    assert.notEqual(proposed[name==='api'?'services':'workers'][0].image.digest,current.identity.digest);
    const instance=instances.find(i=>i.component_name===name),challenge=randomBytes(32).toString('hex');
    const proof=await io.probe({app:app.id,deployment:app.active_deployment.id,component:name,instance:instance.instance_name,challenge,mode:'runtime',source:current.identity.source});
    assert.equal(proof.status,'runtime_verified');assert.equal(proof.role,name);assert.equal(proof.schema,'verified');assert.equal(proof.challenge,challenge);
    assert.deepEqual(proof.identity,current.identity);assert.equal(proof.approval,current.approval);
    validateLifecycleEvidence(proof.evidence);assert.equal(proof.evidence.control.phase,'public');assert.equal(proof.evidence.control.approvalHash,current.approval);assert.match(proof.evidence.control.publicHash??'',/^[a-f0-9]{64}$/);
    assert.equal(proof.evidence.release,receiptHash(current.identity));
    if(evidence)assert.deepEqual(proof.evidence,evidence);else evidence=proof.evidence;
  }
  for(const entry of app.spec.envs??[])if(controls.includes(entry.key)){
    assert.equal(entry.key,'GROVE_RELEASE_APPROVAL');assert.equal(entry.scope,'RUN_TIME');assert(entry.type===undefined||entry.type==='GENERAL');assert.deepEqual(JSON.parse(entry.value),value);
  }
  assert.equal((await io.ready()).status,'ready');
  const spec=globalThis.structuredClone(proposed);
  for(const object of [spec,...spec.services,...spec.workers])if(object.envs)object.envs=object.envs.filter(e=>!controls.includes(e.key));
  return spec;
}

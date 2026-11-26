// Explicit operator-only representation, never a replacement for raw evidence or
// a global fingerprint change. Only release-control defaults may be supplied.
import assert from 'node:assert/strict';
const keys=['GROVE_RELEASE_HOLD','GROVE_RELEASE_RECONCILE','GROVE_RELEASE_APPROVAL'];
export function heldReleaseSpecView(raw,path='/spec',changes=[]){
  const spec=globalThis.structuredClone(raw);
  assert(spec&&typeof spec==='object'&&!Array.isArray(spec));
  assert(spec.maintenance===undefined||(spec.maintenance&&Object.getPrototypeOf(spec.maintenance)===Object.prototype));
  if(spec.maintenance===undefined)spec.maintenance={};
  for(const key of ['archive','enabled']){
    assert(spec.maintenance[key]===undefined||typeof spec.maintenance[key]==='boolean');
    if(spec.maintenance[key]===undefined){spec.maintenance[key]=false;changes.push(path+'/maintenance/'+key);}
  }
  for(const kind of ['services','workers'])for(const [c,component] of (spec[kind]??[]).entries())
    for(const [e,entry] of (component.envs??[]).entries())if(keys.includes(entry.key)){
      assert.equal(entry.scope,'RUN_TIME');
      assert(entry.type===undefined||entry.type==='GENERAL');
      if(entry.type===undefined){entry.type='GENERAL';changes.push(`${path}/${kind}/${c}/envs/${e}/type`);}
    }
  return spec;
}
export function heldProviderView(raw){
  const app=globalThis.structuredClone(raw),changes=[];
  app.spec=heldReleaseSpecView(raw.spec,'/spec',changes);
  app.active_deployment.spec=heldReleaseSpecView(raw.active_deployment.spec,'/active_deployment/spec',changes);
  return {app,changes};
}

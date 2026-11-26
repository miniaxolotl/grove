import assert from 'node:assert/strict';
import test from 'node:test';
import {publication,recordHeld,assertHeldRecorderActors} from './held-state.mjs';
import * as artifacts from './held-artifacts.mjs';
const now=Date.parse('2026-11-25T12:00:00Z');
const base={repository:'miniaxolotl/grove',actor:'miniaxolotl',protected:true,source:'a'.repeat(40),production:'b'.repeat(40),tree:'c'.repeat(40),tag:'v1.11.34',apiVersion:'1.11.34',run:1,attempt:1};
const tooling={source:'d'.repeat(40),production:'e'.repeat(40),tree:'f'.repeat(40),tag:'v1.11.35',workflow:'.github/workflows/held-release-operator.yml'};
test('non-owner triggering actor cannot rerun an owner-authored recorder',()=>{
  assert.doesNotThrow(()=>assertHeldRecorderActors('miniaxolotl','miniaxolotl'));
  for(const [actor,trigger] of [['miniaxolotl','another-user'],['another-user','miniaxolotl'],['miniaxolotl',undefined]])assert.throws(()=>assertHeldRecorderActors(actor,trigger));
});
test('operational receipts preserve original release and bind real separate production tooling',()=>{
  const p=publication(base,'sha256:'+'1'.repeat(64),now);
  const snapshot={fingerprint:'2'.repeat(64),generation:'generation',instances:[{component:'api',name:'api-one'},{component:'worker',name:'worker-one'}],proofs:[{component:'api',name:'api-one',challenge:'3'.repeat(64),response:'4'.repeat(64)},{component:'worker',name:'worker-one',challenge:'5'.repeat(64),response:'6'.repeat(64)}],observedAt:new Date(now).toISOString()};
  const r=recordHeld(p,snapshot,{...base,run:2,tooling},now);
  assert.deepEqual(r.release,p.release);assert.deepEqual(r.operator,{run:2,attempt:1,actor:'miniaxolotl',tooling});
  assert.throws(()=>recordHeld(p,snapshot,{...base,tooling:{...tooling,workflow:'.github/workflows/deploy.yml'}},now));
});
test('receipt reader authenticates separate tooling runs without rebinding original publication',()=>{
  assert.equal(typeof artifacts.assertHeldWorkflowRun,'function');
  const run={id:2,run_attempt:1,head_sha:tooling.production,head_branch:'production',path:tooling.workflow};
  assert.equal(artifacts.assertHeldWorkflowRun(run,{runId:2,attempt:1,published:false,context:{...base,tooling}}),true);
  for(const patch of [{head_branch:'development'},{head_sha:base.production},{path:'.github/workflows/deploy.yml'}])
    assert.throws(()=>artifacts.assertHeldWorkflowRun({...run,...patch},{runId:2,attempt:1,published:false,context:{...base,tooling}}));
  assert.throws(()=>artifacts.assertHeldWorkflowRun(run,{runId:2,attempt:1,published:false,context:base}));
  assert.throws(()=>artifacts.assertHeldWorkflowRun(run,{runId:2,attempt:1,published:true,context:{...base,tooling}}));
});

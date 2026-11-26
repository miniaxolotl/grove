import assert from 'node:assert/strict';
import test from 'node:test';
import {publication,recordHeld,assertHeldRecorderActors} from './held-state.mjs';
import * as artifacts from './held-artifacts.mjs';
import {readFileSync} from 'node:fs';
import * as state from './held-state.mjs';
test('operational recorder uses the existing verified pnpm setup action pin',()=>{
  const pin='pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413';
  assert(readFileSync('.github/workflows/deploy.yml','utf8').includes(pin));
  assert(readFileSync('.github/workflows/held-release-operator.yml','utf8').includes(pin));
});
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
function approvedFixture(){
  const p=state.publication(base,'sha256:'+'1'.repeat(64),now);
  const snapshot={fingerprint:'2'.repeat(64),generation:'generation',instances:[{component:'api',name:'api-one'},{component:'worker',name:'worker-one'}],proofs:[{component:'api',name:'api-one',challenge:'3'.repeat(64),response:'4'.repeat(64)},{component:'worker',name:'worker-one',challenge:'5'.repeat(64),response:'6'.repeat(64)}],observedAt:new Date(now).toISOString()};
  const context={...base,tooling},held=state.recordHeld(p,snapshot,context,now);
  const lifecycle={release:'1'.repeat(64),receipt:state.receiptHash(held),generation:'1',customers:1,remoteVerified:1,pending:0,uncertain:0,caughtUp:true,authorityHash:'2'.repeat(64),remoteHash:'3'.repeat(64),control:{phase:'reconcile',approvalHash:null,publicHash:null}};
  const reconciled=state.recordLifecycle(p,held,{...snapshot,ingress:true,lifecycle},context,now);
  const approval=state.approve(p,reconciled,{held:state.receiptHash(reconciled),authority:lifecycle.authorityHash,providers:lifecycle.remoteHash,pending:0,uncertain:0,reconciledAt:new Date(now).toISOString(),approved:true,command:'4'.repeat(64)},context,now,({source,held,authority,providers})=>({source,held,authority,providers,manifest:'9'.repeat(64),contract:'qualified-lifecycle-and-remote-reconciliation'}));
  return{p,snapshot,lifecycle,approval,context};
}
test('operational runtime and public observations retain immutable old parents but require fresh actual proofs',()=>{
  const {p,snapshot,lifecycle,approval,context}=approvedFixture(),at=now+600001;
  const evidence={...snapshot,observedAt:new Date(at).toISOString(),ingress:true,lifecycle:{...lifecycle,control:{phase:'released',approvalHash:'4'.repeat(64),publicHash:null}}};
  const runtime=state.advance(p,approval,'runtime_verified',context,at,evidence);assert.equal(runtime.parent,approval);assert.equal(runtime.parent.at,new Date(now).toISOString());
  assert.throws(()=>state.advance(p,approval,'runtime_verified',context,at,{...evidence,observedAt:new Date(now).toISOString()}));
  assert.throws(()=>state.advance(p,approval,'runtime_verified',base,at,evidence));
  const later=at+600001,publicEvidence={...evidence,observedAt:new Date(later).toISOString(),command:'7'.repeat(64),public:{status:'ready'},lifecycle:{...lifecycle,control:{phase:'public',approvalHash:'4'.repeat(64),publicHash:'7'.repeat(64)}}};
  const opened=state.advance(p,runtime,'public_verified',context,later,publicEvidence);assert.equal(opened.parent,runtime);assert.throws(()=>state.advance(p,runtime,'public_verified',context,later,{...publicEvidence,observedAt:new Date(at).toISOString()}));
});
test('recording time is captured after asynchronous current observation',async()=>{
  assert.equal(typeof state.recordObservation,'function');let tick=now;
  const result=await state.recordObservation(async()=>{tick+=10;return{observedAt:tick};},(evidence,at)=>({evidence,at}),()=>tick);
  assert.equal(result.at,now+10);assert.equal(result.evidence.observedAt,result.at);
});
test('only the exact reviewed v36 ancestry can be read by the v37 operational recovery',()=>{
  assert.equal(typeof artifacts.heldReceiptContext,'function');
  const prior={source:'a55f9e89df2131fdc993fc41bdbe648c8ec8e9d2',production:'e1a7baf8eae1e2874f963416f3d01336db745d06',tree:'345abbcbc6f079ee2fbcbd6096434b3e485b25c1',tag:'v1.11.36',workflow:'.github/workflows/held-release-operator.yml'};
  const current={...base,source:'4cd44cc891fbb4013b4465bde1eced4ebaedbee0',production:'51048850e1895635febf142996390c7c893f8e89',tooling:{...tooling,tag:'v1.11.37'}},run={head_sha:prior.production,path:prior.workflow};
  assert.deepEqual(artifacts.heldReceiptContext(run,'effects_approved',current).tooling,prior);
  for(const [phase,context] of [['runtime_verified',current],['effects_approved',{...current,source:'a'.repeat(40)}],['effects_approved',{...current,tooling:{...tooling,tag:'v1.11.38'}}]])assert.equal(artifacts.heldReceiptContext(run,phase,context),context);
  assert.equal(artifacts.heldReceiptContext({...run,head_sha:'a'.repeat(40)},'effects_approved',current),current);
});
test('public observers validate an executed owner command read-only without extending new write deadlines',()=>{
  const recorder=readFileSync('scripts/release/held-phase.mjs','utf8'),cli=readFileSync('scripts/release/held-operator-cli.mjs','utf8');
  const publicRecorder=recorder.slice(recorder.indexOf('phase === "public"'));
  assert(publicRecorder.includes('validateOperatorCommand(p, parent, command, Date.now(), true)'));
  const publicHealth=cli.slice(cli.indexOf('assert.equal(command.action, "public-health")'));
  assert(/request\.publicCommand,\s*Date\.now\(\),\s*true,/.test(publicHealth));
});

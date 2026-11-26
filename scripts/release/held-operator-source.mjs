// Original release identity remains independently frozen even when the protected
// production operator has advanced. Publication authentication follows in record.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import process from 'node:process';
import {resolveHeldDecision} from './held-delivery.mjs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const source=process.env.HELD_RELEASE_SOURCE,production=process.env.HELD_RELEASE_PRODUCTION;
assert.match(source??'',/^[a-f0-9]{40}$/);assert.match(production??'',/^[a-f0-9]{40}$/);
assert.equal(process.env.GITHUB_REF,'refs/heads/production');assert.equal(process.env.GITHUB_REF_PROTECTED,'true');assert.equal(process.env.GITHUB_ACTOR,'miniaxolotl');
assert.equal(git('rev-parse',`${source}^{tree}`),git('rev-parse',`${production}^{tree}`));
git('merge-base','--is-ancestor',production,process.env.GITHUB_SHA);
const tag='v'+JSON.parse(git('show',`${source}:package.json`)).version;
assert.equal(git('rev-parse',`refs/tags/${tag}^{commit}`),source);assert(resolveHeldDecision(source,true));
assert(process.env.GITHUB_OUTPUT);appendFileSync(process.env.GITHUB_OUTPUT,`tag=${tag}\n`);

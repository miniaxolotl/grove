/// <reference lib="webworker" />
import { createBinaryModuleFromUrl } from 'harper.js';
import { createHarperChecker } from './writing-harper.ts';
import type { HarperRequest, HarperReply } from './writing-client.ts';

export function runHarperWorker(scope:DedicatedWorkerGlobalScope) {
  const location=new URL(scope.location.href);
  let asset=location.searchParams.get('wasm');
  let checker:ReturnType<typeof createHarperChecker>|undefined;
  let previous=Promise.resolve();
  scope.addEventListener('message',({data}:MessageEvent<HarperRequest>)=>{
    if(data.type==='boot') {if(!checker) asset=data.wasm;return;}
    if(data.type!=='check') return;
    previous=previous.then(async()=>{
      try {
        if(!asset) throw new Error('Missing local asset');
        const url=new URL(asset,location);
        if(url.protocol!==location.protocol||url.host!==location.host) throw new Error('Expected bundled asset');
        checker??=createHarperChecker(createBinaryModuleFromUrl(url.href,'slim'));
        const result=await (await checker).check(data.text,data.settings);
        scope.postMessage({id:data.id,result} satisfies HarperReply);
      } catch {scope.postMessage({id:data.id} satisfies HarperReply);}
    });
  });
}
runHarperWorker(self as DedicatedWorkerGlobalScope);

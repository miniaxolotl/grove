import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import { test } from "node:test";
import {createDatabase,migrationSource,probeDatabase} from "@lib/database";
import {reconcileRestore} from "../../scripts/database/reconcile-restore.ts";

test("forward upgrade defaults existing writers off; backup reconciliation cannot resurrect a stale proofing grant", async () => {
  const owner=process.env.TEST_MIGRATION_DATABASE_URL!, runtime=process.env.TEST_DATABASE_URL!;
  for(const url of [owner,runtime]) assert(new URL(url).pathname.endsWith("_test"));
  const authority=createDatabase(owner), names=["source","restore"].map(k=>`proofing_${k}_${randomUUID().replaceAll("-","")}_test`);
  const connect=(url:string,name:string)=>{ const target=new URL(url);target.pathname=`/${name}`;return createDatabase(target.href);};
  const [source,target]=names.map(n=>connect(owner,n)),api=connect(runtime,names[1]);
  try {
    for(const name of names) await authority.raw("CREATE DATABASE ??",[name]);
    await source.migrate.latest();
    const all=await migrationSource.getMigrations([]);
    await target.migrate.latest({migrationSource:{...migrationSource,getMigrations:async()=>all.filter(m=>m.name<"20261118_044_proofing_consent")}});
    const id=randomUUID(); for(const db of [source,target]) await db("accounts").insert({id,clerkSubject:"proofing_fixture"});
    await assert.rejects(probeDatabase(api),/proofing_consents/);
    await target.migrate.latest(); await probeDatabase(api);
    assert.deepEqual(await target("proofing_consents").select(),[]);
    await target("proofing_consents").insert({accountId:id,scope:"grove-note-editor",version:1,automatic:true,generation:randomUUID()});
    await reconcileRestore(source,target);
    assert.deepEqual(await target("proofing_consents").whereNull("revokedAt"),[]);
  } finally {await Promise.all([source.destroy(),target.destroy(),api.destroy()]); for(const n of names) await authority.raw("DROP DATABASE IF EXISTS ??",[n]);await authority.destroy();}
});

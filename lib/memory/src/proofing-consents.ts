import { randomUUID } from "node:crypto";
import type { MemoryService } from "./index.ts";
import { GroveError, type Principal } from "@lib/shared/contracts";
import { proofingScope, proofingVersion, type ProofingConsent } from "@lib/shared/proofing-contract";

export class ProofingConsents {
  constructor(private service:MemoryService) {}

  // access() rechecks account lifecycle and the authoritative session revocation
  // even when this is the second access within one already-admitted request.
  private state(principal:Principal, next?:ProofingConsent) {
    if(principal.type !== "session" || !principal.sessionId) throw new GroveError("forbidden","A signed-in editor session is required",403);
    return this.service.access(principal,next ? "admin" : null, async ({trx,account})=>{
      const key = {accountId:account.id,scope:proofingScope};
      const old = await trx("proofing_consents").where(key).where({version:proofingVersion}).first();
      const enabled = !!old && !old.revokedAt;
      const consent = {enabled, automatic:enabled && old.automatic === true};
      if(!next || (consent.enabled===next.enabled && consent.automatic===next.automatic)) return {consent, generation:enabled ? String(old.generation) : null};
      const generation = randomUUID();
      await trx("proofing_consents").insert({...key,version:proofingVersion,automatic:next.automatic,generation,updatedAt:trx.fn.now(),revokedAt:next.enabled ? null : trx.fn.now()}).onConflict(["accountId","scope"]).merge();
      return { consent:next, generation:next.enabled ? generation : null };
    });
  }
  async settings(principal:Principal, next?:ProofingConsent) {return (await this.state(principal,next)).consent;}
  async grant(principal:Principal, mode:"automatic"|"manual", expected?:string) {
    const {generation,consent} = await this.state(principal);
    if(!generation || (mode === "automatic" && !consent.automatic) || (expected && expected!==generation)) throw new GroveError("proofing_consent_required","Review Enhanced grammar in Writing settings.",403);
    return generation;
  }
}

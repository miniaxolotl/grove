// Existing conservative predicates: expiry never proves remote nonacceptance.
import { need } from "./operator-control.mjs";
export const predicates = {
  jobs: "jobs WHERE failed_at IS NULL AND lease_id IS NOT NULL",
  tasks: "background_tasks WHERE status='running' OR lease_id IS NOT NULL",
  email: "transactional_emails WHERE lease_id IS NOT NULL",
  actions: "action_usage WHERE status='reserved'",
  ai: "ai_operation_leases",
  cache: "ai_cache WHERE value IS NULL",
  chat: "conversation_turns WHERE status='pending'",
  media: "media_objects WHERE status='pending'",
  accept: "conversation_documents WHERE accept_lease IS NOT NULL",
  suggest: "document_import_batches WHERE suggestion_lease IS NOT NULL",
  speech: "speech_slots",
  dispatch:
    "(SELECT dispatch_id FROM jobs WHERE dispatch_id IS NOT NULL UNION ALL SELECT dispatch_id FROM background_tasks WHERE dispatch_id IS NOT NULL UNION ALL SELECT dispatch_id FROM transactional_emails WHERE dispatch_id IS NOT NULL) reservations",
};
const uncertain = {
  writing:
    "writing_requests WHERE status='uncertain' OR (provider_started_at IS NOT NULL AND status IN ('queued','processing','backoff'))",
  email:
    "transactional_emails WHERE sent_at IS NULL AND attempts>0 AND (error_code IS NULL OR error_code='email_unavailable' OR error_code LIKE 'email_http_5%' OR provider_id IS NOT NULL)",
  media:
    "(SELECT 1 FROM media_objects WHERE status='failed' UNION ALL SELECT 1 FROM document_import_files WHERE object_key IS NOT NULL AND NOT original_ready UNION ALL SELECT 1 FROM conversation_documents WHERE object_key IS NOT NULL AND NOT accepted AND removed_at IS NULL) unresolved_originals",
  providerBackoff: "ai_provider_backoff WHERE probing",
};
export async function inspectSafety(query) {
  const counts = async (values) =>
    (
      await query(
        "SELECT " +
          Object.entries(values)
            .map(
              ([k, from]) =>
                `(SELECT count(*)::integer FROM ${from}) AS "${k}"`,
            )
            .join(","),
      )
    ).rows[0];
  const leases = await counts(predicates),
    uncertainty = await counts(uncertain);
  const sessions = (
    await query(
      "SELECT pid,usename AS role,state,xact_start IS NOT NULL AS has_transaction FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' ORDER BY pid",
    )
  ).rows;
  const preparedTransactions = (
    await query(
      "SELECT count(*)::integer AS n FROM pg_prepared_xacts WHERE database=current_database()",
    )
  ).rows[0].n;
  return {
    leases,
    uncertain: uncertainty,
    sessions,
    transactions: sessions.filter((s) => s.has_transaction).length,
    preparedTransactions,
  };
}
export function assertDatabaseQuiescence(s) {
  need(Array.isArray(s.sessions) && s.sessions.length === 0, "OTHER_SESSIONS");
  need(
    s.transactions === 0 && s.preparedTransactions === 0,
    "OTHER_TRANSACTIONS",
  );
  for (const [values, key] of [
    [predicates, "leases"],
    [uncertain, "uncertain"],
  ])
    for (const name of Object.keys(values))
      need(
        Number.isSafeInteger(s[key]?.[name]) && s[key][name] === 0,
        key === "leases" ? "UNRESOLVED_LEASE" : "UNCERTAIN_EFFECT",
      );
}

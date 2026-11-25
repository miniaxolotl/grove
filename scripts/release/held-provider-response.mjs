// DigitalOcean archives retain desired resources in app.spec, while the active
// archive deployment omits service/worker/ingress resources. Keep both raw specs.
import { isDeepStrictEqual } from "node:util";
import { validateCompleteInstanceInventory } from "./held-instance-inventory.mjs";

export function deploymentSpecMatches(app) {
  const desired = app?.spec, actual = app?.active_deployment?.spec;
  if (!desired || !actual) return false;
  if (isDeepStrictEqual(desired, actual)) return true;
  if (desired.maintenance?.archive !== true || desired.maintenance.enabled !== true ||
      desired.services?.length !== 1 || desired.workers?.length !== 1) return false;
  const projection = structuredClone(desired);
  for (const key of ["services", "workers", "ingress"]) delete projection[key];
  return isDeepStrictEqual(projection, actual);
}

export function providerInstanceInventory(page, app) {
  // The protobuf API omits its empty repeated field. Accept only the exact empty
  // envelope under an independently settled, matching archive, never a running app
  // or a response with pagination/metadata/malformed instances.
  const emptyArchive = page && !Array.isArray(page) && Object.keys(page).length === 0 &&
    app?.spec?.maintenance?.archive === true && app.spec.maintenance.enabled === true &&
    app.active_deployment?.phase === "ACTIVE" && !app.pending_deployment &&
    !app.in_progress_deployment && deploymentSpecMatches(app);
  return validateCompleteInstanceInventory(emptyArchive ? { instances: [] } : page);
}

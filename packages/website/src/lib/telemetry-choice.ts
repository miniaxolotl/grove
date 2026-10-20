const preferenceKey = "grove.telemetry.optout";
const generationKey = "grove.telemetry.generation";
const preferenceEvent = "grove:telemetry-preference";
let generation: string | null | undefined;
let storageFailed = false;

export function browserOptOut(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl === true)
  );
}
export function telemetryOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      storageFailed ||
      browserOptOut() ||
      localStorage.getItem(preferenceKey) === "true"
    );
  } catch {
    return true;
  }
}
export function activateTelemetryGeneration() {
  try {
    generation = localStorage.getItem(generationKey);
  } catch {
    generation = undefined;
  }
}
export function telemetryAllowed(): boolean {
  if (telemetryOptedOut() || generation === undefined) return false;
  try {
    return generation === localStorage.getItem(generationKey);
  } catch {
    return false;
  }
}
export function rotateTelemetryGeneration() {
  try {
    localStorage.setItem(generationKey, crypto.randomUUID());
    activateTelemetryGeneration();
  } catch (error) {
    storageFailed = true;
    throw error;
  }
}
export function subscribePreference(callback: () => void) {
  window.addEventListener(preferenceEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(preferenceEvent, callback);
    window.removeEventListener("storage", callback);
  };
}
export function storePreference(disabled: boolean) {
  try {
    localStorage.setItem(preferenceKey, String(disabled));
    // Other tabs cannot resume an old identity after disable -> enable.
    if (disabled) localStorage.setItem(generationKey, crypto.randomUUID());
  } catch (error) {
    storageFailed = true;
    throw error;
  }
}
export function notifyPreference() {
  window.dispatchEvent(new Event(preferenceEvent));
}

"use client";

import { consentAllowed } from "./cookie-consent";
import { registrationDocumentReady } from "./registration-document";

type AdvertisingWindow = Window & {
  adroll_adv_id?: string;
  adroll_pix_id?: string;
  adroll?: { track(event: string, data: { segment_name: string }): void };
};
const receiptKey = "grove.registration-conversion.sent";
let pending = false;
let delivered = false;

/** Called only by the server-qualified, content-free registration handoff. */
export function captureRegistrationConversion() {
  if (pending || delivered || typeof window === "undefined") return;
  const allowed = () => {
    const url = new URL(location.href);
    return (
      process.env.NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT === "production" &&
      url.protocol === "https:" &&
      ["usegrove.cloud", "www.usegrove.cloud"].includes(url.hostname) &&
      url.pathname === "/welcome" &&
      !url.hash &&
      [...url.searchParams.keys()].every((key) =>
        /^utm_(source|medium|campaign|term|content)$/.test(key),
      ) &&
      registrationDocumentReady() &&
      consentAllowed("advertising")
    );
  };
  if (!allowed()) return;
  try {
    if (sessionStorage.getItem(receiptKey) === "true") return;
  } catch {
    return;
  }
  pending = true;
  let attempts = 0;
  const deliver = () => {
    if (!allowed()) {
      pending = false;
      return;
    }
    const browser = window as AdvertisingWindow;
    if (
      browser.adroll_adv_id === "ZITLPJB6MZGJLI3HIT3FNG" &&
      browser.adroll_pix_id === "5MRQQSBIQJA4HJWZA64ET3" &&
      typeof browser.adroll?.track === "function"
    ) {
      try {
        browser.adroll.track("pageView", { segment_name: "30a39d31" });
        delivered = true;
        sessionStorage.setItem(receiptKey, "true");
      } catch {
        /* Measurement cannot prevent opening the notebook. */
      }
      pending = false;
      return;
    }
    if (++attempts < 20) window.setTimeout(deliver, 500);
    else pending = false;
  };
  deliver();
}

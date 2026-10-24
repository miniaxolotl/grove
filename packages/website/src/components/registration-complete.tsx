"use client";

import { useEffect } from "react";
import { WebsiteTagManager } from "./website-tag-manager";
import { subscribeConsent } from "@/lib/cookie-consent";
import { captureRegistrationConversion } from "@/lib/advertising-conversion";
import { registrationDocumentReady } from "@/lib/registration-document";

/** No account details are accepted as props or placed in the marketing document. */
export function RegistrationComplete() {
  useEffect(() => {
    if (!registrationDocumentReady()) {
      // Auth/private client navigation and old referrers must leave their document
      // before any vendor can run. The new page's no-referrer policy clears it.
      location.replace("/welcome");
      return;
    }
    captureRegistrationConversion();
    return subscribeConsent(captureRegistrationConversion);
  }, []);
  return registrationDocumentReady() ? (
    <WebsiteTagManager registrationComplete />
  ) : null;
}

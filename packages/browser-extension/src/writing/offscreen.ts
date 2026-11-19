import { checkInWorker } from "./harper.ts";
import { nativeBrowser as host } from "../webextension.ts";

navigator.serviceWorker.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (
    !port ||
    !(event.source instanceof ServiceWorker) ||
    event.source.scriptURL !== host.runtime.getURL("background.js")
  )
    return;
  void checkInWorker(event.data.text, event.data.settings)
    .then(
      (result) => port.postMessage(result),
      () => port.postMessage(null),
    )
    .finally(() => port.close());
});

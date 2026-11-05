export {
  normalizeWebUrl,
  webCaptureSchema,
  formatWebCapture,
} from "@lib/shared/web-capture";
export type { WebCapture } from "@lib/shared/web-capture";
export {
  captureDraftLifetimeMs,
  createCaptureDraft,
  readCaptureDraft,
  editCaptureDraft,
  prepareCaptureSave,
  settleCaptureSave,
} from "./drafts.ts";
export type {
  CaptureScope,
  CaptureDraft,
  CaptureSaveOutcome,
} from "./drafts.ts";
export {
  browserTargets,
  browserProfile,
  openNativePanel,
  contextMenuCapture,
} from "./platform.ts";
export type {
  BrowserTarget,
  NativePanelHost,
  ContextMenuCaptureEvent,
  CaptureTab,
} from "./platform.ts";

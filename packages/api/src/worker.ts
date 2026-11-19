import { releaseEntry } from "./release-hold.ts";

// Do not import the effectful module at all until the startup hold is absent.
await releaseEntry("worker", () => import("./worker-runtime.ts"));

import { randomBytes } from "node:crypto";

// The upstream is shared by all workers. Give each mutable scenario its own URL.
export const newShareToken = () => `gsh_${randomBytes(32).toString("base64url")}`;

import { existsSync, readFileSync } from "node:fs";

// Resolve against this process's release, never the mutable backend-current link.
const marker = new URL("../.deployment-revision", import.meta.url);
const identity = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
export const deploymentIdentity = /^[a-f0-9]{40} [a-f0-9]{40}-\d+-\d+$/.test(identity)
  ? identity
  : null;

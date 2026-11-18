// Structural acceptance of a recorded observation, not a fresh provider read.
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const assets = [
  "grove-chrome.zip",
  "grove-edge.zip",
  "grove-firefox.zip",
  "packages.build.json",
  "downloads.json",
  "SHA256SUMS",
];

export function successfulReceipt(name, identity, evidence) {
  if (!identity || typeof evidence !== "string" || !evidence.trim())
    return false;
  if (name === "service")
    return (
      identity.phase === "ACTIVE" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
        identity.deploymentId,
      ) &&
      digest.test(identity.imageDigest)
    );
  if (!version.test(identity.version)) return false;
  if (name === "website")
    return (
      /^[a-f0-9]{40}$/.test(identity.productionSha) &&
      /^dpl_[A-Za-z0-9]+$/.test(identity.deploymentId) &&
      /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(identity.deploymentUrl) &&
      identity.alias === "https://usegrove.cloud"
    );
  if (name === "downloads")
    return assets.every((key) => digest.test(identity.assets?.[key]));
  return (
    name.startsWith("npm:") &&
    identity.latest === identity.version &&
    /^sha512-[A-Za-z0-9+/]{86}==$/.test(identity.integrity)
  );
}

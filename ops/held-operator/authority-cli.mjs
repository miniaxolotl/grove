// Explicit one-time independent LOCAL provisioning only. No execution path calls
// this command, and no operation repairs/reinitializes an existing authority.
import process from "node:process";
import { dirname, resolve } from "node:path";
import { createControl, need } from "./operator-control.mjs";
import { provisionAuthority, openAuthority } from "./authority.mjs";
try {
  const [verb, ...args] = process.argv.slice(2);
  if (!verb)
    process.stdout.write(
      "Usage: node ops/held-operator/authority-cli.mjs provision|register --request <private JSON> --out <new private working identity JSON>\n",
    );
  else {
    need(
      ["provision", "register"].includes(verb) &&
        args.length === 4 &&
        args[0] === "--request" &&
        args[2] === "--out",
      "AUTHORITY_ARGUMENTS_REJECTED",
    );
    const request = resolve(args[1]),
      parameters = await createControl(dirname(request)).readPrivate(request),
      descriptor =
        verb === "provision"
          ? await provisionAuthority(parameters)
          : await openAuthority(parameters.descriptor).registerInstallation(
              parameters.parameters,
            );
    await createControl(descriptor.workRoot, {
      expectedIdentity: descriptor.workIdentity,
    }).durableWrite(args[3], JSON.stringify(descriptor, null, 2) + "\n");
    process.stdout.write(
      JSON.stringify({
        id: descriptor.id,
        custodyId: descriptor.custodyId,
        source: descriptor.source,
        provisioned: true,
      }) + "\n",
    );
  }
} catch {
  process.stderr.write(
    "Authority provisioning failed or outcome requires inspection. Never reset/reinitialize an existing authority; retained independent identity must be reconciled.\n",
  );
  process.exitCode = 1;
}

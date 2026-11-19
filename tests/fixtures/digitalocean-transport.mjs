// Preloaded only by synthetic provider CLI tests. No real network is reachable.
import process from "node:process";
import console from "node:console";

const { Response, URL } = globalThis;
const apps = JSON.parse(process.env.FIXTURE_APPS);
const calls = [];
let reads = 0;
let applied;
globalThis.fetch = async (url, options) => {
  const path = new URL(url).pathname;
  calls.push({ method: options.method, path });
  if (options.method === "GET" && path === "/v2/apps/" + apps[0].id)
    return Response.json({
      app: applied ?? apps[Math.min(reads++, apps.length - 1)],
    });
  if (options.method === "POST" && path === "/v2/apps/propose")
    return Response.json({ app_cost: 15 });
  if (options.method === "PUT" && path === "/v2/apps/" + apps[0].id) {
    const { spec } = JSON.parse(options.body);
    applied = {
      id: apps[0].id,
      spec,
      active_deployment: { id: "fixture-completed", phase: "ACTIVE", spec },
    };
    return Response.json({
      app: {
        ...applied,
        in_progress_deployment: applied.active_deployment,
      },
    });
  }
  if (
    options.method === "GET" &&
    path === "/v2/apps/" + apps[0].id + "/deployments/fixture-completed"
  )
    return Response.json({ deployment: applied.active_deployment });
  throw new Error("Unexpected fixture provider request");
};
process.on("exit", () => console.log("FIXTURE_CALLS=" + JSON.stringify(calls)));

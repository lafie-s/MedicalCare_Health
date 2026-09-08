import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readAccessPolicy } from "./access-policy.js";
import { createIdentityProvider } from "./identity.js";
import { SessionStore } from "./session-store.js";
import type { AuthDependencies } from "./auth-routes.js";
import { ServiceStore } from "./service-store.js";
import { ProbeRunner } from "./probe.js";
import { ReleaseManager, releaseConfigSchema } from "./release-manager.js";
import { dockerReleaseExecutor } from "./release-docker.js";

const config = loadConfig();
let auth: AuthDependencies | undefined;
if (config.auth) {
  const settings = config.auth;
  await readAccessPolicy(settings.policyPath);
  await mkdir(dirname(settings.databasePath), { recursive: true });
  auth = { identity: createIdentityProvider(settings.baseUrl), store: new SessionStore(settings.databasePath, settings.key), policy: () => readAccessPolicy(settings.policyPath), origin: settings.origin, secureCookie: settings.origin.startsWith("https:") };
  auth.services = new ServiceStore(settings.databasePath);
  if (process.env.RELEASE_CONFIG_PATH) {
    const release = releaseConfigSchema.parse(JSON.parse(await readFile(process.env.RELEASE_CONFIG_PATH, "utf8")));
    if (!auth.services.get(release.serviceId)) throw new Error("Release service must be registered before enabling releases");
    auth.releaseManager = new ReleaseManager(release.serviceId, release.releases, "docker", auth.services.releases, dockerReleaseExecutor(release.deploymentDirectory, release.releases));
  }
  auth.probeRunner = new ProbeRunner(auth.services, auth.policy);
}
const app = buildApp(auth);
if (auth) {
  app.addHook("onReady", async () => auth.probeRunner?.start(() => app.log.error("Collector configuration or storage unavailable")));
  app.addHook("preClose", async () => auth.probeRunner?.stop());
  app.addHook("preClose", async () => auth.releaseManager?.close());
  app.addHook("onClose", async () => { auth.services?.close(); auth.store.close(); });
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close(); });
}
await app.listen({ host: config.host, port: config.port });

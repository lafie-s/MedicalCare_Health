import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close(); });
}
await app.listen({ host: config.host, port: config.port });

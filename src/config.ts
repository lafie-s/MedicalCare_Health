export interface Config {
  host: string;
  port: number;
  production: boolean;
  auth?: { baseUrl: string; origin: string; policyPath: string; databasePath: string; key: Buffer };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? "4310");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const config: Config = { host: env.HOST ?? "127.0.0.1", port, production: env.NODE_ENV === "production" };
  const authValues = [env.MEDICALCARE_AUTH_URL, env.PLATFORM_ORIGIN, env.ACCESS_POLICY_PATH, env.SESSION_KEY];
  if (authValues.some(Boolean)) {
    if (!authValues.every(Boolean)) throw new Error("Identity URL, platform origin, access policy path and session key must all be configured");
    const base = new URL(env.MEDICALCARE_AUTH_URL!);
    const origin = new URL(env.PLATFORM_ORIGIN!);
    for (const url of [base, origin]) {
      const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback && !config.production)) || url.username || url.password || url.search || url.hash) throw new Error("Use HTTPS URLs without credentials or query strings; local HTTP is development-only");
    }
    if (origin.pathname !== "/") throw new Error("PLATFORM_ORIGIN must contain only an origin");
    const key = Buffer.from(env.SESSION_KEY!, "base64");
    if (key.length !== 32 || key.toString("base64") !== env.SESSION_KEY) throw new Error("SESSION_KEY must be a canonical base64 encoded 32-byte key");
    config.auth = { baseUrl: base.toString().replace(/\/$/, ""), origin: origin.origin, policyPath: env.ACCESS_POLICY_PATH!, databasePath: env.STATE_DB_PATH ?? "data/health.sqlite", key };
  }
  if (config.production && !config.auth) throw new Error("Production requires identity and access configuration");
  return config;
}

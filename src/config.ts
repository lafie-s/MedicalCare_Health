export interface Config {
  host: string;
  port: number;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? "4310");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return { host: env.HOST ?? "127.0.0.1", port, production: env.NODE_ENV === "production" };
}

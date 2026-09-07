// Isolated manual browser fixture. Never used by src/server.ts or production builds.
import { randomBytes } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { SessionStore } from "../../src/session-store.js";
if (process.env.NODE_ENV !== "test") throw new Error("UI fixture requires NODE_ENV=test");
const store = new SessionStore(":memory:", randomBytes(32));
const app = buildApp({
  identity: {
    async login(email, password) {
      if (email === "offline@example.test") throw new Error("Fixture offline");
      if (password !== "fixture-password") return null;
      return email === "denied@example.test" ? "denied-token" : "fixture-token";
    },
    async verify(token) { return { userId: token === "denied-token" ? "denied" : "fixture-operator", displayName: "测试运维人员", role: "ADMIN" }; },
    async ready() { return true; },
  },
  store, origin: "http://127.0.0.1:4320", secureCookie: false,
  policy: async () => ({ environments: [{ id: "local", name: "本地开发", type: "development" }, { id: "staging", name: "集成验证环境", type: "staging" }], grants: [{ userId: "fixture-operator", role: "operator", environmentIds: ["local", "staging"] }] }),
});
app.addHook("onClose", async () => store.close());
await app.listen({ host: "127.0.0.1", port: 4310 });

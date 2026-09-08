import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { dockerReleaseExecutor } from "../src/release-docker.js";
import { ReleaseStore } from "../src/release-store.js";
import { ServiceStore } from "../src/service-store.js";
import { SessionStore } from "../src/session-store.js";
import { ReleaseManager, releaseConfigSchema, type WebsiteRelease } from "../src/release-manager.js";
import { buildApp } from "../src/app.js";
import type { Grant } from "../src/access-policy.js";
const releases: WebsiteRelease[] = ["1.0", "2.0"].map((id, i) => ({ id, name: id, notes: "test", publishedAt: "2026-09-08T00:00:00Z", databaseCompatible: true, webImage: `sha256:${String(i).repeat(64)}`, chatImage: `sha256:${String(i).repeat(64)}` }));
function setup() {
  const store = new ServiceStore(":memory:"); const service = store.create(randomUUID(), "local", { name: "site", owner: "ops", targetId: "target", intervalSeconds: 30 }, "ops", "test");
  let current = "1.0"; let calls = 0; let fail = false; let gate = Promise.resolve();
  const manager = new ReleaseManager(service.id, releases, "demo", store.releases, { current: async () => ({ releaseId: current, healthy: true }), deploy: async (release) => { calls++; await gate; if (fail) throw new Error("private executor detail"); current = release.id; } });
  const input = { id: randomUUID(), expected: "1.0", to: "2.0", action: "update" as const, reason: "approved", backupReference: "drill-1" };
  return { store, service, manager, input, calls: () => calls, setFail: () => { fail = true; }, setGate: (value: Promise<void>) => { gate = value; } };
}
test("release updates and rolls back, with idempotency, concurrency and audit", async (t) => {
  const c = setup(); t.after(() => c.store.close()); let release!: () => void; c.setGate(new Promise<void>((resolve) => { release = resolve; }));
  const [first, duplicate] = await Promise.all([c.manager.start(c.input, "ops"), c.manager.start(c.input, "ops")]);
  assert.equal(first.id, duplicate.id); assert.equal(c.calls(), 1);
  await assert.rejects(c.manager.start({ ...c.input, id: randomUUID() }, "ops"));
  await assert.rejects(c.manager.start({ ...c.input, reason: "different" }, "ops"));
  release(); await c.manager.close();
  assert.equal(c.store.releases.get(first.id)!.status, "succeeded"); assert.equal((await c.manager.snapshot()).releaseId, "2.0");
  assert.equal((await c.manager.start(c.input, "ops")).id, first.id); assert.equal(c.calls(), 1);
  await c.manager.start({ ...c.input, id: randomUUID(), expected: "2.0", to: "1.0", action: "rollback" }, "ops"); await c.manager.close();
  assert.equal((await c.manager.snapshot()).releaseId, "1.0");
  const audit = c.store.auditLog.query({ environmentId: "local", from: 0, to: Date.now() + 1, page: 1, category: "release" }); assert.equal(audit.total, 4);
});
test("release rejects unapproved/stale/invalid rollback and locks uncertain failure until reconciliation", async (t) => {
  const c = setup(); t.after(() => c.store.close());
  for (const input of [{ ...c.input, to: "other" }, { ...c.input, expected: "other" }, { ...c.input, action: "rollback" as const }]) await assert.rejects(c.manager.start(input, "ops"));
  c.setFail(); const task = await c.manager.start(c.input, "ops"); await c.manager.close();
  assert.equal(c.store.releases.get(task.id)!.status, "unknown");
  assert.ok(!JSON.stringify(await c.manager.snapshot()).includes("private executor detail"));
  await assert.rejects(c.manager.start({ ...c.input, id: randomUUID() }, "ops"));
  const reconciled = await c.manager.reconcile("admin"); assert.equal(reconciled.status, "failed"); assert.equal(c.store.releases.active(c.service.id), null);
});
test("release catalog rejects mutable tags and database migrations", () => {
  const config = { serviceId: randomUUID(), deploymentDirectory: "/opt/medicalcare/deploy", releases };
  assert.equal(releaseConfigSchema.safeParse(config).success, true);
  assert.equal(releaseConfigSchema.safeParse({ ...config, releases: [{ ...releases[0], webImage: "repo:latest" }] }).success, false);
  assert.equal(releaseConfigSchema.safeParse({ ...config, releases: [{ ...releases[0], databaseCompatible: false }] }).success, false);
});
test("release API enforces admin, environment, origin and unavailable executor boundaries", async (t) => {
  const c = setup(); const sessions = new SessionStore(":memory:", randomBytes(32)); let role: Grant["role"] = "viewer";
  const app = buildApp({ store: sessions, services: c.store, releaseManager: c.manager, identity: { verify: async () => ({ userId: "ops", displayName: "Ops", role: "ADMIN" }), ready: async () => true }, policy: async () => ({ environments: [{ id: "local", name: "Local", type: "development" }], grants: [{ userId: "ops", role, environmentIds: ["local"] }] }), origin: "http://localhost:4320", secureCookie: false });
  t.after(async () => { await c.manager.close(); await app.close(); sessions.close(); c.store.close(); });
  const session = sessions.create("ops", "test-token", "test"); const headers = { origin: "http://localhost:4320", cookie: `mc_health_session=${session.id}` }; const url = `/api/v1/services/${c.service.id}/release`;
  assert.equal((await app.inject({ method: "POST", url, payload: c.input, headers: { origin: headers.origin } })).statusCode, 401);
  for (const next of ["viewer", "operator"] as const) { role = next; assert.equal((await app.inject({ method: "POST", url, payload: c.input, headers })).statusCode, 403); }
  role = "admin";
  const other = c.store.create(randomUUID(), "prod", { name: "private", owner: "ops", targetId: "target", intervalSeconds: 30 }, "ops", "test");
  assert.equal((await app.inject({ url: `/api/v1/services/${other.id}/releases`, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url, payload: { ...c.input, backupReference: "" }, headers })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url, payload: c.input, headers: { ...headers, origin: "http://other" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url, payload: c.input, headers })).statusCode, 202); await c.manager.close();
  const result = await app.inject({ url: `${url}s`, headers }); assert.equal(result.statusCode, 200); assert.equal(result.json().releaseId, "2.0"); assert.ok(!result.body.includes("webImage"));
});

test('release audit failure prevents task creation and restart locks interrupted work', (t) => {
 const db = new DatabaseSync(':memory:'); t.after(()=>db.close());
 db.exec('CREATE TABLE audit_events(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,request_id TEXT,created_at INTEGER)');
 const store = new ReleaseStore(db);
 const task = {id:randomUUID(),serviceId:randomUUID(),from:'1',to:'2',action:'update' as const,reason:'approved',backupReference:'test',actor:'admin',status:'running' as const,message:'running',createdAt:Date.now(),finishedAt:null};
 db.exec("CREATE TRIGGER deny_release BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'injected'); END");
 assert.throws(()=>store.create(task)); assert.equal(store.get(task.id),null);
 db.exec('DROP TRIGGER deny_release'); store.create(task);
 const restarted = new ReleaseStore(db); assert.equal(restarted.get(task.id)!.status,'unknown');
 assert.throws(()=>restarted.create({...task,id:randomUUID()}));
});

test('Docker executor switches only approved app images then validates health and reloads nginx', async(t)=>{
 const calls: string[][]=[]; let switched=false; let override='';
 const executor=dockerReleaseExecutor(join(tmpdir(),'release-deployment'),releases,async(args)=>{
  calls.push(args);
  if(args[0]==='inspect') { const image=releases[switched?1:0]!.webImage; return `${image}|${image}|healthy|true`; }
  if(args[0]==='compose') { override=args[8]!; switched=true; }
  return '';
 });
 t.after(async()=>{if(override){const directory=resolve(dirname(override)); assert.ok(directory.startsWith(resolve(tmpdir())+sep+'medicalcare-release-'));await rm(directory,{recursive:true,force:true});}});
 assert.equal((await executor.current()).releaseId,'1.0');
 await executor.deploy(releases[1]!); assert.equal((await executor.current()).releaseId,'2.0');
 const config=JSON.parse(await readFile(override,'utf8'));
 assert.deepEqual(Object.keys(config.services),['medicalcare','chat']);
 assert.equal(config.services.medicalcare.image,releases[1]!.webImage);
 assert.ok(calls.some(args=>args.includes('--no-build')&&args.includes('--no-deps')));
 assert.ok(calls.some(args=>args.join(' ')==='exec shengren-nginx-1 nginx -s reload'));
 assert.ok(!calls.flat().some(arg=>['postgres','redis','sh','migrate','seed'].includes(arg)));
});

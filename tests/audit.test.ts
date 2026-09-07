import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AuditStore } from '../src/audit-store.js';

test('audit resolves known resource families, excludes unscoped records and uses stable boundary pagination', (t) => {
 const db = new DatabaseSync(':memory:'); t.after(()=>db.close());
 db.exec(`CREATE TABLE audit_events(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,request_id TEXT,created_at INTEGER);
 CREATE TABLE services(id TEXT,environment_id TEXT,name TEXT);
 CREATE TABLE probe_runs(id TEXT,service_id TEXT); CREATE TABLE alert_events(id TEXT,service_id TEXT); CREATE TABLE maintenance_windows(id TEXT,service_id TEXT);
 INSERT INTO services VALUES ('s','local','service'),('p','prod','private');
 INSERT INTO probe_runs VALUES ('probe','s'); INSERT INTO alert_events VALUES ('alert','s'); INSERT INTO maintenance_windows VALUES ('window','s');`);
 const add = (action:string, at=100) => db.prepare('INSERT INTO audit_events(actor,action,request_id,created_at) VALUES (?,?,?,?)').run('operator',action,'sensitive-request',at);
 for (const action of ['service.created:s','service.updated:s:v2:disabled','probe.started:s:probe','probe.finished:probe:success','alert.rule_saved:s:v1','alert.fired:alert','alert.recovered:alert','alert.terminated:alert:disabled','alert.acknowledge:alert','alert.close:alert','maintenance.created:window','maintenance.canceled:window']) add(action);
 add('service.created:p'); add('session.created'); add('unknown:s'); add('maintenance.created:missing'); add('service.created:s',200);
 const store = new AuditStore(db); const input = {environmentId:'local',from:100,to:200,page:1,category:'all' as const};
 assert.equal(store.query(input).total,12); assert.equal(store.query({...input,category:'alert'}).total,6);
 assert.equal(store.query({...input,from:101}).total,0);
 for(let i=0;i<22;i++) add('service.created:s');
 const first=store.query(input); const second=store.query({...input,page:2});
 assert.equal(first.items.length,20); assert.equal(second.items.length,14);
 assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,34);
 assert.equal(store.query({...input,page:999}).page,2);
 assert.ok(first.items[0]!.id > first.items[1]!.id);
 assert.ok(!JSON.stringify(first).includes('sensitive-request'));
});

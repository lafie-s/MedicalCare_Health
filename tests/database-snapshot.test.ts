import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ServiceStore } from '../src/service-store.js';
import { SessionStore } from '../src/session-store.js';
import { createSnapshot, restoreSnapshot } from '../src/database-snapshot.js';

test('WAL snapshot restores business data, clears sessions and refuses overwrite or damaged backup', async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'mc-snapshot-')); const source=join(dir,'source.sqlite');
 const services=new ServiceStore(source); const sessions=new SessionStore(source,Buffer.alloc(32,1));
 t.after(async()=>{services.close();sessions.close(); assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'mc-snapshot-')); await rm(dir,{recursive:true,force:true});});
 const service=services.create(randomUUID(),'local',{name:'snapshot test',owner:'ops',targetId:'target',intervalSeconds:30},'ops','test');
 const window=services.maintenance.create(randomUUID(),{serviceId:service.id,startsAt:Date.now()+60000,endsAt:Date.now()+120000,owner:'ops',reason:'test'},'ops','test');
 sessions.create('ops','fixture-token','test');
 const backup=join(dir,'backup'); const manifest=await createSnapshot(source,backup);
 assert.equal(manifest.counts.services,1); assert.equal(manifest.counts.sessions,1);
 await assert.rejects(createSnapshot(source,backup));
 const restored=join(dir,'restored'); const result=await restoreSnapshot(backup,restored);
 assert.equal(result.counts.sessions,0); assert.equal(result.counts.audit_events,manifest.counts.audit_events!+1);
 const copy=new ServiceStore(join(restored,'state.sqlite'));
 try { assert.equal(copy.get(service.id)!.name,'snapshot test'); assert.equal(copy.maintenance.get(window.id)!.reason,'test'); } finally {copy.close();}
 assert.equal(sessions.find('invalid'),null);
 const check=new DatabaseSync(source,{readOnly:true}); try {assert.equal(check.prepare('SELECT COUNT(*) AS count FROM sessions').get()!.count,1);} finally {check.close();}
 await appendFile(join(backup,'state.sqlite'),'damage');
 await assert.rejects(restoreSnapshot(backup,join(dir,'bad')),/checksum/);
 await assert.rejects(createSnapshot(join(dir,'missing'),join(dir,'absent')));
});

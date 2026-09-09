import type { DatabaseSync } from "node:sqlite";
import type { ProbeRecord, Service } from "./service-store.js";
export type RecoveryTask = { id: string; serviceId: string; status: "running" | "succeeded" | "unknown" | "canceled" | "resolved"; createdAt: number; finishedAt: number | null; message: string; diagnostics: { available: boolean; codes: string[] } | null };
export class RecoveryConflict extends Error {}
export class RecoveryStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS recovery_policy(service_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL,version INTEGER NOT NULL,changed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_changes(id TEXT PRIMARY KEY,service_id TEXT NOT NULL,actor TEXT NOT NULL,input TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recovery_tasks(id TEXT PRIMARY KEY,service_id TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS recovery_task_time ON recovery_tasks(service_id,created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS recovery_single_active ON recovery_tasks((1)) WHERE status IN ('running','unknown');`);
    for (const task of db.prepare("SELECT id FROM recovery_tasks WHERE status='running'").all()) this.finish(String(task.id), "unknown", "平台进程中断，须核对执行已停止和网站状态；不会自动重放");
  }
  private tx<T>(work: () => T): T { this.db.exec("BEGIN IMMEDIATE");try { const result=work();this.db.exec("COMMIT");return result; }catch(error){this.db.exec("ROLLBACK");throw error;} }
  private audit(action: string, serviceId: string, actor: string, id: string, now: number) { this.db.prepare("INSERT INTO audit_events(actor,action,request_id,created_at) VALUES (?,?,?,?)").run(actor,`recovery.${action}:${serviceId}`,id,now); }
  simulated(serviceId:string,id:string,actor:string){this.audit("simulated",serviceId,actor,id,Date.now());}
  policy(serviceId: string) { const row=this.db.prepare("SELECT * FROM recovery_policy WHERE service_id=?").get(serviceId);return {enabled:Boolean(row?.enabled),version:Number(row?.version??0),changedAt:Number(row?.changed_at??0)}; }
  configure(serviceId: string, enabled: boolean, version: number, id: string, actor: string, reason: string, now=Date.now()) {
    const input=JSON.stringify({enabled,version,reason});
    return this.tx(()=>{const previous=this.db.prepare("SELECT * FROM recovery_changes WHERE id=?").get(id);
      if(previous){if(previous.service_id!==serviceId||previous.actor!==actor||previous.input!==input)throw new RecoveryConflict("重复请求内容不一致");return this.policy(serviceId);}
      if(this.policy(serviceId).version!==version)throw new RecoveryConflict("配置已变更，请刷新后重新核对");
      this.db.prepare("INSERT INTO recovery_changes VALUES (?,?,?,?)").run(id,serviceId,actor,input);
      this.db.prepare("INSERT INTO recovery_policy VALUES (?,?,?,?) ON CONFLICT(service_id) DO UPDATE SET enabled=excluded.enabled,version=excluded.version,changed_at=excluded.changed_at").run(serviceId,Number(enabled),version+1,now);
      this.audit(enabled?'enabled':'disabled',serviceId,actor,id,now);return this.policy(serviceId);
    });
  }
  get(id: string): RecoveryTask | null {const row=this.db.prepare("SELECT data FROM recovery_tasks WHERE id=?").get(id);return row?JSON.parse(String(row.data)) as RecoveryTask:null;}
  list(serviceId: string): RecoveryTask[] {return this.db.prepare("SELECT data FROM recovery_tasks WHERE service_id=? ORDER BY created_at DESC,id DESC LIMIT 20").all(serviceId).map(r=>JSON.parse(String(r.data)) as RecoveryTask);}
  active(){const row=this.db.prepare("SELECT data FROM recovery_tasks WHERE status IN ('running','unknown')").get();return row?JSON.parse(String(row.data)) as RecoveryTask:null;}
  budget(serviceId: string,now=Date.now()) {const last=this.list(serviceId)[0];return {cooldownUntil:last?Math.max(last.createdAt,last.finishedAt??0)+600000:0,attemptsLastHour:Number(this.db.prepare("SELECT COUNT(*) n FROM recovery_tasks WHERE service_id=? AND created_at>?").get(serviceId,now-3600000)!.n)};}
  claim(service: Service, sample: ProbeRecord, fingerprint: string, now=Date.now()) {
    return this.tx(()=>{
      const policy=this.policy(service.id);const budget=this.budget(service.id,now);
      if(!policy.enabled||!service.enabled||sample.actor!=="system:collector"||sample.targetFingerprint!==fingerprint||sample.serviceVersion!==service.version||this.get(sample.id)||this.active()||budget.cooldownUntil>now||budget.attemptsLastHour>=3)return null;
      if(this.db.prepare("SELECT 1 FROM release_tasks WHERE status IN ('running','unknown') LIMIT 1").get())return null;
      const last=this.list(service.id)[0];const after=Math.max(policy.changedAt,last?.finishedAt??last?.createdAt??0);
      const rows=this.db.prepare("SELECT id,started_at,outcome,http_status,actor,service_version,target_fingerprint FROM probe_runs WHERE service_id=? ORDER BY started_at DESC,id DESC LIMIT 3").all(service.id);
      if(rows.length!==3||rows[0]!.id!==sample.id||sample.startedAt>now||now-sample.startedAt>service.intervalSeconds*2000+5000)return null;
      let prior=now;
      for(const row of rows){const time=Number(row.started_at);if(time<=after||prior-time>service.intervalSeconds*2000+5000||row.actor!=="system:collector"||row.service_version!==service.version||row.target_fingerprint!==fingerprint||!(row.outcome==='timeout'||row.outcome==='connection_error'||row.outcome==='http_error'&&Number(row.http_status)>=500&&Number(row.http_status)<=599))return null;prior=time;}
      const task:RecoveryTask={id:sample.id,serviceId:service.id,status:"running",createdAt:now,finishedAt:null,message:"连续 3 次服务端故障，正在保存诊断并准备重启",diagnostics:null};
      this.db.prepare("INSERT INTO recovery_tasks VALUES (?,?,?,?,?)").run(task.id,task.serviceId,task.status,now,JSON.stringify(task));this.audit("started",service.id,"system:recovery",task.id,now);return task;
    });
  }
  diagnostics(id:string,data:NonNullable<RecoveryTask['diagnostics']>){this.tx(()=>{const task=this.get(id);if(!task||task.status!=="running")throw new RecoveryConflict("任务已结束");this.db.prepare("UPDATE recovery_tasks SET data=? WHERE id=?").run(JSON.stringify({...task,diagnostics:data}),id);});}
  finish(id:string,status:RecoveryTask['status'],message:string,actor="system:recovery",now=Date.now()) {return this.tx(()=>{const task=this.get(id);if(!task||!["running","unknown"].includes(task.status))throw new RecoveryConflict("任务已结束");const result={...task,status,message,finishedAt:status==='unknown'?null:now};this.db.prepare("UPDATE recovery_tasks SET status=?,data=? WHERE id=?").run(status,JSON.stringify(result),id);this.audit(status,task.serviceId,actor,id,now);return result;});}
}

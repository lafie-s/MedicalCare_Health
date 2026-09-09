import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { RecoveryConflict } from "./recovery-store.js";
import { z } from "zod";
import type { ServiceStore, ProbeRecord } from "./service-store.js";
import { targetFingerprint } from "./probe.js";
import type { AccessPolicy, ProbeTarget } from "./access-policy.js";
import type { RecoveryTask } from "./recovery-store.js";
export const recoveryConfigSchema=z.object({serviceId:z.uuid(),containers:z.array(z.enum(['medicalcare-app','medicalcare-chat'])).min(1).max(2).refine(items=>new Set(items).size===items.length)}).strict();
export interface RecoveryExecutor { diagnostics():Promise<NonNullable<RecoveryTask['diagnostics']>>;restart():Promise<void>;healthy(target:ProbeTarget):Promise<boolean> }
export class RecoveryManager {
  private readonly demoAbort=new AbortController();
  private readonly simulations=new Map<string,{id:string;status:string;completed:number}>();
  private simulation:{id:string;status:string;completed:number}|null=null;
  private readonly work=new Set<Promise<void>>();private stopped=false;
  constructor(readonly serviceId:string,readonly mode:'demo'|'docker',private readonly store:ServiceStore,private readonly policy:()=>Promise<AccessPolicy>,private readonly executor:RecoveryExecutor){}
  private blocked(){return this.store.maintenance.active(this.serviceId,Date.now())>0||this.store.maintenanceAccess.get(this.serviceId).mode==='manual';}
  observe(sample:ProbeRecord){if(this.stopped||sample.serviceId!==this.serviceId)return;const work=this.evaluate(sample).catch(()=>{/* Failed storage/configuration never permits an unrecorded restart. */}).finally(()=>this.work.delete(work));this.work.add(work);}
  private async evaluate(sample:ProbeRecord){
    const policy=await this.policy();const service=this.store.get(this.serviceId);if(!service||this.stopped||this.blocked())return;
    const target=policy.probeTargets?.find(t=>t.id===service.targetId&&t.environmentId===service.environmentId);if(!target)return;
    const task=this.store.recovery.claim(service,sample,targetFingerprint(target));if(!task)return;
    try{
      let diagnostics:NonNullable<RecoveryTask['diagnostics']>;try{diagnostics=await this.executor.diagnostics();}catch{diagnostics={available:false,codes:[]};}
      this.store.recovery.diagnostics(task.id,diagnostics);
      // Recheck authorization and controls after asynchronous log collection, just before side effects.
      const currentPolicy=await this.policy();const current=this.store.get(this.serviceId);const currentTarget=currentPolicy.probeTargets?.find(t=>t.id===current?.targetId&&t.environmentId===current.environmentId);
      if(this.stopped||!current?.enabled||current.version!==service.version||!currentTarget||targetFingerprint(currentTarget)!==targetFingerprint(target)||!this.store.recovery.policy(this.serviceId).enabled||this.blocked()) {this.store.recovery.finish(task.id,'canceled','重启前配置、授权或维护状态发生变化，已取消');return;}
      await this.executor.restart();
      if(!await this.executor.healthy(currentTarget))throw new Error('health confirmation failed');
      this.store.recovery.finish(task.id,'succeeded','已执行重启，容器与 HTTP 健康检查通过');
    }catch{this.store.recovery.finish(task.id,'unknown','执行失败、超时或健康检查未通过；自动重启已锁定，请核对');}
  }
  simulate(id:string,actor:string){
    if(this.mode!=='demo'||this.stopped)throw new RecoveryConflict('仅演示可模拟故障');
    if(this.simulations.has(id))return;
    if(this.simulation?.status==='running')throw new RecoveryConflict('故障演示正在采样，请等待');
    if(this.simulations.size>=100)throw new RecoveryConflict('本次演示已达请求上限，请重启演示服务');
    this.store.recovery.simulated(this.serviceId,id,actor);
    const state={id,status:'running',completed:0};this.simulation=state;this.simulations.set(id,state);
    const work=(async()=>{try{while(state.completed<3&&!this.stopped){
      await delay(100,undefined,{signal:this.demoAbort.signal});
      const service=this.store.get(this.serviceId);const policy=await this.policy();const target=policy.probeTargets?.find(t=>t.id===service?.targetId&&t.environmentId===service.environmentId);
      if(!service?.enabled||!target)throw Error('demo disabled');
      if(!this.store.probeDue(service)){await delay(1000,undefined,{signal:this.demoAbort.signal});continue;}
      const probeId=randomUUID();if(!this.store.claimProbe(service,probeId,targetFingerprint(target),'system:collector','demo-simulation'))continue;
      this.store.finishProbe(probeId,{outcome:'http_error',httpStatus:503,latencyMs:2});state.completed++;this.observe(this.store.getProbe(probeId)!);
    }state.status='completed';}catch{state.status='stopped';}})().finally(()=>this.work.delete(work));this.work.add(work);
  }
  snapshot(){const active=this.store.recovery.active();return {...this.store.recovery.policy(this.serviceId),mode:this.mode,threshold:3,cooldownSeconds:600,maxPerHour:3,...this.store.recovery.budget(this.serviceId),blockedByMaintenance:this.blocked(),active:active?.serviceId===this.serviceId?active:null,tasks:this.store.recovery.list(this.serviceId),simulation:this.mode==='demo'?this.simulation:null,asOf:Date.now()};}
  reconcile(actor:string,id:string){const task=this.store.recovery.get(id);if(task?.serviceId===this.serviceId&&task.status==='resolved')return task;if(!task||task.serviceId!==this.serviceId||task.status!=='unknown')throw new RecoveryConflict('任务状态已变化，请刷新后核对');return this.store.recovery.finish(task.id,'resolved','管理员确认执行已停止并核对网站状态，解除自动重启锁定',actor);}
  async settled(){while(this.work.size)await Promise.all([...this.work]);}
  async close(){this.stopped=true;this.demoAbort.abort();await this.settled();}
}

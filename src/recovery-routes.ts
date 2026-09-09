import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServiceStore } from "./service-store.js";
import type { Authorization } from "./service-routes.js";
import type { RecoveryManager } from "./recovery-manager.js";
import { RecoveryConflict } from "./recovery-store.js";
export async function registerRecoveryRoutes(app:FastifyInstance,store:ServiceStore,authorize:Authorization,manager?:RecoveryManager){
 const path='/api/v1/services/:id/recovery';
 app.get<{Params:{id:string}}>(path,async(request,reply)=>{const context=await authorize(request,reply);if(!context)return;const service=store.get(request.params.id);if(!service||!context.grant.environmentIds.includes(service.environmentId))return reply.code(404).send({message:'服务不存在或无权访问'});return manager?.serviceId===service.id?{available:true,...manager.snapshot()}:{available:false,message:'自动重启执行器尚未配置，故障日志仍会保存'};});
 for(const action of ['configure','reconcile','simulate'] as const)app.post<{Params:{id:string}}>(path+'/'+action,async(request,reply)=>{
  const context=await authorize(request,reply);if(!context)return;if(context.grant.role!=='admin')return reply.code(403).send({message:'仅管理员可管理自动重启'});
  const service=store.get(request.params.id);if(!service||!context.grant.environmentIds.includes(service.environmentId))return reply.code(404).send({message:'服务不存在或无权访问'});
  if(manager?.serviceId!==service.id)return reply.code(409).send({message:'此服务没有配置自动重启执行器'});
  try{
   if(action==='configure'){const body=z.object({enabled:z.boolean(),version:z.number().int().min(0),idempotencyKey:z.uuid(),reason:z.string().trim().min(1).max(500)}).strict().safeParse(request.body);if(!body.success)return reply.code(400).send({message:'请填写启用状态、版本和变更原因'});const b=body.data;store.recovery.configure(service.id,b.enabled,b.version,b.idempotencyKey,context.principal.userId,b.reason);}
   if(action==='reconcile'){const body=z.object({executionStopped:z.literal(true),taskId:z.uuid()}).strict().safeParse(request.body);if(!body.success)return reply.code(400).send({message:'请先确认执行已停止并核对网站状态'});manager.reconcile(context.principal.userId,body.data.taskId);}
   if(action==='simulate'){const body=z.object({idempotencyKey:z.uuid()}).strict().safeParse(request.body);if(!body.success||manager.mode!=='demo')return reply.code(400).send({message:'仅演示环境允许模拟故障'});manager.simulate(body.data.idempotencyKey,context.principal.userId);}
   return {available:true,...manager.snapshot()};
  }catch(error){return reply.code(error instanceof RecoveryConflict?409:503).send({message:error instanceof RecoveryConflict?error.message:'操作暂未完成，请刷新状态后核对'});}
 });
}

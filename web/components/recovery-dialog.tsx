"use client";
import { useEffect,useRef,useState } from "react";
import { api,ApiError } from "./api";
import { Dialog } from "./dialog";
import { Button,Notice } from "./ui";
import { requestId } from "./request-id";
import type { RecoveryTask } from "../../src/recovery-store";
type Data={available:boolean;message?:string;enabled:boolean;version:number;mode:'demo'|'docker';asOf:number;cooldownUntil:number;attemptsLastHour:number;blockedByMaintenance:boolean;active:RecoveryTask|null;tasks:RecoveryTask[];simulation:{status:string;completed:number}|null};
const statuses={running:'执行中',succeeded:'重启健康检查通过',unknown:'结果待核对',canceled:'已取消',resolved:'已人工核对'};
const time=(v:number)=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
export function RecoveryDialog({serviceId,serviceName,role,onClose,onUnauthorized}:{serviceId:string;serviceName:string;role:string;onClose:()=>void;onUnauthorized:()=>void}){
 const [data,setData]=useState<Data|null>(null);const [loading,setLoading]=useState(true);const [revision,setRevision]=useState(0);const [error,setError]=useState('');const [message,setMessage]=useState('');const [reason,setReason]=useState('');const [action,setAction]=useState<'configure'|'reconcile'|null>(null);const [discard,setDiscard]=useState(false);const [busy,setBusy]=useState(false);const [now,setNow]=useState(Date.now());
 const auth=useRef(onUnauthorized);auth.current=onUnauthorized;const pending=useRef(false);const changeKey=useRef<{body:string;id:string}|null>(null);const simulationKey=useRef<string|null>(null);const reasonRef=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{if(action||discard)return;const controller=new AbortController();setLoading(true);setError('');void api<Data>(`/services/${serviceId}/recovery`,{signal:controller.signal}).then(d=>{if(!controller.signal.aborted)setData(d);}).catch(err=>{if(controller.signal.aborted)return;setData(null);if(err instanceof ApiError&&[401,403].includes(err.status))auth.current();else setError(err instanceof Error?err.message:'自动重启状态读取失败');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[serviceId,revision,action,discard]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(loading||busy||action||discard)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')setRevision(v=>v+1);},5000);return()=>clearInterval(timer);},[loading,busy,action,discard]);
 useEffect(()=>{if(!reason)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[reason]);
 const close=()=>{if(pending.current)return;if(reason)setDiscard(true);else onClose();};
 async function submit(kind:'configure'|'reconcile'|'simulate'){
  if(!data||pending.current)return;if(kind==='configure'&&!reason.trim()){setError('请填写变更原因');reasonRef.current?.focus();return;}
  let payload:object;
  if(kind==='configure'){const value={enabled:!data.enabled,version:data.version,reason:reason.trim()};const body=JSON.stringify(value);if(changeKey.current?.body!==body)changeKey.current={body,id:requestId()};payload={...value,idempotencyKey:changeKey.current.id};}
  else if(kind==='simulate'){simulationKey.current??=requestId();payload={idempotencyKey:simulationKey.current};}else payload={executionStopped:true,taskId:data.active?.id};
  pending.current=true;setBusy(true);setError('');
  try{const result=await api<Data>(`/services/${serviceId}/recovery/${kind}`,{method:'POST',body:JSON.stringify(payload)});setData(result);setReason('');setAction(null);changeKey.current=null;if(kind==='simulate')simulationKey.current=null;setMessage(kind==='simulate'?'故障演示已开始，按 30 秒间隔采样 3 次，约需 1 分钟。':'操作已保存，请查看最新状态。');}
  catch(err){if(err instanceof ApiError&&[401,403].includes(err.status))auth.current();else setError(err instanceof Error?err.message:'请求未确认，请重试或刷新核对');}finally{pending.current=false;setBusy(false);}
 }
 return <Dialog title={`${serviceName} · 自动重启`} onCancel={close}>{discard?<><p>未提交的变更原因将被丢弃。</p><div className="dialog-actions"><Button onClick={()=>setDiscard(false)}>继续编辑</Button><Button onClick={onClose}>放弃并关闭</Button></div></>:action&&data?<>
  <h3>{action==='configure'?(data.enabled?'停用自动重启':'启用自动重启'):'解除重启结果锁定'}</h3>{action==='configure'?<><p>连续 3 次服务端故障才触发。重启冷却 10 分钟，每小时最多 3 次，维护和发布期间暂停。</p><div className="maintenance-form"><label htmlFor="recovery-reason">变更原因</label><textarea ref={reasonRef} className="resize-none" id="recovery-reason" rows={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></div></>:<Notice>请先在部署环境确认重启命令已停止，并核对网站状态。解除锁定不会立即重启，之后仍需新的连续故障样本。</Notice>}{data.mode==='demo'&&<Notice>仅演示，不会重启真实 MedicalCareWeb。</Notice>}{error&&<Notice error>{error}</Notice>}<div className="dialog-actions"><Button disabled={busy} onClick={()=>{if(reason)setDiscard(true);else setAction(null);}}>返回</Button><Button className="primary" busy={busy} onClick={()=>void submit(action)}>{action==='configure'?'确认保存自动重启配置':'已确认执行停止并核对，解除锁定'}</Button></div>
 </>:<><p>5xx、超时或连接失败连续 3 次触发；4xx、无数据和采集中断不触发。先保存诊断，再重启受控容器并核验健康。</p>{error&&<Notice error>{error}</Notice>}{loading?<Notice>正在读取自动重启状态…</Notice>:data&&!data.available?<Notice>{data.message}</Notice>:data&&<>
  <Notice>{now-data.asOf>30000?'状态已过期，请刷新':data.enabled?'自动重启已启用':'自动重启未启用'} · 最近读取 {time(data.asOf)}（北京时间）</Notice>{data.mode==='demo'&&<Notice>隔离演示，重启和容器诊断均为模拟。真实执行器未接入此公开平台。</Notice>}
  <p>最近 1 小时已执行 {data.attemptsLastHour} / 3 次；冷却 {data.cooldownUntil>now?`至 ${time(data.cooldownUntil)}`:'已结束'}。</p>{data.blockedByMaintenance&&<Notice>当前维护中，自动重启暂停。</Notice>}{role==='admin'&&<div className="dialog-actions"><Button onClick={()=>{setError('');setAction('configure');}}>{data.enabled?'停用自动重启':'启用自动重启'}</Button>{data.mode==='demo'&&<Button busy={busy} disabled={data.simulation?.status==='running'} onClick={()=>void submit('simulate')}>模拟连续故障</Button>}</div>}{data.simulation&&<p>故障演示：{data.simulation.completed} / 3 次采样 · {data.simulation.status==='running'?'进行中':data.simulation.status==='completed'?'已完成':'已停止'}</p>}
  {message&&<Notice>{message}</Notice>}<h3>最近重启记录</h3>{!data.tasks.length?<Notice>暂无自动重启记录。未启用、维护中、冷却或样本不足时不会执行。</Notice>:<ul className="alert-events">{data.tasks.map(task=><li key={task.id}><strong>{statuses[task.status]}</strong><p>{time(task.createdAt)} · 北京时间</p><p>{task.message}</p><p>重启前诊断：{task.diagnostics?.available?(task.diagnostics.codes.join('、')||'未发现可保留的错误代码'):'未取得容器诊断；探测故障日志仍保留'}</p></li>)}</ul>}{data.active?.status==='unknown'&&role==='admin'&&<Button onClick={()=>{setError('');setAction('reconcile');}}>核对并解除锁定</Button>}
 </>}<div className="dialog-actions"><Button busy={loading} onClick={()=>setRevision(v=>v+1)}>刷新自动重启状态</Button><Button onClick={close}>关闭自动重启</Button></div></>}</Dialog>;
}

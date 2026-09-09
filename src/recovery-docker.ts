import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RecoveryExecutor } from "./recovery-manager.js";
import { probeTarget } from "./probe.js";
const exec=promisify(execFile);
export function summarizeContainerErrors(text:string){const codes=[...new Set(text.match(/\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENOMEM|ENOSPC|EACCES|TypeError|ReferenceError|SyntaxError|RangeError|PrismaClientKnownRequestError|PrismaClientInitializationError|FATAL|PANIC)\b/g)??[])];return {available:true,codes};}
export function dockerRecoveryExecutor(containers:readonly ('medicalcare-app'|'medicalcare-chat')[],run=async(args:string[],timeout:number)=>{const result=await exec('docker',args,{timeout,maxBuffer:262144,windowsHide:true});return result.stdout+'\n'+result.stderr;}):RecoveryExecutor{
 if(!containers.length||containers.length>2||containers.some(c=>!['medicalcare-app','medicalcare-chat'].includes(c))||new Set(containers).size!==containers.length)throw Error('Unapproved restart target');
 return {
  async diagnostics(){const logs=await Promise.all(containers.map(c=>run(['logs','--since','5m','--tail','100',c],10000)));return summarizeContainerErrors(logs.join('\n'));},
  async restart(){await run(['restart','--time','10',...containers],45000);},
  async healthy(target){const deadline=Date.now()+120000;do{const results=await Promise.all(containers.map(c=>run(['inspect','--format','{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',c],5000)));if(results.every(s=>s.trim()==='true|healthy')&&(await probeTarget(target)).outcome==='success')return true;await new Promise(r=>setTimeout(r,2000));}while(Date.now()<deadline);return false;}
 };
}

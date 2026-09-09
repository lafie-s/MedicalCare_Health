import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ServiceStore } from "../src/service-store.js";
import { safeDiagnostic } from "../src/failure-log-store.js";
test("failure logs survive sample pruning, deduplicate and do not retain arbitrary error messages", (t) => {
 const store = new ServiceStore(":memory:");t.after(()=>store.close());
 const service=store.create(randomUUID(),"local",{name:"site",owner:"ops",targetId:"target",intervalSeconds:30},"ops","r");
 const at=Date.now()-2*86400000;const id=randomUUID();store.claimProbe(service,id,"fingerprint","system:collector","r",at);
 store.finishProbe(id,{outcome:"connection_error",httpStatus:null,latencyMs:null,diagnosticCode:"secret patient message"},at+1);
 store.finishProbe(id,{outcome:"timeout",httpStatus:null,latencyMs:null},at+2);store.pruneProbes();
 const logs=store.failureLogs.list(service.id,1);assert.equal(logs.total,1);assert.equal(logs.items[0]!.diagnosticCode,"CONNECTION_FAILED");assert.equal(store.getProbe(id),null);
 assert.equal(safeDiagnostic("ECONNREFUSED"),"ECONNREFUSED");assert.equal(JSON.stringify(logs).includes("secret"),false);
 store.failureLogs.prune(at+31*86400000);assert.equal(store.failureLogs.list(service.id,1).total,0);
});

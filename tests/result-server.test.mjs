import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer} from '../server.mjs';
import {weekChanged} from '../lib/domain.mjs';
import {calendarEntries,makeResultCsv} from '../lib/calendar.mjs';

test('results persist via real local HTTP and SQLite without changing frozen plan, survive restart and replay',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'field-results-'));await mkdir(join(dir,'public'));await writeFile(join(dir,'public/index.html'),'local test');
 let app,url;async function start(){app=createServer({dbPath:join(dir,'state.sqlite'),staticDir:join(dir,'public')});app.listen(0,'127.0.0.1');await once(app,'listening');url='http://127.0.0.1:'+app.address().port;}
 async function stop(){if(app?.listening)await new Promise((res,rej)=>app.close(e=>e?rej(e):res()));}
 t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});await start();
 const get=()=>fetch(url+'/api/state').then(r=>r.json());
 const post=async c=>{const r=await fetch(url+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:JSON.stringify(c)});return {status:r.status,body:await r.json()};};
 let state=await get(),seq=0;const week='2000-01-03';
 async function command(c){const r=await post({...c,requestId:'result-http-'+(++seq),expectedRevision:state.revision});assert.equal(r.status,200,JSON.stringify(r.body));state=r.body.state;return state;}
 await command({type:'addMember',name:'예시 검증 담당'});await command({type:'submit',week,submitterId:state.members[0].id,sourceText:'예시 HTTP 원문',items:[{task:'예시 작업',date:week,time:'오전',place:'예시 포장',assignees:['예시 검증 담당'],reviewed:true}]});await command({type:'finalize',week});
 const before=structuredClone(state),id=state.plans[0].id;
 const envelope={type:'recordResult',id,result:{status:'done',date:'2000-01-04',summary:'예시 실제 결과',recorder:'예시 검증 담당'},requestId:'exact-result-replay',expectedRevision:state.revision};
 let response=await post(envelope);assert.equal(response.status,200);state=response.body.state;assert.deepEqual(await get(),state);assert.deepEqual(state.snapshots,before.snapshots);assert.equal(weekChanged(state,week),false);
 const saved=structuredClone(state);await stop();await start();assert.deepEqual(await get(),saved);response=await post(envelope);assert.equal(response.status,200);assert.deepEqual(response.body.state,saved);
 assert.equal((await post({...envelope,result:{...envelope.result,summary:'변경된 재시도'}})).status,409);assert.deepEqual(await get(),saved);
 assert.equal((await post({...envelope,requestId:'future-reject',expectedRevision:state.revision,result:{...envelope.result,date:'9999-12-31'}})).status,422);assert.deepEqual(await get(),saved);
 await command({type:'editPlan',id,patch:{task:'변경된 계획 (예시)'}});assert.equal(calendarEntries(state,{mode:'results'})[0].task,'예시 작업');
 await command({type:'recordResult',id,result:{status:'partial',date:'2000-01-05',summary:'예시 수정 결과',recorder:'예시 다른 담당'}});assert.equal(state.history.at(-1).before.result.summary,'예시 실제 결과');
 await command({type:'cancelPlan',id,cancelled:true});assert.equal(calendarEntries(state,{mode:'plans'}).length,0);const entries=calendarEntries(state,{mode:'results'});assert.equal(entries.length,1);assert.equal(entries[0].cancelled,true);assert.match(makeResultCsv(entries),/예시 수정 결과/);
 const final=structuredClone(state);await stop();await start();assert.deepEqual(await get(),final);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, stat, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../server.mjs';

async function start(dbPath,staticDir) {
  const server=createServer({dbPath,staticDir});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port=server.address().port;
  return {server,port,url:`http://127.0.0.1:${port}`};
}
async function stop(server) { await new Promise((resolve,reject) => server.close(e => e?reject(e):resolve())); }
async function setup(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'weekly-plan-test-'));
  const staticDir=path.join(dir,'dist'); await mkdir(staticDir);
  await writeFile(path.join(staticDir,'index.html'),'<html>local draft</html>');
  await writeFile(path.join(staticDir,'app.js'),'console.log("draft")');
  const dbPath=path.join(dir,'private','plans.sqlite');
  const runtime=await start(dbPath,staticDir);
  t.after(async()=> {if(runtime.server.listening) await stop(runtime.server); await rm(dir,{recursive:true,force:true});});
  return {...runtime,dir,staticDir,dbPath};
}
function rawRequest(port,{method='GET',url='/api/state',headers={},body=''}={}) {
  return new Promise((resolve,reject)=> {
    const req=http.request({host:'127.0.0.1',port,path:url,method,headers},res=> {
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
    }); req.on('error',reject); req.end(body);
  });
}
const add = (name,requestId,expectedRevision) => ({type:'addMember',name,requestId,expectedRevision});
async function post(runtime,body,headers={}) { return rawRequest(runtime.port,{method:'POST',url:'/api/commands',headers:{'content-type':'application/json',origin:runtime.url,...headers},body:typeof body === 'string'?body:JSON.stringify(body)}); }

test('real HTTP writes SQLite, private database reopens with exact state and durable receipts', async t=> {
  const app=await setup(t);
  const initial=await fetch(`${app.url}/api/state`).then(r=>r.json()); assert.equal(initial.revision,0);
  const command=add('예시 저장','persist-1',0);
  const saved=await post(app,command); assert.equal(saved.status,200);
  const state=JSON.parse(saved.text).state; assert.equal(state.members[0].name,'예시 저장');
  assert.deepEqual(await fetch(`${app.url}/api/state`).then(r=>r.json()),state);
  assert.equal((await readFile(app.dbPath)).subarray(0,16).toString(),'SQLite format 3\u0000');
  assert.equal((await stat(app.dbPath)).mode & 0o777,0o600);
  await stop(app.server);
  const reopened=await start(app.dbPath,app.staticDir);t.after(()=>stop(reopened.server));
  assert.deepEqual(await fetch(`${reopened.url}/api/state`).then(r=>r.json()),state);
  const replay=await post(reopened,command);assert.equal(replay.status,200);assert.deepEqual(JSON.parse(replay.text).state,state);
  assert.equal((await post(reopened,{...command,name:'변조'})).status,409);
  assert.equal((await post(reopened,add('경합','persist-2',0))).status,409);
});

test('full plan workflow persists source, snapshots and atomic failed batches through HTTP', async t=> {
  const app=await setup(t);
  let state=JSON.parse((await post(app,add('예시 제출자','flow-1',0))).text).state;
  const week='2026-10-05';
  const item={date:week,time:'오전',place:'시험포장',task:'시료 채취',assignees:['예시 제출자'],notes:'',reviewed:true};
  const submit={type:'submit',requestId:'flow-2',expectedRevision:state.revision,week,submitterId:state.members[0].id,sourceText:'보존할 원문',items:[item,{...item,date:'2026-10-12'}]};
  assert.equal((await post(app,submit)).status,422);
  assert.deepEqual(await fetch(`${app.url}/api/state`).then(r=>r.json()),state);
  state=JSON.parse((await post(app,{...submit,items:[item]})).text).state;
  const id=state.plans[0].id;
  state=JSON.parse((await post(app,{type:'finalize',requestId:'flow-3',expectedRevision:state.revision,week})).text).state;
  assert.equal(state.snapshots[0].plans[0].task,'시료 채취');
  state=JSON.parse((await post(app,{type:'editPlan',requestId:'flow-4',expectedRevision:state.revision,id,patch:{task:'수분 조사'}})).text).state;
  assert.equal(state.plans[0].sourceText,'보존할 원문');
  assert.equal(state.snapshots[0].plans[0].task,'시료 채취');
  assert.equal(state.history.at(-1).before.task,'시료 채취');
  assert.equal(state.history.at(-1).after.task,'수분 조사');
  state=JSON.parse((await post(app,{type:'cancelPlan',requestId:'flow-5',expectedRevision:state.revision,id,cancelled:true})).text).state;
  state=JSON.parse((await post(app,{type:'noWork',requestId:'flow-6',expectedRevision:state.revision,week,memberId:state.members[0].id})).text).state;
  await stop(app.server);
  const reopened=await start(app.dbPath,app.staticDir);t.after(()=>stop(reopened.server));
  assert.deepEqual(await fetch(`${reopened.url}/api/state`).then(r=>r.json()),state);
});

test('malformed commands, bodies and content types do not change state; payload limit is enforced', async t=> {
  const app=await setup(t);
  assert.equal((await post(app,'{broken')).status,400);
  assert.equal((await post(app,add('','bad-1',0))).status,422);
  assert.equal((await post(app,add('예시','bad-2',0),{'content-type':'text/plain'})).status,415);
  assert.equal((await post(app,'x'.repeat(131073))).status,413);
  assert.equal((await post(app,'x'.repeat(131073),{'transfer-encoding':'chunked'})).status,413);
  assert.equal((await post(app,add('예시','bad-3',0),{'content-encoding':'gzip'})).status,415);
  const state=await fetch(`${app.url}/api/state`).then(r=>r.json());assert.equal(state.revision,0);assert.deepEqual(state.members,[]);
});

test('Host/Origin guards reject DNS rebinding, cross-site and null origins without CORS', async t=> {
  const app=await setup(t);
  for(const headers of [{host:`evil.test:${app.port}`},{host:'127.0.0.1:1'},{origin:'https://evil.test'},{origin:'null'},{origin:`http://localhost:${app.port}`}]) {
    const res=await rawRequest(app.port,{headers});assert.equal(res.status,403);assert.equal(res.headers['access-control-allow-origin'],undefined);
  }
  assert.equal((await rawRequest(app.port,{headers:{host:`localhost:${app.port}`,origin:`http://localhost:${app.port}`}})).status,200);
  assert.equal((await rawRequest(app.port)).status,200);
  assert.equal((await rawRequest(app.port,{method:'OPTIONS',url:'/api/commands'})).status,405);
});

test('health is honest, static assets exact, path traversal and symlink exposure blocked', async t=> {
  const app=await setup(t);
  assert.deepEqual(await fetch(`${app.url}/api/health`).then(r=>r.json()),{ok:true,mode:'local-draft',kakaoConnected:false,aiConnected:false});
  assert.equal((await fetch(app.url).then(r=>r.text())),'<html>local draft</html>');
  assert.equal((await fetch(`${app.url}/app.js`)).status,200);
  assert.equal((await fetch(`${app.url}/missing.js`)).status,404);
  assert.equal((await fetch(`${app.url}/api/missing`)).status,404);
  await writeFile(path.join(app.dir,'secret.txt'),'outside');
  await symlink(path.join(app.dir,'secret.txt'),path.join(app.staticDir,'linked.txt'));
  for(const url of ['/../secret.txt','/%2e%2e/secret.txt','/linked.txt','/%00','/.hidden','/..%2fsecret.txt']) {
    const res=await rawRequest(app.port,{url});assert.ok([400,403,404].includes(res.status),`${url}: ${res.status}`);assert.equal(res.text.includes('outside'),false);
  }
  const head=await rawRequest(app.port,{method:'HEAD',url:'/app.js'});assert.equal(head.status,200);assert.equal(head.text,'');
});

test('concurrent revision commands serialize and exactly one is accepted', async t=> {
  const app=await setup(t);
  const results=await Promise.all([post(app,add('예시 A','race-a',0)),post(app,add('예시 B','race-b',0))]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  const state=await fetch(`${app.url}/api/state`).then(r=>r.json());assert.equal(state.revision,1);assert.equal(state.members.length,1);
});

test('two server instances sharing SQLite cannot overwrite a newer revision', async t=> {
  const app=await setup(t);
  const second=await start(app.dbPath,app.staticDir);t.after(()=>stop(second.server));
  assert.equal((await post(app,add('예시 첫째','shared-a',0))).status,200);
  assert.equal((await post(second,add('예시 둘째','shared-b',0))).status,409);
  assert.equal((await post(second,add('예시 둘째','shared-c',1))).status,200);
  const firstState=await fetch(`${app.url}/api/state`).then(r=>r.json());
  const secondState=await fetch(`${second.url}/api/state`).then(r=>r.json());
  assert.deepEqual(firstState,secondState);
  assert.equal(firstState.members.length,2);
});

test('library server refuses public listening addresses', async t=> {
  const dir=await mkdtemp(path.join(os.tmpdir(),'weekly-plan-bind-'));
  const server=createServer({dbPath:path.join(dir,'state.sqlite'),staticDir:dir});
  t.after(async()=> {await stop(server);await rm(dir,{recursive:true,force:true});});
  assert.throws(()=>server.listen(0,'0.0.0.0'),/127\.0\.0\.1|로컬/);
  server.listen(0,'127.0.0.1');await once(server,'listening');
});

import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import http from 'node:http';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('artifacts/public-demo');await mkdir(out,{recursive:true});
const CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'none'";
let server,base=process.env.DEMO_URL;
if(!base){server=http.createServer(async(req,res)=>{res.setHeader('Content-Security-Policy',CSP);res.setHeader('Cache-Control','no-store');const map={'/':['index.html','text/html'],'/assets/main.js':['assets/main.js','text/javascript'],'/assets/main.css':['assets/main.css','text/css'],'/fonts/PretendardVariable.woff2':['fonts/PretendardVariable.woff2','font/woff2'],'/robots.txt':['robots.txt','text/plain']};const f=map[req.url?.split('?')[0]];if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}if(!f){res.writeHead(404);res.end();return;}try{res.setHeader('Content-Type',f[1]);res.end(req.method==='HEAD'?undefined:await readFile(resolve('dist-demo',f[0])));}catch{res.writeHead(500);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',args:['--no-sandbox','--disable-dev-shm-usage']});
const report={url:base,checks:[],requests:[],errors:[]};
function check(label,value=true){assert.ok(value,label);report.checks.push(label);}
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await context.addInitScript(()=>{
 const get=Storage.prototype.getItem;const set=Storage.prototype.setItem;
 set.call(localStorage,'weekly-field-plan-draft-v1','PRIVATE_SENTINEL_NOT_TO_LOAD');
 window.__storeCalls=[];window.__getStoredSentinel=()=>get.call(localStorage,'weekly-field-plan-draft-v1');
 for(const key of ['getItem','setItem','removeItem','clear'])Storage.prototype[key]=function(){window.__storeCalls.push(key);throw Error('Demo attempted persistent storage '+key);};
 for(const key of ['open','deleteDatabase'])indexedDB[key]=()=>{window.__storeCalls.push('indexedDB');throw Error('Demo attempted IndexedDB');};
});
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>report.requests.push({url:r.url(),method:r.method()}));
async function nav(name){await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:new RegExp('^'+name)}).click();}
try{
 const response=await page.goto(base);check('anonymous page 200',response.status()===200);
 await page.locator('.plan-row').first().waitFor();check('two synthetic plans loaded automatically',await page.locator('.plan-row').count()===2);check('visible non-persistence warning',(await page.locator('.draft-banner').innerText()).includes('새로고침하면 초기화'));
 check('no private persisted data rendered',!(await page.locator('body').innerText()).includes('PRIVATE_SENTINEL'));
 await nav('제출 현황');for(const label of ['제출 완료','확인 필요','작업 없음','미제출'])check('example status '+label,await page.locator('.submission-row').getByText(label,{exact:true}).isVisible());
 await nav('주간 계획');await page.locator('.plan-row').filter({hasText:'토양 시료 채취'}).click();await page.getByRole('button',{name:'수정',exact:true}).click();await page.getByRole('dialog').getByLabel('포장',{exact:true}).fill('시험포장 B');await page.getByRole('dialog').getByLabel('시간',{exact:true}).fill('오전 10시');await page.getByRole('button',{name:'수정 저장'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});check('edit shown in memory',(await page.locator('.plan-row').filter({hasText:'토양 시료 채취'}).innerText()).includes('오전 10시'));
 await nav('취합·공지');await page.getByRole('button',{name:'현재 취합 확정'}).click();await page.getByRole('button',{name:'확정본 저장'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});check('freeze example workflow completed',await page.getByRole('button',{name:'마지막 확정본',exact:true}).isVisible());
 for(const [button,name] of [['현재 계획 CSV','example.csv'],['공지문 TXT','example.txt']]){const event=page.waitForEvent('download');await page.getByRole('button',{name:button}).click();await(await event).saveAs(out+'/'+name);check('real download '+name,(await readFile(out+'/'+name,'utf8')).includes('오전 10시'));}
 await nav('주간 계획');await page.locator('.plan-row').filter({hasText:'제초'}).click();await page.getByRole('button',{name:'계획 취소',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'계획 취소',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});check('cancel simulation',await page.locator('.plan-row').count()===1);
 check('no persistent storage touched before reload',(await page.evaluate(()=>__storeCalls)).length===0);check('existing private localStorage untouched',await page.evaluate(()=>__getStoredSentinel())==='PRIVATE_SENTINEL_NOT_TO_LOAD');
 const fresh=await browser.newContext();const other=await fresh.newPage();await other.goto(base);await other.locator('.plan-row').first().waitFor();check('another visitor has independent default state',await other.locator('.plan-row').count()===2 && !(await other.locator('.plan-row').filter({hasText:'토양 시료 채취'}).innerText()).includes('오전 10시'));await fresh.close();
 await page.getByRole('button',{name:'예시 처음으로',exact:true}).click();await page.locator('.plan-row').first().waitFor();check('reload restores two original examples',await page.locator('.plan-row').count()===2);check('edit does not survive reload',!(await page.locator('.plan-row').filter({hasText:'토양 시료 채취'}).innerText()).includes('오전 10시'));
 await page.getByRole('button',{name:'계획 입력',exact:true}).click();await page.getByRole('dialog').getByLabel('제출자',{exact:true}).selectOption({label:'예시 연구원 가'});await page.getByLabel('카톡 계획 원문',{exact:true}).fill('금요일 오후 / 시험포장 C / 물주기 체험 / 담당: 예시 연구원 가');await page.getByRole('button',{name:'항목으로 정리'}).click();await page.getByRole('button',{name:'확인한 계획 저장'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});check('new plan simulation',await page.locator('.plan-row').count()===3);await page.reload();await page.locator('.plan-row').first().waitFor();check('new plan discarded on reload',await page.locator('.plan-row').count()===2);
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});for(const route of ['주간 계획','제출 현황','취합·공지','취합 대상']){await nav(route);check(`no overflow ${width} ${route}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}await nav('주간 계획');if(width===1440||width===390)await page.screenshot({path:out+'/'+(process.env.DEMO_URL?'live':'local')+'-'+width+'.png',fullPage:true});}
 check('zero app API calls',!report.requests.some(r=>new URL(r.url).pathname.startsWith('/api/')));check('no POST or other writes',report.requests.every(r=>r.method==='GET'));check('no storage calls',(await page.evaluate(()=>__storeCalls)).length===0);check('no errors',report.errors.length===0);
 for(const path of ['/api/state','/api/health','/data/weekly-field-plan.sqlite','/server.mjs','/.env']){const r=await context.request.get(base+path);check('private endpoint unavailable '+path,r.status()===404);}
 check('mutation endpoint disabled',(await context.request.post(base+'/api/commands',{data:{type:'loadExample'}})).status()===405);
 report.pass=true;report.count=report.checks.length;await writeFile(out+'/'+(process.env.DEMO_URL?'live':'local')+'-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:true,count:report.count,errors:report.errors,url:base}));
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}

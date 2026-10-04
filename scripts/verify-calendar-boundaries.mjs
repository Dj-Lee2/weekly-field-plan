import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const repo=resolve('.');
const worker=resolve('lib/calendar.mjs');
const out=resolve('artifacts/calendar');
for(const file of ['src/calendar.jsx','src/main.jsx','src/calendar.css'])await transform(await readFile(repo+'/'+file,'utf8'),{loader:file.endsWith('jsx')?'jsx':'css'});
const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {WorkCalendar} from '${repo}/src/calendar.jsx';import {koreaToday} from '${worker}';const date=koreaToday();const original={date,time:'',task:'가상 검증 작업',place:'예전 포장',assignees:['예전 담당']};const plan={...original,id:'synthetic',week:date,place:'변경 포장',assignees:['변경 담당'],result:{status:'done',date,summary:'가상 결과',recorder:'가상 기록자',planSnapshot:original}};const plans=[plan,...[1,2,3].map(i=>({...original,id:'synthetic'+i,task:'미기록 가상 작업'+i}))];createRoot(document.getElementById('root')).render(<WorkCalendar state={{plans,history:[]}} onCommand={()=>{}} onOpenPlan={()=>{}} onResult={()=>{}} onAddPlan={()=>{}}/>);`;
const output=await build({stdin:{contents:fixture,loader:'jsx',resolveDir:repo},bundle:true,format:'iife',write:false,outfile:out+'/probe.js',nodePaths:[resolve('node_modules')],plugins:[{name:'readonly-contract-alias',setup(b){b.onResolve({filter:/\/calendar\.mjs$/},a=>({path:worker}));b.onResolve({filter:/^\.\/store\.mjs$/},()=>({path:'store',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const publicDemo=false;'}));}}]});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
await page.setContent('<div id="root"></div>');await page.addStyleTag({content:await readFile(repo+'/src/style.css','utf8')});for(const f of output.outputFiles.filter(f=>f.path.endsWith('.css')))await page.addStyleTag({content:f.text});await page.addScriptTag({content:output.outputFiles.find(f=>f.path.endsWith('.js')).text});await page.locator('.calendar-record').first().waitFor();
const styles={};for(const selector of ['.outcome-badge.no-result','.month-tile.heat-3 .tile-date'])styles[selector]=await page.locator(selector).first().evaluate(e=>{const s=getComputedStyle(e),p=getComputedStyle(e.closest('.month-tile')||e);return {color:s.color,background:p.backgroundColor,fontSize:s.fontSize,fontWeight:s.fontWeight};});
await page.getByRole('group',{name:'달력 표시 자료'}).getByRole('button',{name:'계획',exact:true}).click();
const options={people:await page.getByLabel('달력 담당자').locator('option').allTextContents(),places:await page.getByLabel('달력 포장').locator('option').allTextContents(),visiblePlanMeta:await page.locator('.record-meta').allTextContents()};
const result={scope:'고정 UI 소스 + 병렬 도메인 계약 모듈 + 합성 fixture, 운영/저장소 접근 없음',syntax:'JSX 2개 및 CSS 구문 통과',tiles:await page.locator('.month-tile').count(),options,styles,errors};
assert.ok(options.people.includes('변경 담당'));assert.ok(options.places.includes('변경 포장'));assert.equal(errors.length,0);await page.getByLabel('달력 담당자').selectOption('변경 담당');assert.equal(await page.locator('.calendar-record').count(),1);await page.getByLabel('달력 포장').selectOption('변경 포장');assert.equal(await page.locator('.calendar-record').count(),1);
function lum(rgb){const c=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
result.contrast={};for(const [k,v] of Object.entries(styles)){const l=[lum(v.color),lum(v.background)].sort((a,b)=>a-b);const ratio=(l[1]+.05)/(l[0]+.05);assert.ok(ratio>=4.5);result.contrast[k]=ratio;}result.pass=true;
await writeFile(out+'/ui-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}

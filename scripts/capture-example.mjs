import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const output=resolve('artifacts/screens');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium-browser',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:960}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(pathToFileURL(resolve('artifacts/주간포장계획_작동초안.html')).href);
 await page.getByRole('button',{name:'예시로 둘러보기',exact:true}).click();await page.getByRole('button',{name:'예시 불러오기',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('weekly-field-plan-draft-v1')));assert.equal(state.members.length,4);assert.equal(state.plans.length,2);assert.ok(state.members.every(x=>x.name.includes('예시')));
 await page.evaluate(()=>document.fonts.ready);await page.locator('.toast').waitFor({state:'hidden'});
 await page.screenshot({path:output+'/주간포장계획_PC.png',fullPage:true});
 await page.getByRole('navigation').getByRole('link',{name:'취합·공지',exact:true}).click();assert.ok(await page.getByRole('button',{name:'현재 취합 확정'}).isDisabled());await page.screenshot({path:output+'/주간포장계획_공지.png',fullPage:true});
 await page.getByRole('navigation').getByRole('link',{name:'주간 계획',exact:true}).click();await page.locator('.plan-row').filter({hasText:'토양 시료 채취'}).click();await page.screenshot({path:output+'/주간포장계획_원문확인.png',fullPage:true});
 await page.getByRole('button',{name:'상세 닫기'}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/주간포장계획_모바일.png',fullPage:true});
 await page.getByRole('button',{name:'계획 입력',exact:true}).click();await page.getByRole('button',{name:'예시 문장 넣기'}).click();await page.getByRole('button',{name:'항목으로 정리'}).click();assert.equal(await page.locator('.preview-item').count(),2);await page.screenshot({path:output+'/주간포장계획_입력.png',fullPage:true});
 assert.equal(errors.length,0);await writeFile(output+'/example-verification.json',JSON.stringify({pass:true,source:'loadExample explicitly synthetic',members:state.members.length,plans:state.plans.length,review_blocks_finalize:true,parse_preview_rows:2,errors},null,2));console.log('EXAMPLE_SCREENSHOTS_OK');
}finally{await context.close();await browser.close();}

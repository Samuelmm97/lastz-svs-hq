const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./qa-server.cjs');
const P=require('./placement-planner.js');
async function run(waitAt){
 const app=await startServer();let browser;
 try{
  browser=await chromium.launch();const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url+'/placement.html?edit=1&alliance=Helm');
  await page.waitForFunction(()=>state&&revision>0);
  await page.locator('#editorKey').fill('local-test-key');await page.locator('#connectEditor').click();
  await page.waitForFunction(()=>editorKey);
  const nextPlan=structuredClone(app.plan);nextPlan.planId='roster-refresh-during-preview';
  const nextDraft=P.exportDraft(P.create(nextPlan));
  let release,started;const gate=new Promise(r=>release=r),seen=new Promise(r=>started=r);
  await page.route('**/api/placement/plan?*',async route=>{
   if(waitAt==='metadata'){started();await gate;}
   return route.fulfill({json:{plan:nextPlan}});
  });
  await page.route('**/api/placement',async route=>{
   if(route.request().method()!=='GET')return route.continue();
   if(waitAt==='draft'){started();await gate;}
   return route.fulfill({json:{revision:app.shared.revision+1,draft:nextDraft,updatedBy:'Roster refresh'}});
  });
  await page.evaluate(()=>{globalThis.refreshFlight=loadShared(true);});await seen;
  await page.locator('#arrangeAlliance').click();await page.waitForFunction(()=>!!layoutPreview);
  const old=await page.evaluate(()=>state.signature);release();await page.evaluate(()=>globalThis.refreshFlight);
  await page.locator('#cancelLayout').click();
  assert.equal(errors.length,0,errors.join(' | '));
  assert((await page.evaluate(()=>state.signature))===old,'An in-flight refresh must not replace the preview base plan');
  assert.equal(app.saves,0);assert.doesNotMatch(await page.locator('#status').textContent(),/different base plan/);
  console.log(waitAt+': an in-flight roster refresh cannot invalidate layout preview/cancellation');
 }finally{await browser?.close();await new Promise(r=>app.server.close(r));}
}
(async()=>{await run('draft');await run('metadata');})().catch(e=>{console.error(e);process.exitCode=1});

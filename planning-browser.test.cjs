const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {startServer}=require('./qa-server.cjs');
(async()=>{const app=await startServer();let browser;try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url+'/placement.html?edit=1&alliance=Helm');await page.locator('#rows tr').first().waitFor();
 await page.locator('#editorKey').fill('local-test-key');await page.locator('#connectEditor').click();await page.locator('#status').filter({hasText:'Editing enabled'}).waitFor();
 await page.locator('#clearEveryone').click();await page.locator('#status').filter({hasText:'players moved to waiting'}).waitFor();
 assert(app.shared.draft.assignments.every(([,v])=>v===null));assert.equal(app.shared.draft.planningMode,true);assert.deepEqual(app.shared.draft.locks,[]);assert.deepEqual(app.shared.draft.pairs,[]);
 await page.locator('#boundaryWidth').fill('60');await page.locator('#saveBoundary').click();await page.locator('#status').filter({hasText:'Saved version'}).waitFor();
 await page.reload();await page.locator('#rows tr').first().waitFor();assert(await page.locator('#planningMode').isChecked());
 await page.locator('#arrangeAll').click();await page.locator('#layoutPreview').waitFor({state:'visible'});assert(await page.locator('#applyLayout').isEnabled());
 await page.locator('#applyLayout').click();await page.locator('#status').filter({hasText:'Alliance layout applied'}).waitFor();assert(app.shared.draft.assignments.some(([,v])=>v!==null));assert.deepEqual(errors,[]);
 console.log('Browser: everyone waiting, zone save, reload, all-wedge fill and apply passed');
}finally{await browser?.close();await new Promise(r=>app.server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

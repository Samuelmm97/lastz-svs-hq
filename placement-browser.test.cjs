const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {startServer}=require('./qa-server.cjs');
const P=require('./placement-planner.js');
(async()=>{
  const app=await startServer();let browser;
  const output=process.env.QA_OUTPUT||__dirname;
  fs.mkdirSync(output,{recursive:true});
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.url+'/placement.html?edit=1&alliance=Helm');
    await page.locator('#rows tr').first().waitFor();
    await page.locator('#editorKey').fill('local-test-key');await page.locator('#connectEditor').click();
    await page.locator('#status').filter({hasText:'Editing enabled'}).waitFor();
    await page.waitForFunction(expected=>revision===expected,app.shared.revision);
    // Preview is reversible, makes no writes, and shows both waiting and wedge diagnostics.
    const initial=structuredClone(app.shared.draft);
    await page.locator('#frontLayers').selectOption('2');await page.locator('#bodyGap').selectOption('2');
    await page.locator('#arrangeAlliance').click();
    await page.locator('#layoutPreview').waitFor({state:'visible'});
    assert.equal(app.saves,0);assert((await page.locator('#mapMode').innerText()).includes('UNSAVED'));
    assert((await page.locator('#layoutReport').innerText()).includes('waiting'));
    await page.screenshot({path:path.join(output,'capital-layout-preview.png')});
    await page.locator('#cancelLayout').click();
    assert.equal(app.saves,0);assert.deepEqual(app.shared.draft,initial);
    // Apply new tiles through the actual save payload + Worker validation, then reload.
    await page.locator('#frontLayers').selectOption('2');await page.locator('#bodyGap').selectOption('2');
    await page.locator('#arrangeAlliance').click();await page.locator('#applyLayout').click();
    await page.waitForFunction(()=>!document.getElementById('status').textContent.includes('Saving'));
    assert((await page.locator('#status').innerText()).includes('Alliance layout applied'),await page.locator('#status').innerText());
    assert.equal(app.saves,1);assert(app.shared.draft.sites.length>0);
    assert.equal(app.shared.draft.sections.Helm.frontLayers,2,'Saved front depth');
    const after=P.create(app.plan);P.importDraft(after,app.shared.draft);
    assert.equal(P.areaReport(after,'Helm').grassOutside,0);
    for(const [id,key] of initial.assignments)if(after.players.get(id).section!=='Helm'&&after.sites.get(key)?.zone==='mud')assert.equal(after.assignments.get(id),key);
    await page.reload();await page.locator('#rows tr').first().waitFor();
    await page.waitForFunction(expected=>editorKey==='local-test-key'&&revision===expected,app.shared.revision);
    assert.equal(await page.locator('#frontLayers').inputValue(),'2');assert.equal(await page.locator('#bodyGap').inputValue(),'2');
    // Select a player, reject the capital tile, then reserve an exact legal empty tile.
    await page.locator('#zone').selectOption('mud');await page.locator('#rows tr').first().click();
    assert.equal(await page.locator('#mapAction').inputValue(),'place');
    await page.locator('#targetX').fill('500');await page.locator('#targetY').fill('500');await page.locator('#findSite').click();
    assert((await page.locator('#status').innerText()).includes('buildable'));
    // Find a legal adjustment for the first displayed player using the production collision check.
    const firstName=(await page.locator('#selectedPlayer strong').innerText()).split(' · HQ')[0];
    const player=[...after.players.values()].find(p=>p.name===firstName);
    let target;
    for(let x=465;x<500&&!target;x++)for(let y=466;y<520&&!target;y++) {
      try {const key=P.defineSite(after,x,y);if(P.playerAt(after,key)!=null)continue;P.checkPlacement(after,player.id,key);target={x,y,key};}catch{}
    }
    assert(target,'No legal manual target found');
    await page.locator('#targetX').fill(String(target.x));await page.locator('#targetY').fill(String(target.y));await page.locator('#findSite').click();
    assert.equal(await page.locator('#lockPlayer').isEnabled(),true);
    assert((await page.locator('#gapWarning').innerText()).includes('would open'),'Manual target should warn about a newly exposed landing gap');
    await page.locator('#lockPlayer').click();await page.locator('#status').filter({hasText:'Saved version'}).waitFor();
    assert.equal(app.saves,2);assert(app.shared.draft.locks.includes(player.id));
    assert.equal(new Map(app.shared.draft.assignments).get(player.id),target.key);
    assert((await page.locator('#gapWarning').innerText()).includes('opened by the last move'));
    await page.screenshot({path:path.join(output,'capital-teleport-gap-warning.png')});
    await page.reload();await page.locator('#rows tr').first().waitFor();
    assert(app.shared.draft.sites.some(s=>`${s.x},${s.y}`===target.key)||P.create(app.plan).sites.has(target.key));
    // All-wedge preview handles competing alliances and keeps manual reservations.
    await page.locator('#zone').selectOption('');
    await page.locator('#arrangeGrass').click();await page.locator('#layoutPreview').waitFor({state:'visible'});
    assert((await page.locator('#layoutReport').innerText()).includes('All mud stays fixed'));
    assert((await page.locator('#existingGapInfo').innerText()).includes('All alliances and turret buffers are checked'));
    await page.locator('#cancelLayout').click();
    await page.locator('#arrangeAll').click();await page.locator('#layoutPreview').waitFor({state:'visible'});
    assert.equal(app.saves,2);await page.locator('#cancelLayout').click();
    // Narrow phone layout: no horizontal overflow, key controls and coordinates remain usable.
    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    mobile.on('pageerror',e=>errors.push(e.message));
    await mobile.goto(app.url+'/placement.html?edit=1&alliance=Helm');await mobile.locator('#rows tr').first().waitFor();
    assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Phone horizontal overflow');
    await mobile.locator('#frontLayers').scrollIntoViewIfNeeded();await mobile.screenshot({path:path.join(output,'capital-controls-mobile.png')});
    assert.equal(await mobile.locator('#targetX').count(),1);assert.equal(await mobile.locator('[data-nudge]').count(),4);
    await mobile.locator('#modeLink').click();await mobile.locator('#rows tr').first().waitFor();
    assert.equal(await mobile.locator('#editTools').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('Desktop + phone QA passed: preview/cancel/apply, exact placement, invalid targets, collision checks, reserved tiles, persistence, all wedges, view mode, no browser errors.');
  }finally{await browser?.close();await new Promise(resolve=>app.server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

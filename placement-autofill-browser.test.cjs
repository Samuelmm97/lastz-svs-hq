// Auto-fill grass QA: one map-toolbar click previews a grass-only repack, the on-map bar applies it,
// and the saved revision keeps every mud HQ and every reserved (manual) HQ exactly where it was.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {startServer}=require('./qa-server.cjs');
(async()=>{
  const app=await startServer();let browser;
  const output=process.env.QA_OUTPUT||__dirname;
  fs.mkdirSync(output,{recursive:true});
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.url+'/placement.html?edit=1');
    await page.waitForFunction(()=>typeof state!=='undefined'&&state&&revision>0);
    await page.locator('#editorKey').fill('local-test-key');
    await page.locator('#connectEditor').click();
    await page.locator('#status').filter({hasText:'Editing enabled'}).waitFor();
    // Reserve a mud HQ and a grass HQ by hand, then snapshot both.
    const pinned=await page.evaluate(()=>{
      const placed=[...state.assignments].filter(([id,key])=>key!=null&&!state.locks.has(id)).map(([id,key])=>[id,state.sites.get(key)]).filter(([,s])=>s);
      const mud=placed.find(([,s])=>s.zone==='mud'),grass=placed.find(([,s])=>s.zone==='grass');
      if(!mud||!grass)return null;
      state.locks.add(mud[0]);state.locks.add(grass[0]);render();
      return {mud:{id:mud[0],key:`${mud[1].x},${mud[1].y}`},grass:{id:grass[0],key:`${grass[1].x},${grass[1].y}`}};
    });
    assert(pinned,'fixture needs placed mud and grass HQs');
    const before=await page.evaluate(()=>({revision,saves:0,
      mud:[...state.assignments].filter(([id,k])=>k&&state.sites.get(k)?.zone==='mud').map(([id,k])=>`${id}:${k}`).sort().join('|'),
      locks:[...state.locks].sort((a,b)=>a-b).join(','),waiting:[...state.assignments].filter(([,k])=>k==null).length}));
    assert.equal(await page.locator('#autoGrass').isEnabled(),true,'Auto-fill grass must be usable in edit mode');
    const saves=app.saves;
    await page.locator('#autoGrass').click();
    await page.locator('#mapPreview').waitFor({state:'visible'});
    const report=await page.locator('#mapPreviewText').innerText();
    assert(/players changed/.test(report),report);
    assert.equal(await page.locator('#mapApply').isEnabled(),true,report);
    assert.equal(app.saves,saves,'Previewing must not save');
    const preview=await page.evaluate(()=>({mud:[...state.assignments].filter(([id,k])=>k&&state.sites.get(k)?.zone==='mud').map(([id,k])=>`${id}:${k}`).sort().join('|'),
      locks:[...state.locks].sort((a,b)=>a-b).join(',')}));
    assert.equal(preview.mud,before.mud,'The preview must not move a mud HQ');
    assert.equal(preview.locks,before.locks,'The preview must not release or add reservations');
    const pinnedAfter=await page.evaluate(p=>[state.assignments.get(p.mud.id),state.assignments.get(p.grass.id)],pinned);
    assert.deepEqual(pinnedAfter,[pinned.mud.key,pinned.grass.key],'Manual HQs stay exactly where they were placed');
    await page.screenshot({path:path.join(output,'autofill-grass-preview.png')});
    await page.locator('#mapApply').click();
    await page.waitForFunction(()=>!busy&&layoutPreview==null);
    assert.equal(app.saves,saves+1,'Applying saves exactly one revision');
    const saved=await page.evaluate(p=>({mud:[...state.assignments].filter(([id,k])=>k&&state.sites.get(k)?.zone==='mud').map(([id,k])=>`${id}:${k}`).sort().join('|'),
      locks:[...state.locks].sort((a,b)=>a-b).join(','),pinned:[state.assignments.get(p.mud.id),state.assignments.get(p.grass.id)],
      waiting:[...state.assignments].filter(([,k])=>k==null).length}),pinned);
    assert.equal(saved.mud,before.mud,'The saved plan keeps every mud HQ');
    assert.equal(saved.locks,before.locks,'The saved plan keeps every reservation');
    assert.deepEqual(saved.pinned,[pinned.mud.key,pinned.grass.key]);
    assert(saved.waiting<=before.waiting,'The saved plan leaves no extra players waiting');
    assert.deepEqual(errors,[],errors.join('\n'));
    console.log(`Auto-fill grass passed: preview + on-map apply saved one revision, kept ${before.mud.split('|').length} mud HQs and ${before.locks.split(',').length} reservations fixed, waiting ${before.waiting}->${saved.waiting}`);
  } finally { await browser?.close(); await new Promise(resolve=>app.server.close(resolve)); }
})().catch(e=>{console.error(e);process.exit(1);});

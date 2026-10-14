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
    // Drag an HQ: a free tile moves it, a held tile offers swap or the unplaced list,
    // an unsafe or reserved target is refused without saving.
    const pixel = key => page.evaluate(k => {
      const [x,y] = project(state.sites.get(k)), r = document.getElementById('map').getBoundingClientRect();
      return [x + r.left, y + r.top];
    }, key);
    const dragHq = async (fromKey, toKey) => {
      const [ax,ay] = await pixel(fromKey), [bx,by] = await pixel(toKey);
      await page.mouse.move(ax, ay); await page.mouse.down();
      await page.mouse.move((ax+bx)/2, (ay+by)/2, {steps: 4});
      await page.mouse.move(bx, by, {steps: 4});
      await page.mouse.up();
    };
    const settle = () => page.waitForFunction(() => !document.getElementById('status').textContent.includes('Saving'));
    const assignments = () => new Map(app.shared.draft.assignments);
    await page.locator('#map').scrollIntoViewIfNeeded();
    const free = await page.evaluate(() => {
      for (const [id,key] of [...state.assignments]) {
        if (key == null || state.locks.has(id)) continue;
        const site = state.sites.get(key);
        for (let dx=-3; dx<=3; dx++) for (let dy=-3; dy<=3; dy++) {
          if (!dx && !dy) continue;
          try {
            const s = P.coordinateSite(state, site.x+dx, site.y+dy), tkey = `${s.x},${s.y}`;
            if (state.assignments.get(id) === tkey || P.playerAt(state, tkey) != null) continue;
            P.defineSite(state, s.x, s.y); P.checkPlacement(state, id, tkey);
            return {id, key, tkey, name: state.players.get(id).name};
          } catch {}
        }
      }
      return null;
    });
    assert(free, 'No free tile available for the drag test');
    let saves = app.saves;
    const [fx,fy] = await pixel(free.key), [tx,ty] = await pixel(free.tkey);
    await page.mouse.move(fx, fy); await page.mouse.down();
    await page.mouse.move((fx+tx)/2, (fy+ty)/2, {steps: 4}); await page.mouse.move(tx, ty, {steps: 4});
    assert((await page.locator('#placementHint').innerText()).includes('Drop to reserve'), 'Dragging an HQ should preview the drop');
    assert((await page.locator('#gapWarning').innerText()).length > 0, 'Dragging should show the pre-move gap warning');
    await page.mouse.up(); await settle();
    assert.equal(app.saves, saves+1, 'Dropping on a free tile should save once');
    assert.equal(assignments().get(free.id), free.tkey, 'The dragged HQ should hold the drop tile');
    assert(app.shared.draft.locks.includes(free.id), 'A dropped HQ reserves its new tile');
    const held = await page.evaluate(() => {
      for (const [id,key] of [...state.assignments]) {
        if (key == null || state.locks.has(id)) continue;
        const site = state.sites.get(key);
        for (let dx=-4; dx<=4; dx++) for (let dy=-4; dy<=4; dy++) {
          if (!dx && !dy) continue;
          let s; try { s = P.coordinateSite(state, site.x+dx, site.y+dy); } catch { continue; }
          const tkey = `${s.x},${s.y}`;
          if (state.assignments.get(id) === tkey) continue;
          const holder = P.playerAt(state, tkey);
          if (holder == null || holder === id || state.locks.has(holder)) continue;
          try { P.defineSite(state, s.x, s.y); P.checkPlacement(state, id, tkey, {occupied: 'swap'}); } catch { continue; }
          return {id, key, tkey, holder, holderName: state.players.get(holder).name};
        }
      }
      return null;
    });
    assert(held, 'No held tile available for the swap drag test');
    saves = app.saves;
    await dragHq(held.key, held.tkey);
    await page.locator('#dropChoice').waitFor({state: 'visible'});
    const choiceText = await page.locator('#dropChoiceText').innerText();
    assert(choiceText.includes(held.holderName), choiceText);
    assert(choiceText.includes('Swap'), choiceText);
    assert.equal(await page.locator('#dropSwap').isEnabled(), true, choiceText);
    assert.equal(app.saves, saves, 'The swap choice should save nothing until it is applied');
    await page.locator('#dropSwap').click(); await settle();
    assert.equal(app.saves, saves+1, 'Choosing swap should save once');
    assert.equal(assignments().get(held.id), held.tkey, 'The dragged HQ should take the held tile');
    assert.equal(assignments().get(held.holder), held.key, 'Swap should move the occupant to the vacated tile');
    assert(/Swapped with/.test(await page.locator('#status').innerText()), await page.locator('#status').innerText());
    const unplaceOnly = await page.evaluate(() => {
      for (const [id,key] of [...state.assignments]) {
        if (key == null || state.locks.has(id)) continue;
        const site = state.sites.get(key);
        for (const [other, tkey] of [...state.assignments]) {
          if (other === id || tkey == null || state.locks.has(other)) continue;
          const target = state.sites.get(tkey);
          if (!target || Math.abs(site.x-target.x) > 4 || Math.abs(site.y-target.y) > 4) continue;
          try { P.checkPlacement(state, id, tkey, {occupied: 'swap'}); continue; } catch {}
          try { P.checkPlacement(state, id, tkey, {occupied: 'unplace'}); } catch { continue; }
          return {id, key, tkey, holder: other, holderName: state.players.get(other).name};
        }
      }
      return null;
    });
    assert(unplaceOnly, 'No held tile where only the unplaced list is safe');
    saves = app.saves;
    await dragHq(unplaceOnly.key, unplaceOnly.tkey);
    await page.locator('#dropChoice').waitFor({state: 'visible'});
    assert.equal(await page.locator('#dropSwap').isEnabled(), false, 'An unsafe swap must be disabled in the drop choice');
    assert((await page.locator('#dropChoiceText').innerText()).includes('refused'), 'The refused swap should explain itself');
    await page.locator('#dropUnplace').click(); await settle();
    assert.equal(app.saves, saves+1, 'The unplaced list choice should save once');
    assert.equal(assignments().get(unplaceOnly.id), unplaceOnly.tkey, 'The dragged HQ should take the held tile');
    assert.equal(assignments().get(unplaceOnly.holder), null, 'The occupant should move to the unplaced list');
    assert(/unplaced list/.test(await page.locator('#status').innerText()), await page.locator('#status').innerText());
    const reserved = await page.evaluate(() => {
      const locked = [...state.assignments].filter(([id,key]) => key != null && state.locks.has(id));
      for (const [other, tkey] of locked) {
        const target = state.sites.get(tkey); if (!target) continue;
        const [px,py] = project(target), r = document.getElementById('map').getBoundingClientRect();
        if (px < 8 || py < 8 || px > r.width-8 || py > r.height-8) continue;
        for (const [id,key] of [...state.assignments]) {
          if (key == null || state.locks.has(id)) continue;
          const site = state.sites.get(key);
          if (Math.abs(site.x-target.x) > 3 || Math.abs(site.y-target.y) > 3) continue;
          try { P.checkPlacement(state, id, tkey); continue; } catch (e) { if (!/locked/.test(e.message)) continue; }
          return {id, key, tkey, holderName: state.players.get(other).name};
        }
      }
      return null;
    });
    assert(reserved, 'No reserved tile beside a movable HQ for the refusal test');
    saves = app.saves;
    await dragHq(reserved.key, reserved.tkey);
    await page.waitForTimeout(200);
    assert.equal(app.saves, saves, 'A refused drop must not save');
    assert.equal(await page.locator('#dropChoice').isVisible(), false, 'A reserved tile cannot offer swap or the unplaced list');
    assert((await page.locator('#status').innerText()).includes('locked'), await page.locator('#status').innerText());
    assert.equal(assignments().get(reserved.id), reserved.key, 'A refused drop must leave the HQ in place');
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
    console.log('Desktop + phone QA passed: preview/cancel/apply, exact placement, invalid targets, collision checks, reserved tiles, persistence, all wedges, drag and drop with swap/unplaced choices, refused drops, view mode, no browser errors.');
  }finally{await browser?.close();await new Promise(resolve=>app.server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

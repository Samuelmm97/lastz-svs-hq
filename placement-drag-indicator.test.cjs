// Drag feedback QA: the pointer-following chip, the on-map target indicator, and the
// occupied-tile prompt anchored at the drop point (plus the read-only explanation).
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
    await page.locator('#map').scrollIntoViewIfNeeded();
    const pixel = key => page.evaluate(k => {
      const [x,y]=project(state.sites.get(k)),r=document.getElementById('map').getBoundingClientRect();
      return [x+r.left,y+r.top];
    }, key);
    const tilePixel = (x,y) => page.evaluate(([tx,ty]) => {
      const [px,py]=project({x:tx,y:ty,zone:'mud'}),r=document.getElementById('map').getBoundingClientRect();
      return [px+r.left,py+r.top];
    }, [x,y]);
    const chip = () => page.evaluate(() => {
      const c=document.getElementById('dragChip'),m=c.parentElement.getBoundingClientRect();
      return {hidden:c.hidden,cls:c.className,title:document.getElementById('dragChipTitle').textContent,
        text:document.getElementById('dragChipText').textContent,x:c.offsetLeft,y:c.offsetTop,
        width:c.offsetWidth,height:c.offsetHeight,box:{w:m.width,h:m.height}};
    });
    // The target indicator is painted on the canvas: sample the tile centre for the status tone.
    const centreTone = key => page.evaluate(k => {
      const [x,y]=project(state.sites.get(k)),d=devicePixelRatio||1,p=ctx.getImageData(Math.round(x*d),Math.round(y*d),1,1).data;
      return [p[0],p[1],p[2]];
    }, key);
    const near = (v,target,tol) => Math.abs(v-target)<=tol;
    const FREE=[126,231,135],GAP=[255,179,71],CHOICE=[138,180,255],BAD=[243,133,143];
    const toneName = tone => [['ok',FREE],['gap',GAP],['choice',CHOICE],['bad',BAD]]
      .filter(([,c])=>c.every((v,i)=>near(tone[i],v,12))).map(([n])=>n)[0]||`rgb(${tone.join(',')})`;

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
    assert(free, 'No free tile available for the drag indicator test');
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
    assert(held, 'No held tile available for the drop prompt test');
    const saves=app.saves;

    // --- 1. mid-drag on a free tile: chip follows the pointer, canvas shows the target ---
    await page.mouse.move(...(await pixel(free.key))); await page.mouse.down();
    const [fx,fy]=await tilePixel(...free.tkey.split(',').map(Number));
    await page.mouse.move((fx+400)/2,(fy+400)/2,{steps:3});
    await page.mouse.move(fx,fy,{steps:4});
    const okChip=await chip();
    assert.equal(okChip.hidden,false,'The drag chip should be visible while dragging');
    assert(okChip.cls.includes('ok'),`A legal drop should read as ok: ${okChip.cls}`);
    assert(okChip.title.includes('Release to move here'),okChip.title);
    assert(okChip.text.includes(free.name),`The chip should name the dragged HQ: ${okChip.text}`);
    assert(okChip.text.includes(`X ${free.tkey.split(',')[0]}, Y ${free.tkey.split(',')[1]}`),okChip.text);
    assert(okChip.x+okChip.width<=okChip.box.w+1&&okChip.y+okChip.height<=okChip.box.h+1,'The chip must stay inside the map');
    assert(okChip.x>0&&okChip.y>0,'The chip must sit near the pointer, not at the corner');
    const okTone=await centreTone(free.tkey);
    assert.equal(toneName(okTone),'ok',`The target tile should be outlined green: ${okTone}`);
    await page.screenshot({path:path.join(output,'drag-indicator-free.png')});

    // --- 2. mid-drag onto an occupied tile: the chip names the holder and the options ---
    const [hx,hy]=await tilePixel(...held.tkey.split(',').map(Number));
    await page.mouse.move(hx,hy,{steps:4});
    const choiceChip=await chip();
    assert.equal(choiceChip.hidden,false,choiceChip.cls);
    assert(choiceChip.cls.includes('choice'),`An occupied target should read as a choice: ${choiceChip.cls}`);
    assert(choiceChip.title.includes(held.holderName),`The chip should name the holder: ${choiceChip.title}`);
    assert(/swap/i.test(choiceChip.text)&&/unplaced/i.test(choiceChip.text),choiceChip.text);
    assert.equal(toneName(await centreTone(held.tkey)),'choice','An occupied target should read blue');
    await page.screenshot({path:path.join(output,'drag-indicator-choice.png')});

    // --- 3. the prompt appears at the drop point, not in the sidebar ---
    await page.mouse.up();
    await page.locator('#dropChoice').waitFor({state:'visible'});
    const box=await page.evaluate(() => {
      const c=document.getElementById('dropChoice'),m=c.parentElement.getBoundingClientRect();
      return {cls:c.className,x:c.offsetLeft,y:c.offsetTop,w:c.offsetWidth,h:c.offsetHeight,box:{w:m.width,h:m.height}};
    });
    assert(box.cls.includes('floating'),box.cls);
    assert(box.x+box.w<=box.box.w+1&&box.y+box.h<=box.box.h+1,'The prompt must stay inside the map');
    assert(box.x>0&&box.y>0,'The prompt must be positioned at the drop point');
    assert((await page.locator('#dropChoiceText').innerText()).includes(held.holderName));
    assert.equal(app.saves,saves,'Showing the prompt must save nothing');
    await page.screenshot({path:path.join(output,'drag-prompt-at-drop.png')});
    await page.locator('#dropCancel').click();
    await page.locator('#dropChoice').waitFor({state:'hidden'});
    assert.equal((await chip()).hidden,true,'Cancelling should clear the chip');
    assert.equal(app.saves,saves);

    // --- 4. an illegal tile (the capital) reads as refused ---
    await page.mouse.move(...(await pixel(free.key))); await page.mouse.down();
    const [cx,cy]=await tilePixel(500,500);
    await page.mouse.move(cx,cy,{steps:4});
    const badChip=await chip();
    assert(badChip.cls.includes('bad'),`An illegal tile should read as refused: ${badChip.cls}`);
    assert(badChip.title.includes('Not allowed here'),badChip.title);
    assert(badChip.text.length>0,badChip.text);
    await page.mouse.up();
    assert.equal(app.saves,saves,'A refused drag must not save');
    assert.equal((await chip()).hidden,true,'The chip should clear when the drag ends');

    // --- 5. read-only view explains why the drag only pans ---
    const view=await browser.newPage({viewport:{width:1440,height:1000}});
    view.on('pageerror',e=>errors.push(e.message));
    await view.goto(app.url+'/placement.html?alliance=Helm');
    await view.locator('#rows tr').first().waitFor();
    await view.locator('#map').scrollIntoViewIfNeeded();
    const vpix=await view.evaluate(k => {
      const [x,y]=project(state.sites.get(k)),r=document.getElementById('map').getBoundingClientRect();
      return [x+r.left,y+r.top];
    }, free.key);
    await view.mouse.move(vpix[0],vpix[1]); await view.mouse.down();
    await view.mouse.move(vpix[0]+70,vpix[1]+50,{steps:4});
    const viewChip=await view.evaluate(() => {
      const c=document.getElementById('dragChip');
      return {hidden:c.hidden,cls:c.className,title:document.getElementById('dragChipTitle').textContent,
        text:document.getElementById('dragChipText').textContent};
    });
    assert.equal(viewChip.hidden,false,'Dragging an HQ in the shared view should explain itself');
    assert(viewChip.cls.includes('bad'),viewChip.cls);
    assert(/Edit plan/.test(viewChip.title+viewChip.text),viewChip.title+' '+viewChip.text);
    await view.screenshot({path:path.join(output,'drag-read-only-hint.png')});
    await view.mouse.up();
    await view.close();
    assert.deepEqual(errors,[],errors.join('\n'));
    console.log('Drag feedback QA passed: pointer chip, green/blue/red target indicator, prompt at the drop point, read-only hint, no browser errors.');
  } finally { await browser?.close(); await new Promise(resolve=>app.server.close(resolve)); }
})().catch(e=>{console.error(e);process.exit(1);});

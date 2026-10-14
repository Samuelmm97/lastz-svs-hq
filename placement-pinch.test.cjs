// Mobile gesture QA: two fingers pinch-zoom around their midpoint (and never drag or drop an HQ),
// one finger still pans, and a tap still opens an HQ card. Real touch events through CDP, on a
// phone-sized touch viewport.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {startServer}=require('./qa-server.cjs');
const LIVE='C:/Users/menag/AppData/Local/hermes/cache/scratch/hq';
process.env.QA_PLAN=path.join(LIVE,'plan_bare.json');
process.env.QA_SHARED=path.join(LIVE,'shared_live.json');
(async()=>{
  const app=await startServer();let browser;
  const output=process.env.QA_OUTPUT||__dirname;
  fs.mkdirSync(output,{recursive:true});
  try {
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
    await page.goto(app.url+'/placement.html');
    await page.locator('#rows tr').first().waitFor();
    await page.waitForFunction(()=>revision>0);
    await page.locator('#map').scrollIntoViewIfNeeded();
    const client=await context.newCDPSession(page);
    const send=(type,points)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:points});
    const tiles=()=>page.evaluate(()=>({scale,panX,panY}));
    // The tile-space point sitting under a given client position - it must not move during a pinch.
    const tileUnder=(x,y)=>page.evaluate(([sx,sy])=>{
      const r=canvas.getBoundingClientRect(),k=Math.min(r.width/260,r.height/250)*scale;
      const ix=sx-r.left,iy=sy-r.top;                       // client -> canvas space
      return {u:500+(ix-r.width/2-panX)/k,v:500+(iy-r.height/2-panY)/(k*.8)};
    },[x,y]);
    const rect=await page.evaluate(()=>{const r=canvas.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};});
    const cx=rect.left+rect.width*.6, cy=rect.top+rect.height*.5;

    // 1. Pinch open: fingers go from 60px apart to 120px apart, so the zoom should double and the
    //    tile under the fingers should stay under them.
    const before=await tiles(), anchor0=await tileUnder(cx,cy);
    const start=60,end=120;
    await send('touchStart',[{x:cx-start/2,y:cy,id:1},{x:cx+start/2,y:cy,id:2}]);
    for(let i=1;i<=6;i++){const d=start+(end-start)*i/6;await send('touchMove',[{x:cx-d/2,y:cy,id:1},{x:cx+d/2,y:cy,id:2}]);}
    await send('touchEnd',[]);
    const after=await tiles(), anchor1=await tileUnder(cx,cy);
    const ratio=after.scale/before.scale;
    assert(Math.abs(ratio-2)<.15,`Spreading the fingers 2x should roughly double the zoom (got ${ratio.toFixed(2)}x)`);
    assert(Math.hypot(anchor1.u-anchor0.u,anchor1.v-anchor0.v)<1.5,
      `The tile under the pinch must stay put (${anchor0.u.toFixed(1)},${anchor0.v.toFixed(1)} -> ${anchor1.u.toFixed(1)},${anchor1.v.toFixed(1)})`);

    // 2. A pinch is not a drag and not a tap: nothing gets selected, no prompt, no leftover fingers.
    const residue=await page.evaluate(()=>({selected:selectedId,dragging:drag!==null,pointers:pointers.size,
      choice:!document.getElementById('dropChoice').hidden,chip:!document.getElementById('dragChip').hidden}));
    assert.equal(residue.pointers,0,'Every finger is released after the pinch');
    assert.equal(residue.dragging,false,'No drag survives a pinch');
    assert.equal(residue.selected,null,'A pinch never selects a player');
    assert.equal(residue.choice,false,'A pinch never opens the swap prompt');
    assert.equal(residue.chip,false,'A pinch never leaves the drag chip');
    await page.screenshot({path:path.join(output,'pinch-zoom.png')});

    // 3. One finger still pans, and does not change the zoom.
    const pan0=await tiles();
    await send('touchStart',[{x:cx,y:cy,id:1}]);
    for(let i=1;i<=5;i++)await send('touchMove',[{x:cx+i*10,y:cy+i*4,id:1}]);
    await send('touchEnd',[]);
    const pan1=await tiles();
    assert(Math.abs(pan1.panX-pan0.panX)>20,`One finger pans the map (${(pan1.panX-pan0.panX).toFixed(1)}px)`);
    assert.equal(pan1.scale,after.scale,'Panning must not change the zoom');

    // 4. A tap on an HQ still opens its card.
    const tap=await page.evaluate(()=>{
      const r=canvas.getBoundingClientRect();
      const chosen=P.rows(state).find(p=>p.zone!=='unassigned'&&p.tag);
      const [px,py]=project(chosen);
      return {name:chosen.name,x:r.left+px,y:r.top+py};});
    await send('touchStart',[{x:tap.x,y:tap.y,id:1}]);
    await send('touchEnd',[]);
    await page.locator('#hqInfo').waitFor({state:'visible'});
    assert((await page.locator('#hqInfo').innerText()).includes(tap.name),`Tap should open ${tap.name}'s card`);
    await page.screenshot({path:path.join(output,'pinch-tap-card.png')});

    assert.deepEqual(errors,[],errors.join('\n'));
    console.log(`Pinch QA passed: fingers 60->120px doubled the zoom (${ratio.toFixed(2)}x) with the pinch point anchored, no drag/tap side effects, one finger still pans, tap still opens the card.`);
  } finally { await browser?.close(); await new Promise(resolve=>app.server.close(resolve)); }
})().catch(e=>{console.error(e);process.exit(1);});

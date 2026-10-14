// Map label QA: zooming in writes each HQ's player name and HQ level beside its dot, the labels
// never overlap each other, and clicking an HQ opens its card with the power and spot details.
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
    const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
    await page.goto(app.url+'/placement.html');
    await page.locator('#rows tr').first().waitFor();
    await page.waitForFunction(()=>revision>0);
    await page.locator('#map').scrollIntoViewIfNeeded();

    // 1. Zoomed out the map stays clean: no name labels at all.
    const zoomedOut=await page.evaluate(()=>{scale=1;panX=panY=0;draw();return {labels:hqLabels.length};});
    assert.equal(zoomedOut.labels,0,'No HQ labels should be drawn while zoomed out');

    // 2. Zoom in on one alliance HQ: its neighbours are named, with their HQ level.
    const focus=await page.evaluate(()=>{
      const chosen=P.rows(state).find(p=>p.zone==='grass'&&p.tag&&Number.isFinite(p.hq)&&!p.role);
      const r=canvas.getBoundingClientRect(),base=Math.min(r.width/260,r.height/250)*8;
      scale=8;
      panX=-(chosen.x+((chosen.y-500)%2!==0?.5:0)-500)*base;
      panY=-(chosen.y-500)*base*.8;
      draw();
      const overlap=(a,b)=>a.x<b.x+b.width+2&&b.x<a.x+a.width+2&&a.y<b.y+b.height+2&&b.y<a.y+a.height+2;
      let collisions=0;
      for(let i=0;i<hqLabels.length;i++)for(let j=i+1;j<hqLabels.length;j++)if(overlap(hqLabels[i].box,hqLabels[j].box))collisions++;
      const box=canvas.getBoundingClientRect(),[px,py]=project(chosen);
      return {count:hqLabels.length,players:state.players.size,visible:visible.length,collisions,
        labels:hqLabels.slice(0,4).map(l=>({name:l.name,hq:l.hq,x:l.x,y:l.y})),
        hasFocus:hqLabels.some(l=>l.id===chosen.id),
        allVisible:hqLabels.every(l=>visible.some(p=>p.id===l.id)),
        allLeveled:hqLabels.every(l=>Number.isFinite(l.hq)),
        target:{name:chosen.name,hq:chosen.hq,power:chosen.totalPower,hero:chosen.heroPower,tag:chosen.tag,
          clientX:box.left+px,clientY:box.top+py,zone:chosen.zone}};
    });
    assert(focus.count>1,`Zooming in should label the HQs around the focus (${focus.count} labels)`);
    assert(focus.count<focus.visible,`Labels are the in-view HQs, not the whole map (${focus.count} of ${focus.visible})`);
    assert.equal(focus.collisions,0,'Labels must never overlap each other');
    assert(focus.hasFocus,`The focused HQ should carry its own label (${focus.target.name})`);
    assert(focus.allVisible,'Only players currently shown may be labelled');
    assert(focus.allLeveled,'Every label carries an HQ level');
    assert(focus.labels.every(l=>l.name&&l.hq),JSON.stringify(focus.labels));
    await page.screenshot({path:path.join(output,'labels-zoomed.png')});

    // 3. Clicking an HQ opens its card, close to the dot, with power in it.
    await page.mouse.click(focus.target.clientX,focus.target.clientY);
    const card=page.locator('#hqInfo');
    await card.waitFor({state:'visible'});
    const text=(await card.innerText()).replace(/\s+/g,' ');
    assert(text.includes(focus.target.name),text);
    assert(new RegExp(`HQ level ${focus.target.hq}\\b`).test(text),text);
    if(Number.isFinite(focus.target.power))assert(text.includes(focus.target.power.toLocaleString()),`Power should be on the card: ${text}`);
    if(focus.target.tag)assert(text.includes(focus.target.tag),text);
    assert(/X -?\d+, Y -?\d+/.test(text),text);
    const placement=await page.evaluate(()=>{
      const box=document.getElementById('hqInfo').getBoundingClientRect(),area=document.querySelector('section.map').getBoundingClientRect();
      return box.left>=area.left-1&&box.right<=area.right+1&&box.top>=area.top-1&&box.bottom<=area.bottom+1;
    });
    assert(placement,'The card stays inside the map panel');
    await page.screenshot({path:path.join(output,'hq-card.png')});

    // 4. The card closes on its button, and a click on empty map space also clears it.
    await page.locator('#hqInfoClose').click();
    assert(!(await card.isVisible()),'The close button hides the card');
    await page.mouse.click(focus.target.clientX,focus.target.clientY);
    await card.waitFor({state:'visible'});
    const empty=await page.evaluate(()=>{
      const r=canvas.getBoundingClientRect();
      for(let y=12;y<r.height-12;y+=19)for(let x=12;x<r.width-12;x+=29){
        let near=false;
        for(const s of state.sites.values()){const [sx,sy]=project(s);if(Math.hypot(sx-x,sy-y)<18){near=true;break;}}
        if(!near)return {clientX:r.left+x,clientY:r.top+y};
      }
      return null;
    });
    assert(empty,'The map has empty space to click');
    await page.mouse.click(empty.clientX,empty.clientY);
    assert(!(await card.isVisible()),'Clicking empty map space hides the card');
    assert.deepEqual(errors,[],errors.join('\n'));
    console.log(`Map label QA passed: ${focus.count} HQ labels drawn when zoomed in (no overlaps, all with an HQ level), card opened for ${focus.target.name} with power and spot, closes cleanly.`);
  } finally { await browser?.close(); await new Promise(resolve=>app.server.close(resolve)); }
})().catch(e=>{console.error(e);process.exit(1);});

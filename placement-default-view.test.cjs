// Default-view QA: the map opens on every HQ (no hidden players), unaligned sign-ups are drawn
// distinctly, and they are back priority - never mud, always behind the alliances.
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
    await page.goto(app.url+'/placement.html');
    await page.locator('#rows tr').first().waitFor();
    await page.waitForFunction(()=>revision>0);
    await page.locator('#map').scrollIntoViewIfNeeded();

    // 1. Nothing is filtered away by default and the labels say so.
    const first=await page.evaluate(()=>({
      players:state.players.size,visible:visible.length,
      summary:document.getElementById('summary').textContent,
      defaultOption:[...document.getElementById('section').options][0].textContent,
      otherOption:[...document.getElementById('section').options].find(o=>o.value==='Other').textContent,
      rearOption:[...document.getElementById('zone').options].find(o=>o.value==='rear').textContent,
      section:'',zone:'',search:'',
    }));
    assert.equal(first.visible,first.players,`Every HQ should be shown by default: ${first.visible}/${first.players}`);
    assert(/HQs shown/.test(first.summary),first.summary);
    assert(/every player, filtered by nothing/.test(first.summary),first.summary);
    assert(/unaligned kept at the back/.test(first.summary),first.summary);
    assert(/All HQs/.test(first.defaultOption),first.defaultOption);
    assert(!/All alliances/.test(first.defaultOption),first.defaultOption);
    assert(/Unaligned \/ other alliances/.test(first.otherOption),first.otherOption);
    assert(/unaligned or prior SvS/.test(first.rearOption),first.rearOption);

    // 2. Unaligned HQs are painted in the dedicated colour, and only while they are shown.
    const slatePixels = (tol=3) => page.evaluate(t => {
      const c=document.getElementById('map'),d=c.width,w=c.height,img=ctx.getImageData(0,0,d,w).data;
      let n=0;
      for(let i=0;i<img.length;i+=4)if(Math.abs(img[i]-201)<t&&Math.abs(img[i+1]-212)<t&&Math.abs(img[i+2]-218)<t)n++;
      return n;
    }, tol);
    const allSlate=await slatePixels();
    assert(allSlate>400,`Unaligned HQs should be drawn in their own colour (${allSlate} pixels)`);
    await page.screenshot({path:path.join(output,'default-all-hqs.png')});

    // 3. Filtering to one alliance is an explicit choice and really does filter.
    const helmCount=await page.evaluate(()=>state.players.size&&[...state.players.values()].filter(p=>p.section==='Helm').length);
    await page.locator('#section').selectOption('Helm');
    await page.waitForFunction(n=>visible.length===n,helmCount);
    const filtered=await page.evaluate(()=>({visible:visible.length,summary:document.getElementById('summary').textContent}));
    assert.equal(filtered.visible,helmCount,`Filtering to Helm should show only Helm (${filtered.visible} vs ${helmCount})`);
    assert(!/filtered by nothing/.test(filtered.summary),filtered.summary);
    const helmSlate=await slatePixels();
    assert(helmSlate<allSlate*0.03,`Unaligned HQs should stop being drawn while another alliance is selected (${helmSlate} vs ${allSlate})`);
    await page.screenshot({path:path.join(output,'filtered-to-helm.png')});
    await page.locator('#section').selectOption('');

    // 4. The rule itself on the live plan: unaligned never sit in mud and always rank behind an
    //    alliance member in the grass. The list spells the reason out.
    const rule=await page.evaluate(()=>{
      const rows=P.rows(state),stray=rows.filter(p=>P.isUnaligned(p)&&p.zone!=='unassigned');
      const ring=k=>state.sites.get(k).ring;
      const strayRings=stray.filter(p=>p.zone==='grass').map(p=>ring(state.assignments.get(p.id)));
      const alignedGrass=rows.filter(p=>!P.isUnaligned(p)&&p.zone==='grass'&&!p.locked).map(p=>ring(state.assignments.get(p.id)));
      const med=x=>x.slice().sort((a,b)=>a-b)[Math.floor(x.length/2)];
      const sample=stray.find(p=>p.name);
      return {strays:stray.length,mud:stray.filter(p=>p.zone==='mud').length,
        strayMid:med(strayRings),alignedMid:med(alignedGrass),
        reasons:P.rearReasons(sample),name:sample.name,
        straysInMap:visible.filter(p=>P.isUnaligned(p)).length};
    });
    assert.equal(rule.mud,0,'No unaligned player may hold a mud slot');
    assert(rule.strays>800,`The live plan has hundreds of unaligned sign-ups (${rule.strays})`);
    assert(rule.straysInMap>800,'Unaligned players must be drawn on the default map');
    assert(rule.strayMid>rule.alignedMid,`Unaligned players sit further back than alliance members (${rule.strayMid} vs ${rule.alignedMid})`);
    assert(rule.reasons.some(r=>/No alliance/.test(r)),rule.reasons.join(' | '));

    // 5. The list labels them as back priority.
    await page.locator('#search').fill(rule.name);
    await page.locator('#rows tr').first().waitFor();
    const note=await page.locator('#rows tr').first().innerText();
    assert(/Back priority/.test(note)&&/No alliance/.test(note),note.replace(/\s+/g,' '));
    await page.locator('#search').fill('');
    assert.deepEqual(errors,[],errors.join('\n'));
    console.log(`Default-view QA passed: all ${first.players} HQs shown unfiltered, ${rule.strays} unaligned drawn separately and kept out of mud (mid grass ring ${rule.strayMid} vs ${rule.alignedMid}), filtering still filters.`);
  } finally { await browser?.close(); await new Promise(resolve=>app.server.close(resolve)); }
})().catch(e=>{console.error(e);process.exit(1);});

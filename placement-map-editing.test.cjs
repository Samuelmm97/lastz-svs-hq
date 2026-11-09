// Map-first editing: free manual drops (outside the wedge, onto reserved tiles) and the
// grass-only auto-fill that packs around manual placements while leaving every mud HQ alone.
const assert=require('node:assert/strict'),P=require('./placement-planner.js');

function plan(sections){return {placements:[],sections,meta:{mudMinDistance:3}};}
function player(state,id,section){
  state.players.set(id,{id,name:'P'+id,section,tag:section,hq:25,heroPower:10000-id,totalPower:20000-id,
    priority:0,placementEligible:true});
  return id;
}
const keyOf=s=>`${s.x},${s.y}`;
function put(state,id,site,locked=false){
  const key=P.defineSite(state,site.x,site.y);state.assignments.set(id,key);if(locked)state.locks.add(id);return key;
}
// First legal tile of a zone inside a wedge, scanning outwards from the capital.
function tileIn(state,area,zone,used=new Set(),avoid=[]){
  for(let ring=zone==='mud'?19:37;ring<=(zone==='mud'?34:60);ring++)
    for(let j=-ring;j<=ring;j++)for(let i=-ring;i<=ring;i++) {
      if(Math.max(Math.abs(i),Math.abs(j),Math.abs(i+j))!==ring)continue;
      const site={x:500+i+Math.floor(j/2),y:500+j,ring,zone,angle:Math.atan2(i+j/2,-j)};
      if(used.has(keyOf(site))||avoid.some(b=>P.distance(site,b)<4)||!P.inWedge(site,area.start*180/Math.PI,area.end*180/Math.PI))continue;
      try{const legal=P.coordinateSite(state,site.x,site.y);used.add(keyOf(legal));return legal;}catch{continue;}
    }
  throw Error('no tile for '+zone);
}

// ---- free manual drops -----------------------------------------------------
{
  const state=P.create(plan({A:{start:0,end:Math.PI},B:{start:Math.PI,end:2*Math.PI}}));
  const east=tileIn(state,state.sections.A,'mud'),west=tileIn(state,state.sections.B,'mud');
  player(state,0,'A');put(state,0,east);
  player(state,1,'B');put(state,1,west,true);                  // reserved by hand
  const westKey=keyOf(west);
  assert.throws(()=>P.checkPlacement(state,0,westKey),/outside the player/);
  const free=P.checkPlacement(state,0,westKey,{free:true});
  assert.equal(free.next.get(0),westKey);
  // A reserved holder is offered instead of refused when a coordinator drops on it.
  const swap=P.checkPlacement(state,0,westKey,{free:true,occupied:'swap'});
  assert.equal(swap.next.get(0),westKey);assert.equal(swap.next.get(1),keyOf(east));
  const unplace=P.checkPlacement(state,0,westKey,{free:true,occupied:'unplace'});
  assert.equal(unplace.next.get(1),null);
  // Physics still wins: footprints may not overlap.
  P.defineSite(state,west.x+1,west.y);
  assert.throws(()=>P.checkPlacement(state,0,`${west.x+1},${west.y}`,{free:true}),/Too close/);
  // Default (non-free) placements still enforce the wedge for the side panel and scripts.
  assert.throws(()=>P.checkPlacement(state,0,westKey,{occupied:'swap'}),/outside the player/);
}

// ---- grass-only auto-fill --------------------------------------------------
{
  const state=P.create(plan({A:{start:0,end:Math.PI/2,grassOnly:true},B:{start:Math.PI,end:3*Math.PI/2,grassOnly:true}}));
  const used=new Set();
  // Two hand-placed mud HQs (reserved) and one reserved grass HQ that must not move.
  player(state,0,'A');put(state,0,tileIn(state,state.sections.A,'mud',used),true);
  player(state,1,'B');put(state,1,tileIn(state,state.sections.B,'mud',used),true);
  player(state,2,'A');const pinnedSite=tileIn(state,state.sections.A,'grass',used);const pinned=put(state,2,pinnedSite,true);
  // Unlocked grass players, one waiting player, and an unaligned player left alone unless waiting.
  const moving=[];
  for(const [id,section] of [[3,'A'],[4,'A'],[5,'B'],[6,'B']]){
    player(state,id,section);put(state,id,tileIn(state,state.sections[section],'grass',used));moving.push(id);
  }
  player(state,7,'A');                                        // waiting, no tile
  player(state,8,'Other');put(state,8,tileIn(state,state.sections.A,'grass',used,[pinnedSite]));
  const before=new Map(state.assignments);
  const report=P.fillGrassOnly(state);

  assert.equal(state.assignments.get(0),before.get(0),'mud HQ must not move');
  assert.equal(state.assignments.get(1),before.get(1),'mud HQ must not move');
  assert.equal(state.assignments.get(2),pinned,'reserved grass HQ must not move');
  assert.equal(state.assignments.get(8),before.get(8),'placed unaligned HQ stays put');
  assert.notEqual(state.assignments.get(7),null,'waiting player receives a spot');
  assert(report.moved>=4);

  for(const id of [...moving,7]) {
    const site=state.sites.get(state.assignments.get(id));
    assert(site&&site.zone==='grass',`player ${id} lands in grass`);
    const area=state.sections[state.players.get(id).section];
    assert(P.inWedge(site,area.start*180/Math.PI,area.end*180/Math.PI),`player ${id} stays inside its own wedge`);
  }
  const placed=[...state.assignments].filter(([,key])=>key!=null).map(([id,key])=>({id,site:state.sites.get(key)}));
  for(const a of placed)for(const b of placed)if(a.id<b.id&&a.site.zone==='grass'&&b.site.zone==='grass')
    assert(P.distance(a.site,b.site)>=4,`grass footprints keep one empty tile (${a.id}/${b.id})`);

  // A second run changes nothing: the packing is stable.
  assert.equal(P.fillGrassOnly(state).moved,0,'running auto-fill twice is a no-op');
}
console.log('Map editing passed: free manual drops (wedge/reserved override, physics kept) and grass-only packing around manual mud/grass HQs with wedge confinement, 4-tile spacing and a stable second run');

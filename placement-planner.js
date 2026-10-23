/* Editable placement draft. Pure logic shared by the browser and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PlacementPlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const siteKey = site => `${site.x},${site.y}`;
  const siteFields = ['x', 'y', 'zone', 'ring', 'angle', 'spot'];
  const siteOf = row => Object.fromEntries(siteFields.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
  const norm = a => ((a % 360) + 360) % 360;
  const fieldObstacles = state => state.survey?.obstacles || [];
  const isFieldAnchor = (state,id) => state.locks.has(Number(id)) && state.anchorMap?.has(Number(id));
  const tightPlacement = (state,id) => state.sections[state.players.get(id)?.section]?.defencePacking===true;
  function validateSurvey(state,survey) {
    if(survey===undefined)return;
    if(!survey||survey.state!==798||survey.world!==0||!Number.isFinite(Date.parse(survey.capturedAt))||
       !Array.isArray(survey.anchors)||!Array.isArray(survey.obstacles)||(survey.relocations!==undefined&&!Array.isArray(survey.relocations))||survey.anchors.length+survey.obstacles.length+(survey.relocations?.length||0)>3000)
      throw Error('Invalid in-game survey');
    const uids=new Set(),ids=new Set();
    for(const p of [...survey.anchors,...survey.obstacles,...survey.relocations||[]]) {
      if(!p||typeof p.uid!=='string'||!/^\d{1,30}$/.test(p.uid)||uids.has(p.uid)||
         !Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<0||p.x>999||p.y<0||p.y>999||
         !Number.isSafeInteger(p.observed)||p.observed<=0||typeof p.name!=='string'||p.name.length>200||typeof p.tag!=='string'||p.tag.length>20)
        throw Error('Invalid surveyed HQ');
      uids.add(p.uid);
    }
    for(const p of [...survey.anchors,...survey.relocations||[]]) {
      if(!state.players.has(p.id)||ids.has(p.id))throw Error('Invalid surveyed player');ids.add(p.id);
    }
  }
  function distance(a, b) {
    const aj=a.y-500, bj=b.y-500;
    const di=a.x-Math.floor(aj/2)-b.x+Math.floor(bj/2), dj=aj-bj;
    return Math.max(Math.abs(di),Math.abs(dj),Math.abs(di+dj));
  }
  function occupancy(sites) {
    const buckets=new Map(),seen=new Set(),bucket=s=>`${Math.floor(s.x/12)},${Math.floor(s.y/12)}`;
    const add=s=>{if(seen.has(siteKey(s)))return;seen.add(siteKey(s));const key=bucket(s);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(s);};
    sites.forEach(add);
    const fits=(s,gap=0,teleport=false,ignoreKey=null)=>{
      const x=Math.floor(s.x/12),y=Math.floor(s.y/12);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const b of buckets.get(`${x+dx},${y+dy}`)||[])
        if(siteKey(b)!==ignoreKey&&distance(s,b)<(teleport?3:s.zone==='grass'&&b.zone==='grass'?4:3+gap))return false;
      return true;
    };
    const near=(s,radius=4)=>{
      const x=Math.floor(s.x/12),y=Math.floor(s.y/12);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const b of buckets.get(`${x+dx},${y+dy}`)||[])
        if(distance(s,b)<=radius)return true;
      return false;
    };
    return {add,fits,near,clone:()=>occupancy([...buckets.values()].flat())};
  }
  function teleportOpenings(state, section) {
    const area=state.sections[section];if(!area||area.sharedOpenSpots||section==='Other')return [];
    const members=rows(state).filter(p=>p.zone!=='unassigned'&&(p.section===section||(area.group&&state.sections[p.section]?.group===area.group)));
    if(!members.length)return [];
    const team=occupancy(members),occupied=occupancy([...state.assignments.values()].filter(Boolean).map(key=>state.sites.get(key)).filter(Boolean).concat(fieldObstacles(state)));
    const xy=s=>({x:s.x+((s.y-500)%2?0.5:0),y:s.y});
    const points=members.map(xy).sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const half=items=>{const h=[];for(const p of items){while(h.length>=2&&cross(h[h.length-2],h[h.length-1],p)<=0)h.pop();h.push(p);}return h;};
    const lower=half(points),upper=half([...points].reverse()),hull=[...lower.slice(0,-1),...upper.slice(0,-1)];
    const inside=s=>hull.length>=3&&hull.every((a,i)=>cross(a,hull[(i+1)%hull.length],xy(s))>=-1e-9);
    const maxRing=Math.min(119,Math.max(...members.map(p=>p.ring))+4),open=[];
    for(let j=-maxRing;j<=maxRing;j++)for(let i=-maxRing;i<=maxRing;i++) {
      const ring=Math.max(Math.abs(i),Math.abs(j),Math.abs(i+j));
      if(ring<19||ring>maxRing||(ring>34&&ring<37))continue;
      const s={x:500+i+Math.floor(j/2),y:500+j,ring,zone:ring<=34?'mud':'grass',angle:Math.atan2(i+j/2,-j)};
      if(!((inMudArea(s,area)&&inside(s))||team.near(s,4)))continue;
      if(!state.blocked.has(siteKey(s))&&clearOfTurrets(s,state.turrets)&&occupied.fits(s,0,true))
        open.push({...s,insideFormation:inMudArea(s,area)&&inside(s)});
    }
    return open.sort((a,b)=>a.ring-b.ring||a.angle-b.angle);
  }
  function teleportGaps(state, before, after=state.assignments) {
    before=new Map(before);after=new Map(after);
    const prior=occupancy([...before.values()].filter(Boolean).map(key=>state.sites.get(key)).filter(Boolean).concat(fieldObstacles(state)));
    const next=occupancy([...after.values()].filter(Boolean).map(key=>state.sites.get(key)).filter(Boolean).concat(fieldObstacles(state)));
    const candidates=new Map();
    for(const [id,key] of before) {
      if(key==null||key===after.get(id))continue;
      const source=state.sites.get(key);if(!source)continue;
      // Any newly opened landing tile was within two hex tiles of a vacated HQ.
      for(let dx=-3;dx<=3;dx++)for(let dy=-2;dy<=2;dy++) {
        try {
          const s=coordinateSite(state,source.x+dx,source.y+dy);
          if(distance(s,source)<3&&!prior.fits(s,0,true)&&next.fits(s,0,true))candidates.set(siteKey(s),s);
        }catch { /* No-build terrain and turret buffers cannot be landing gaps. */ }
      }
    }
    // Show representative, non-overlapping HQ footprints in each opening.
    const result=[];
    for(const s of [...candidates.values()].sort((a,b)=>a.ring-b.ring||a.angle-b.angle))
      if(result.every(b=>distance(s,b)>=3))result.push(s);
    return result;
  }
  function defenceReport(state,section) {
    const openings=teleportOpenings(state,section).filter(s=>s.insideFormation),before=new Set(openings.map(siteKey));
    const area=state.sections[section],members=rows(state).filter(p=>p.zone!=='unassigned'&&(p.section===section||(area?.group&&state.sections[p.section]?.group===area.group)));
    if(!area||!members.length)return {gapFree:true,openings:[],removals:[],vulnerable:0};
    const xy=s=>({x:s.x+((s.y-500)%2?.5:0),y:s.y}),cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const points=members.map(xy).sort((a,b)=>a.x-b.x||a.y-b.y),half=items=>{const h=[];for(const p of items){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
    const hull=[...half(points).slice(0,-1),...half([...points].reverse()).slice(0,-1)],inside=s=>hull.length>=3&&inMudArea(s,area)&&hull.every((p,i)=>cross(p,hull[(i+1)%hull.length],xy(s))>=-1e-9);
    const occupied=occupancy([...state.assignments.values()].filter(Boolean).map(key=>state.sites.get(key)).concat(fieldObstacles(state)));
    const removals=members.map(p=>{
      const newLandings=[];
      // Removing a seven-cell HQ can only free centers within two hex steps.
      for(let dx=-3;dx<=3;dx++)for(let dy=-2;dy<=2;dy++)try {
        const s=coordinateSite(state,p.x+dx,p.y+dy);
        if(distance(s,p)<3&&inside(s)&&!before.has(siteKey(s))&&occupied.fits(s,0,true,siteKey(p)))newLandings.push(s);
      }catch { /* Not a legal HQ center. */ }
      let pair=null;
      for(let i=0;i<newLandings.length&&!pair;i++)for(let j=i+1;j<newLandings.length;j++)if(distance(newLandings[i],newLandings[j])>=3){pair=[newLandings[i],newLandings[j]];break;}
      return {id:p.id,name:p.name,newLandings,capacity:pair?2:newLandings.length?1:0,pair};
    });
    const pending=new Map(openings.map(s=>[siteKey(s),s])),holes=[];
    while(pending.size){const first=pending.values().next().value,group=[first];pending.delete(siteKey(first));
      for(let n=0;n<group.length;n++){const p=group[n];for(let dx=-2;dx<=2;dx++)for(let dy=-1;dy<=1;dy++){
        const key=`${p.x+dx},${p.y+dy}`,next=pending.get(key);if(next&&distance(p,next)===1){pending.delete(key);group.push(next);}
      }}holes.push(group);
    }
    return {gapFree:openings.length===0,openings,holes,removals,vulnerable:removals.filter(r=>r.capacity>=2).length};
  }
  function coordinateSite(state, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw Error('Use whole-number X and Y coordinates');
    const j=y-500, i=x-500-Math.floor(j/2), ring=Math.max(Math.abs(i),Math.abs(j),Math.abs(i+j));
    const zone=ring>=19&&ring<=34 ? 'mud' : ring>=37&&ring<=119 ? 'grass' : null;
    if (!zone) throw Error('That tile is outside the buildable mud or grass');
    const site={x,y,zone,ring,angle:Math.atan2(i+j/2,-j)};
    if (state.blocked.has(siteKey(site)) || !clearOfTurrets(site,state.turrets)) throw Error('That tile is in a blocked area or turret buffer');
    return site;
  }
  function defineSite(state, x, y) {
    const key=`${x},${y}`;
    const site=state.sites.get(key)||coordinateSite(state,x,y);
    state.sites.set(key,site);
    return key;
  }
  function allowsSite(state, player, site) {
    const area=state.sections[player.section];
    return !area || area.sharedOpenSpots || (!area.grassOnly && site.zone==='grass') || inMudArea(site,area);
  }
  function occupiedAction(options = {}) {
    const action = (options || {}).occupied;
    if (action === undefined || action === null || action === '') return null;
    if (action !== 'swap' && action !== 'unplace')
      throw Error('Choose a valid occupied target action: swap positions or move the occupant to waiting');
    return action;
  }
  function checkPlacement(state, id, targetKey, options = {}) {
    const action = occupiedAction(options);
    id=Number(id);
    if (!state.players.has(id)) throw Error('Choose a player first');
    if(state.players.get(id).placementEligible===false)throw Error('This identity is not confirmed in the current roster; choose the current player record');
    const target=state.sites.get(targetKey);
    if (!target) throw Error('Choose a legal tile');
    if(isFieldAnchor(state,id)&&state.assignments.get(id)!==targetKey)throw Error('Already placed in game. Unlock this HQ before planning a move.');
    if(fieldObstacles(state).some(p=>distance(p,target)<3))throw Error('An observed in-game HQ occupies this space');
    if (!allowsSite(state,state.players.get(id),target)) throw Error('This tile is outside the player’s alliance wedge');
    const occupant=playerAt(state,targetKey), prior=state.assignments.get(id);
    if (occupant!==id && state.locks.has(occupant)) throw Error('That site is held by another locked player');
    const next=new Map(state.assignments);next.set(id,targetKey);
    if (occupant!=null && occupant!==id) {
      if (action==='unplace') {
        if (state.pairs.some(p=>p.strike===occupant||p.reserve===occupant))
          throw Error('Remove the occupant’s swap pair before moving them to waiting');
        next.set(occupant,null);
      } else {
        if (action==='swap' && !prior) throw Error('That player has no tile to swap; move the occupant to waiting instead');
        next.set(occupant,prior);
        if (prior && !allowsSite(state,state.players.get(occupant),state.sites.get(prior)))
          throw Error('That swap would move the other player outside their wedge. Move them to waiting first.');
      }
    }
    const moved=[id,...(occupant!=null&&occupant!==id&&action!=='unplace'?[occupant]:[])];
    for (const who of moved) {
      const s=state.sites.get(next.get(who));if(!s)continue;
      for(const [other,key] of next) {
        if(other===who||key==null)continue;
        const b=state.sites.get(key), minimum=s.zone==='grass'&&b.zone==='grass'&&!tightPlacement(state,who)&&!tightPlacement(state,other)?4:3;
        if(distance(s,b)<minimum) throw Error(`Too close to ${state.players.get(other).name || 'another HQ'}; choose another tile`);
      }
    }
    assertPairZones(state,next);
    for(const who of moved)if(!state.planningMode&&tightPlacement(state,who)){
      const openings=teleportOpenings({...state,assignments:next},state.players.get(who).section).filter(s=>s.insideFormation);
      if(openings.length){const error=Error('That move leaves an enemy teleport opening inside the formation');error.openings=openings;throw error;}
    }
    return {next,occupant};
  }
  // Sign-ups from outside the event alliances are the least likely to turn up at all, so they are
  // always back priority: grass only, behind every alliance member, whatever their power.
  // They are NOT put in the separate outer-ring tier (that partition has to fit inside a single
  // wedge when one alliance is filled on its own) - they stay in the main grass pool and simply
  // sort to the end of it, so they take the back slots of whatever grass is being filled.
  const UNALIGNED_REASON = 'No alliance \u00b7 least likely to join';
  function isUnaligned(player) { return player.section === 'Other' || !(player.tag || '').trim(); }
  function riskReasons(player) {
    const reasons=[];
    if (player.attendanceProxy==='outside_capital_area') reasons.push('Not in the capital area last SvS');
    if (player.highRisk) reasons.push('Unshielded last SvS');
    return reasons;
  }
  function rearReasons(player) {
    return (isUnaligned(player) ? [UNALIGNED_REASON] : []).concat(riskReasons(player));
  }
  const needsRear = player => riskReasons(player).length>0;
  const fallsBack = player => needsRear(player) || isUnaligned(player);
  function clearOfTurrets(site, turrets = []) {
    const j=site.y-500, i=site.x-500-Math.floor(j/2);
    return turrets.every(t => {
      const tj=t.y-500, ti=t.x-500-Math.floor(tj/2), di=i-ti, dj=j-tj;
      return Math.max(Math.abs(di),Math.abs(dj),Math.abs(di+dj))>=t.minCenterDistance;
    });
  }
  function rearSites(state) {
    const count=[...state.players].filter(([id,p])=>!state.locks.has(id)&&needsRear(p)).length;
    return new Set([...state.sites].filter(([key,s])=>s.zone==='grass'&&!state.locks.has(playerAt(state,key)))
      .sort((a,b)=>b[1].ring-a[1].ring||a[1].angle-b[1].angle).slice(0,count).map(([key])=>key));
  }
  function rearForPlayer(state, player, fallback) {
    const area=state.sections[player.section];
    if(!area?.grassOnly)return fallback;
    const tags=new Set(Object.keys(state.sections).filter(tag=>tag===player.section||(area.group&&state.sections[tag].group===area.group)));
    const count=[...state.players].filter(([id,p])=>tags.has(p.section)&&!state.locks.has(id)&&needsRear(p)).length;
    return new Set([...state.sites].filter(([key,s])=>s.zone==='grass'&&inMudArea(s,area)&&!state.locks.has(playerAt(state,key)))
      .sort((a,b)=>b[1].ring-a[1].ring||a[1].angle-b[1].angle).slice(0,count).map(([key])=>key));
  }

  function create(plan) {
    const players = new Map(plan.placements.map(p => [p.id, p]));
    const blocked = new Set(plan.blockedSites || []);
    const allSites = new Map(plan.placements.map(p => [siteKey(p), siteOf(p)]));
    for(const [key,site] of allSites)if(!clearOfTurrets(site,plan.meta?.turrets))blocked.add(key);
    const sites = new Map([...allSites].filter(([key]) => !blocked.has(key)));
    if (players.size !== plan.placements.length || allSites.size !== plan.placements.length) throw Error('Base plan has duplicate IDs or sites');
    const signature = plan.meta?.rosterSignatureVersion===2?plan.planId:(plan.planId ? `${plan.planId}:` : '') + plan.placements.map(p => `${p.id}@${siteKey(p)}`).sort().join('|');
    return { players, basePlayers:new Map(players), sites, signature, assignments: new Map(plan.placements.map(p => [p.id, blocked.has(siteKey(p)) ? null : siteKey(p)])),
             sections: structuredClone(plan.sections || {}), locks: new Set(), pairs: [],
             baseSites: new Map(sites), blocked, turrets: structuredClone(plan.meta?.turrets || []),
             leadershipMudBoundaries: plan.meta?.leadershipMudBoundaries===true };
  }

  function playerAt(state, key) {
    for (const [id, site] of state.assignments) if (site === key) return id;
    return null;
  }

  function current(state, id) {
    const player = state.players.get(Number(id)), key = state.assignments.get(Number(id));
    if (!player) return null;
    const observation=isFieldAnchor(state,id)&&state.anchorMap.get(Number(id));
    const relocation=state.survey?.relocations?.find(p=>p.id===Number(id));
    const position=key==null?{x:null,y:null,zone:'unassigned',ring:null,angle:null,spot:null,locked:false}:{...state.sites.get(key),locked:state.locks.has(Number(id))};
    return { ...player, ...position,
      ...(observation?{placedInGame:true,observedAt:observation.observed}:{}),
      ...(relocation?{relocatingInGame:true,observedX:relocation.x,observedY:relocation.y,observedAt:relocation.observed}:{}) };
  }

  function rows(state, afterSwap = false) {
    const overrides = new Map();
    if (afterSwap) for (const pair of state.pairs) {
      overrides.set(pair.strike, state.assignments.get(pair.reserve));
      overrides.set(pair.reserve, state.assignments.get(pair.strike));
    }
    return [...state.players.keys()].map(id => ({ ...current(state, id),
      ...state.sites.get(overrides.get(id) || state.assignments.get(id)),
      locked: state.locks.has(id),
      role: state.pairs.some(p => p.strike === id) ? 'strike' : state.pairs.some(p => p.reserve === id) ? 'reserve' : '' }));
  }

  function assertPairZones(state, assignments = state.assignments) {
    for (const pair of state.pairs) {
      if (state.sites.get(assignments.get(pair.strike))?.zone !== 'grass' ||
          state.sites.get(assignments.get(pair.reserve))?.zone !== 'mud')
        throw Error('Strike players must stage in grass and reserves must hold mud spots');
    }
  }

  function moveAndLock(state, id, targetKey, options = {}) {
    id = Number(id);
    if (!state.players.has(id)) throw Error('Choose a player first');
    if (!state.sites.has(targetKey)) throw Error('Choose an existing legal site');
    const {next,occupant}=checkPlacement(state,id,targetKey,options);
    state.assignments = next;
    state.locks.add(id);
    return occupant === id ? null : occupant;
  }

  function inWedge(site, start, end) {
    if (Math.abs(end - start) >= 360) return true;
    const a = norm(site.angle * 180 / Math.PI), s = norm(start), e = norm(end);
    return s <= e ? a >= s && a <= e : a >= s || a <= e;
  }

  function angularGap(a, b) {
    const d = Math.abs(a - b) % (2 * Math.PI);
    return Math.min(d, 2 * Math.PI - d);
  }

  function inMudArea(site,area) {
    if(Math.abs(area.end-area.start)>=2*Math.PI-1e-10)return true;
    const start=norm(Math.round(area.start*180/Math.PI*1e9)/1e9);
    const end=norm(Math.round(area.end*180/Math.PI*1e9)/1e9);
    const angle=norm(site.angle*180/Math.PI);
    return start<end ? angle>=start&&angle<end : angle>=start||angle<end;
  }

  function clear(state, options = {}) {
    const { zone = 'mud', start = 0, end = 360, section = '', includeLocked = false } = options;
    const cleared = [];
    for (const [id, key] of state.assignments) {
      const site = state.sites.get(key), player = state.players.get(id);
      if (!site || (zone !== 'all' && site.zone !== zone) || !inWedge(site, start, end) ||
          (section && player.section !== section) || (!includeLocked && state.locks.has(id))) continue;
      cleared.push(id);
    }
    const ids = new Set(cleared);
    for (const pair of state.pairs) if (ids.has(pair.strike) || ids.has(pair.reserve)) {
      state.locks.delete(pair.strike); state.locks.delete(pair.reserve);
    }
    state.pairs = state.pairs.filter(p => !ids.has(p.strike) && !ids.has(p.reserve));
    for (const id of ids) { state.assignments.set(id, null); state.locks.delete(id); }
    return cleared.length;
  }

  function clearForPlanning(state) {
    const players=clear(state,{zone:'all',includeLocked:true});
    const observations=state.survey?.obstacles.length||0;
    if(state.survey)state.survey={...state.survey,anchors:[],obstacles:[]};
    state.anchorMap=new Map();
    state.planningMode=true;
    return {players,observations};
  }

  const validAllianceTag = tag => typeof tag==='string' && tag===tag.trim() && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,19}$/u.test(tag) && !['__proto__','constructor','prototype'].includes(tag.toLowerCase());
  function alliancePlayers(state, sections, survey, tags) {
    const players=new Map(state.basePlayers||state.players);
    for(const p of [...survey?.anchors||[],...survey?.relocations||[]]) {
      const original=players.get(p.id);players.set(p.id,{...original,name:p.name,tag:p.tag});
    }
    for(const [id,p] of players) {
      const tag=tags.get(id)??p.tag??'';
      const matched=Object.keys(sections).find(t=>t.toLowerCase()===tag.toLowerCase());
      const section=matched || (!tags.has(id)&&p.section!=='Other'&&Object.hasOwn(sections,p.section)?p.section:'Other');
      players.set(id,{...p,tag,section});
    }
    return players;
  }
  function waitForAllianceChange(state, ids) {
    const affected=new Set(ids);
    for(const pair of state.pairs)if(affected.has(pair.strike)||affected.has(pair.reserve)){
      state.locks.delete(pair.strike);state.locks.delete(pair.reserve);
    }
    state.pairs=state.pairs.filter(p=>!affected.has(p.strike)&&!affected.has(p.reserve));
    for(const id of affected){state.assignments.set(id,null);state.locks.delete(id);}
    state.planningMode=true;
    return affected.size;
  }
  function addAlliance(state, tag) {
    tag=String(tag||'').trim();
    if(!validAllianceTag(tag)||tag.toLowerCase()==='other')throw Error('Enter an alliance tag of 1–20 letters, numbers, spaces, dots, hyphens or underscores');
    if(Object.keys(state.sections).some(t=>t.toLowerCase()===tag.toLowerCase()))throw Error('That alliance already has a zone');
    if(Object.keys(state.sections).length>=100)throw Error('The plan supports up to 99 alliance zones');
    state.sections[tag]={start:0,end:Math.PI/3,grassOnly:true,frontLayers:1,bodyGap:1};
    for(const [id,p] of state.players)if((p.tag||'').toLowerCase()===tag.toLowerCase())state.players.set(id,{...p,section:tag});
    state.planningMode=true;
    return tag;
  }
  function removeAlliance(state, tag) {
    if(tag==='Other'||!Object.hasOwn(state.sections,tag))throw Error('Choose an alliance zone to remove');
    const ids=[...state.players.values()].filter(p=>p.section===tag).map(p=>p.id);
    waitForAllianceChange(state,ids);delete state.sections[tag];
    for(const id of ids)state.players.set(id,{...state.players.get(id),section:'Other'});
    return ids.length;
  }
  function refreshAllianceMemberships(state, roster) {
    if(roster?.state!==798||!Array.isArray(roster.players))throw Error('Choose a State 798 roster');
    const byUid=new Map();
    for(const p of roster.players){
      if(!p||typeof p.uid!=='string'||!/^\d{1,30}$/.test(p.uid)||!validAllianceTag(p.tag)||byUid.has(p.uid))throw Error('Invalid alliance roster');
      byUid.set(p.uid,p);
    }
    const tags=new Map(state.allianceTags||[]),changed=[];let matched=0;
    for(const [id,p] of state.players){
      const member=byUid.get(String(p.playerId||p.uid||state.anchorMap?.get(id)?.uid||''));
      if(!member)continue;
      matched++;tags.set(id,member.tag);
      if(p.tag!==member.tag)changed.push(id);
    }
    state.allianceTags=tags;
    waitForAllianceChange(state,changed);
    for(const [id,p] of state.players){
      if(!tags.has(id))continue;
      const tag=tags.get(id),section=Object.keys(state.sections).find(t=>t.toLowerCase()===tag.toLowerCase())||'Other';
      state.players.set(id,{...p,tag,section});
    }
    return {matched,changed:changed.length,unmatched:state.players.size-matched};
  }

  function setSection(state, section, start, end, rules = {}) {
    if (!state.sections[section] || !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || start > 360 || end < 0 || end > 360 || start === end)
      throw Error('Choose an alliance and two different boundary angles between 0° and 360°');
    if ((rules.grassOnly!==undefined && typeof rules.grassOnly!=='boolean') ||
        (rules.grassCompact!==undefined && typeof rules.grassCompact!=='boolean') ||
        (rules.defencePacking!==undefined && typeof rules.defencePacking!=='boolean') ||
        (rules.frontLayers!==undefined && ![0,1,2,3].includes(rules.frontLayers)) ||
        (rules.bodyGap!==undefined && ![0,1,2,3].includes(rules.bodyGap))) throw Error('Choose a valid front depth and spacing');
    const group=state.sections[section].group;
    for (const [tag,area] of Object.entries(state.sections)) if (tag===section || (group && area.group===group))
      state.sections[tag] = { ...area, ...rules, start: start*Math.PI/180, end: end*Math.PI/180 };
  }

  function areaReport(state, section) {
    const area=state.sections[section];if(!area)return null;
    const tags=new Set(Object.keys(state.sections).filter(tag=>tag===section||(area.group&&state.sections[tag].group===area.group)));
    const members=rows(state).filter(p=>tags.has(p.section));
    const outside=members.filter(p=>p.zone!=='unassigned'&&!inMudArea(p,area));
    return {members:members.length,waiting:members.filter(p=>p.zone==='unassigned').length,
      outside:outside.length,lockedOutside:outside.filter(p=>p.locked).length,
      grassOutside:outside.filter(p=>p.zone==='grass').length};
  }
  function grassCluster(state, area, members, before, index, place) {
    const center=area.start+((area.end-area.start+2*Math.PI)%(2*Math.PI)||2*Math.PI)/2;
    const prior=p=>state.sites.get(before.get(p.id))||p;
    // Preserve the coordinator's current position order, including lower-power members.
    members.sort((a,b)=>(prior(a).ring??Infinity)-(prior(b).ring??Infinity)||
      angularGap(prior(a).angle??center,center)-angularGap(prior(b).angle??center,center)||a.id-b.id);
    const savedOrder=new Map((area.grassOrder||[]).map((id,i)=>[id,i]));
    if(savedOrder.size)members.sort((a,b)=>(savedOrder.get(a.id)??Infinity)-(savedOrder.get(b.id)??Infinity));
    const order=[...(area.grassOrder||[]),...members.filter(p=>!savedOrder.has(p.id)).map(p=>p.id)];
    for(const s of Object.values(state.sections))if(s===area||(area.group&&s.group===area.group))s.grassOrder=order;
    const candidates=new Map([...state.sites].filter(([,s])=>s.zone==='grass'&&(!area.grassOnly||inMudArea(s,area))));
    for(let j=-119;j<=119;j++)for(let i=-119;i<=119;i++) {
      const ring=Math.max(Math.abs(i),Math.abs(j),Math.abs(i+j));if(ring<37||ring>119)continue;
      const s={x:500+i+Math.floor(j/2),y:500+j,ring,zone:'grass',angle:Math.atan2(i+j/2,-j)};
      if((!area.grassOnly||inMudArea(s,area))&&!state.blocked.has(siteKey(s))&&clearOfTurrets(s,state.turrets))candidates.set(siteKey(s),s);
    }
    const sites=[...candidates.values()];let best=null;
    // A single dense hex lattice prevents irregular chains and separate-looking lobes.
    // Basis (4,-1), (1,3) has center distance four and thirteen possible offsets.
    for(let phase=0;phase<13;phase++) {
      const points=sites.filter(s=>{const j=s.y-500,i=s.x-500-Math.floor(j/2);return ((3*i-j)%13+13)%13===phase;});
      points.sort((a,b)=>(a.ring*100+angularGap(a.angle,center)*200)-(b.ring*100+angularGap(b.angle,center)*200)||a.angle-b.angle);
      const trial=index.clone(),anchor=points.find(s=>trial.fits(s));if(!anchor)continue;
      points.sort((a,b)=>distance(a,anchor)-distance(b,anchor)||a.ring-b.ring||angularGap(a.angle,center)-angularGap(b.angle,center)||a.x-b.x);
      const chosen=[];
      while(chosen.length<members.length) {
        const s=points.find(s=>trial.fits(s)&&(!chosen.length||chosen.some(b=>distance(s,b)===4)));
        if(!s)break;
        chosen.push(s);trial.add(s);
      }
      const radius=Math.max(0,...chosen.map(s=>distance(s,anchor))),sum=chosen.reduce((n,s)=>n+distance(s,anchor),0);
      const score=(members.length-chosen.length)*1e8+radius*1e5+sum*10+anchor.ring;
      if(!best||score<best.score)best={score,chosen,anchor};
    }
    if(!best)return;
    best.chosen.sort((a,b)=>distance(a,best.anchor)-distance(b,best.anchor)||a.ring-b.ring||angularGap(a.angle,center)-angularGap(b.angle,center)||a.x-b.x);
    best.chosen.forEach((s,i)=>place(members[i],s));
  }
  function arrangeGrass(state, section, options={}) {
    const area=state.sections[section];if(!area)throw Error('Choose an alliance first');
    const tags=new Set(Object.keys(state.sections).filter(tag=>tag===section||(area.group&&state.sections[tag].group===area.group)));
    const snapshot=exportDraft(state),before=new Map(state.assignments),next=new Map(before);
    const members=[...state.players.values()].filter(p=>p.placementEligible!==false&&tags.has(p.section)&&!state.locks.has(p.id)&&
      (options.memberIds ? options.memberIds.includes(p.id) :
        state.sites.get(before.get(p.id))?.zone==='grass'||(before.get(p.id)==null&&p.zone==='grass')));
    for(const p of members)next.set(p.id,null);
    const shared=rows(state).filter(p=>{
      const own=state.sections[p.section];
      return !tags.has(p.section)&&p.zone==='grass'&&!state.locks.has(p.id)&&inMudArea(p,area)&&
        (p.section==='Other'||!own||own.sharedOpenSpots||!inMudArea(p,own));
    });
    const sharedIds=new Set(shared.map(p=>p.id));
    const index=occupancy([...next].filter(([id,key])=>key&&!sharedIds.has(id)).map(([,key])=>state.sites.get(key)).concat(fieldObstacles(state)));
    const place=(p,s)=>{next.set(p.id,defineSite(state,s.x,s.y));index.add(s);};
    try {
    grassCluster(state,area,members,options.ordering||before,index,place);
    const chosen=members.map(p=>state.sites.get(next.get(p.id))).filter(Boolean);
    const displaced=shared.filter(p=>chosen.some(s=>distance(p,s)<4));
    for(const p of displaced)next.set(p.id,null);
    const occupied=occupancy([...next.values()].filter(Boolean).map(key=>state.sites.get(key)).concat(fieldObstacles(state)));
    if(displaced.length) {
      const available=[];
      for(let j=-119;j<=119;j++)for(let i=-119;i<=119;i++) {
        const ring=Math.max(Math.abs(i),Math.abs(j),Math.abs(i+j));if(ring<37||ring>119)continue;
        const s={x:500+i+Math.floor(j/2),y:500+j,ring,zone:'grass',angle:Math.atan2(i+j/2,-j)};
        if(!inMudArea(s,area)&&!state.blocked.has(siteKey(s))&&clearOfTurrets(s,state.turrets)&&occupied.fits(s))available.push(s);
      }
      for(const p of displaced) {
        available.sort((a,b)=>distance(a,p)-distance(b,p)||Math.abs(a.ring-p.ring)-Math.abs(b.ring-p.ring)||a.x-b.x||a.y-b.y);
        const own=state.sections[p.section];
        const s=available.find(s=>(p.section==='Other'||!own||own.sharedOpenSpots||inMudArea(s,own))&&
          (!fallsBack(p)||s.ring>=p.ring)&&occupied.fits(s));
        if(!s)throw Error('Blocking grass players cannot be relocated safely inside their own areas. No changes applied.');
        next.set(p.id,defineSite(state,s.x,s.y));occupied.add(s);
      }
    }
    assertPairZones(state,next);state.assignments=next;
    return {moved:members.filter(p=>before.get(p.id)!==next.get(p.id)).length,
      waiting:members.filter(p=>next.get(p.id)==null).length,displacedShared:displaced.filter(p=>p.section==='Other').length,
      displacedGrass:displaced.length,
      lockedOutside:areaReport(state,section).lockedOutside};
    }catch(e){importDraft(state,snapshot);throw e;}
  }

  // Free only this shared alliance group. Foreign HQs and all reservations are obstacles.
  function arrangeArea(state, section, ordering=null) {
    const area=state.sections[section], tags=new Set(Object.keys(state.sections).filter(tag=>
      tag===section||(area.group&&state.sections[tag].group===area.group)));
    const before=new Map(state.assignments), members=[...state.players.values()].filter(p=>p.placementEligible!==false&&tags.has(p.section)&&!state.locks.has(p.id));
    const next=new Map(state.assignments);
    for(const p of members)next.set(p.id,null);
    const occupied=[...next.values()].filter(Boolean).map(key=>state.sites.get(key)).concat(fieldObstacles(state));
    const index=occupancy(occupied);
    const used=new Set([...next.values()].filter(Boolean));
    const center=area.start+((area.end-area.start+2*Math.PI)%(2*Math.PI)||2*Math.PI)/2;
    const fits=(s,gap=0)=>!used.has(siteKey(s))&&index.fits(s,gap);
    const place=(p,s)=>{const key=defineSite(state,s.x,s.y);next.set(p.id,key);used.add(key);index.add(s);};
    const combat=(a,b)=>(b.heroPower??-1)-(a.heroPower??-1)||(b.totalPower??-1)-(a.totalPower??-1)||b.hq-a.hq||a.id-b.id;
    const regular=members.filter(p=>!needsRear(p)).sort(combat), rear=members.filter(needsRear).sort((a,b)=>a.priority-b.priority||b.hq-a.hq||a.id-b.id);
    const mudOrder=area.mudOrder?new Map(area.mudOrder.map((id,i)=>[id,i])):null;
    // A pinned mud list sets the ORDER members fill mud, never a cap: filtering mud down to the
    // list alone left every spare mud slot in the wedge empty while members sat out in grass.
    if(mudOrder)regular.sort((a,b)=>(mudOrder.get(a.id)??Infinity)-(mudOrder.get(b.id)??Infinity)||
      (b.heroPower??-1)-(a.heroPower??-1)||(b.totalPower??-1)-(a.totalPower??-1)||b.hq-a.hq||a.id-b.id);
    const mudMembers=[...regular];
    const frontLayers=area.frontLayers??1, bodyGap=area.bodyGap??1, frontEnd=19+3*(frontLayers-1);
    const mud=[];
    for(let j=-34;j<=34;j++)for(let i=-34;i<=34;i++) {
      const x=500+i+Math.floor(j/2),y=500+j;
      const ring=Math.max(Math.abs(i),Math.abs(j),Math.abs(i+j));
      if(ring<19||ring>34)continue;
      const s={x,y,ring,zone:'mud',angle:Math.atan2(i+j/2,-j)};
      if(inMudArea(s,area)&&!state.blocked.has(siteKey(s))&&clearOfTurrets(s,state.turrets))mud.push(s);
    }
    const front=mud.filter(s=>frontLayers&&s.ring<=frontEnd&&(s.ring-19)%3===0);
    const body=mud.filter(s=>!frontLayers||s.ring>=frontEnd+3+bodyGap);
    const order=(a,b)=>a.ring-b.ring||angularGap(a.angle,center)-angularGap(b.angle,center)||a.x-b.x||a.y-b.y;
    front.sort(order);body.sort(order);
    for(const [candidates,gap] of [[front,0],[body,bodyGap]])for(const s of candidates) {
      if(!mudMembers.length)break;
      if(fits(s,gap)) {
        const player=mudMembers.shift();place(player,s);
        const used=regular.indexOf(player);if(used>=0)regular.splice(used,1);
      }
    }
    if(area.grassCompact) {
      const snapshot=exportDraft(state);state.assignments=next;
      try {
        const report=arrangeGrass(state,section,{memberIds:[...regular,...rear].map(p=>p.id),ordering:ordering||before});
        return {...report,moved:members.filter(p=>before.get(p.id)!==state.assignments.get(p.id)).length};
      }catch(e){importDraft(state,snapshot);throw e;}
    }
    const grass=area.grassCompact?[]:[...state.sites.values()].filter(s=>s.zone==='grass'&&(!area.grassOnly||inMudArea(s,area)));
    grass.sort(order);
    for(const p of regular.sort((a,b)=>a.priority-b.priority||b.hq-a.hq||a.id-b.id)) {
      const s=grass.find(s=>fits(s));if(s)place(p,s);
    }
    // Prior absences and unshielded HQs use the back of their own wedge.
    grass.sort((a,b)=>b.ring-a.ring||angularGap(a.angle,center)-angularGap(b.angle,center));
    for(const p of rear) { const s=grass.find(s=>fits(s));if(s)place(p,s); }
    assertPairZones(state,next);state.assignments=next;
    return {moved:members.filter(p=>before.get(p.id)!==next.get(p.id)).length,
      waiting:members.filter(p=>next.get(p.id)==null).length,lockedOutside:areaReport(state,section).lockedOutside};
  }

  function arrangeAll(state, rules) {
    const before=exportDraft(state),beforeAssignments=new Map(state.assignments);
    try {
      const groups=new Set(),sections=[];
      for(const [tag,area] of Object.entries(state.sections)) {
        if(tag==='Other'||area.sharedOpenSpots)continue;
        const group=area.group||tag;if(groups.has(group))continue;groups.add(group);sections.push(tag);
        setSection(state,tag,norm(area.start*180/Math.PI),Math.abs(area.end-area.start)>=2*Math.PI-1e-10?360:norm(area.end*180/Math.PI),rules);
      }
      for(const [id] of state.assignments)if(!state.locks.has(id))state.assignments.set(id,null);
      for(const tag of sections)arrangeArea(state,tag,beforeAssignments);
      // Ungrouped players take the remaining shared grass after the named alliances.
      const occupied=[...state.assignments.values()].filter(Boolean).map(key=>state.sites.get(key)).concat(fieldObstacles(state));
      const index=occupancy(occupied);
      const other=[...state.players.values()].filter(p=>p.placementEligible!==false&&!state.locks.has(p.id)&&(!state.sections[p.section]||p.section==='Other'||state.sections[p.section].sharedOpenSpots));
      const grass=[...state.sites.values()].filter(s=>s.zone==='grass');
      other.sort((a,b)=>Number(needsRear(a))-Number(needsRear(b))||a.priority-b.priority||b.hq-a.hq||a.id-b.id);
      for(const p of other) {
        grass.sort((a,b)=>(fallsBack(p)?b.ring-a.ring:a.ring-b.ring)||a.angle-b.angle);
        const s=grass.find(s=>index.fits(s));
        if(s){state.assignments.set(p.id,siteKey(s));index.add(s);}
      }
      assertPairZones(state);
      return {moved:[...state.assignments].filter(([id,key])=>beforeAssignments.get(id)!==key).length,
        waiting:[...state.assignments.values()].filter(key=>key===null).length,
        lockedOutside:sections.reduce((n,tag)=>n+areaReport(state,tag).lockedOutside,0)};
    }catch(e){importDraft(state,before);throw e;}
  }

  function pushBack(state, section = '') {
    const ids = [...state.players.keys()].filter(id => state.players.get(id).placementEligible!==false&&state.assignments.get(id) == null &&
      (!section || state.players.get(id).section === section));
    ids.sort((a,b) => state.players.get(b).priority - state.players.get(a).priority ||
      state.players.get(a).hq - state.players.get(b).hq || a-b);
    const used = new Set(), rear=rearSites(state);
    for (const id of ids) {
      const player = state.players.get(id), area = state.sections[player.section];
      const playerRear=rearForPlayer(state,player,rear);
      const occupied=occupancy([...state.assignments.values()].filter(Boolean).map(key=>state.sites.get(key)).concat(fieldObstacles(state)));
      const choices = [...state.sites].filter(([key,s]) => s.zone === 'grass' && !used.has(key) &&
        (!area?.grassOnly || (inMudArea(s,area)&&playerAt(state,key)==null&&occupied.fits(s))) &&
        (needsRear(player) ? playerRear.has(key) : !playerRear.has(key)) &&
        !state.locks.has(playerAt(state,key)));
      const center=area ? area.start+((area.end-area.start+2*Math.PI)%(2*Math.PI))/2 : 0;
      choices.sort((a,b) => b[1].ring-a[1].ring||angularGap(a[1].angle,center)-angularGap(b[1].angle,center));
      if (!choices.length) continue;
      const key=choices[0][0], occupant=playerAt(state,key);
      state.assignments.set(id,key); if (occupant != null) state.assignments.set(occupant,null);
      used.add(key);
    }
    return used.size;
  }

  function unassign(state, id) {
    id=Number(id);
    if (!state.players.has(id)) throw Error('Choose a player first');
    if (state.pairs.some(p => p.strike===id || p.reserve===id)) throw Error('Remove their swap pair first');
    state.assignments.set(id,null); state.locks.delete(id);
  }

  function arrangeAlliance(state, section) {
    const area=state.sections[section];
    if (!area) throw Error('Choose an alliance first');
    if (area.grassOnly!==undefined || area.frontLayers!==undefined) return arrangeArea(state,section);
    const used=new Set(), rear=rearSites(state); let moved=0, waiting=0;
    const inArea=s=>inMudArea(s,area);
    const members=[...state.players].filter(([id,p])=>p.placementEligible!==false&&p.section===section&&!state.locks.has(id));
    const mudCapacity=[...state.sites].filter(([key,s])=>s.zone==='mud'&&inArea(s)&&!state.locks.has(playerAt(state,key))).length;
    const strictMud=members.filter(([,p])=>!needsRear(p)&&!isUnaligned(p)).sort((a,b)=>
      (b[1].heroPower??-1)-(a[1].heroPower??-1)||(b[1].totalPower??-1)-(a[1].totalPower??-1)||b[1].hq-a[1].hq||a[0]-b[0])
      .slice(0,mudCapacity).map(([id])=>id);
    for (const zone of ['mud','grass']) {
      const ids=members.filter(([id,p]) => state.leadershipMudBoundaries ?
        (zone==='mud')===strictMud.includes(id) :
        (zone==='mud')===(p.hq>=24 && !p.highRisk && !isUnaligned(p) && p.attendanceProxy!=='outside_capital_area'))
        .map(([id])=>id);
      ids.sort((a,b) => {
        const x=state.players.get(a),y=state.players.get(b);
        return zone==='mud' ? (y.heroPower??-1)-(x.heroPower??-1) || (y.totalPower??-1)-(x.totalPower??-1) || y.hq-x.hq || a-b
          : Number(isUnaligned(x))-Number(isUnaligned(y)) || x.priority-y.priority || y.hq-x.hq || a-b;
      });
      const target=area.start+((area.end-area.start+2*Math.PI)%(2*Math.PI))/2;
      for (const id of ids) {
        const player=state.players.get(id);
        const options=[...state.sites].filter(([key,s]) => s.zone===zone && !used.has(key) &&
          (zone!=='mud'||!state.leadershipMudBoundaries||inArea(s)) &&
          (zone!=='grass' || (needsRear(player) ? rear.has(key) : !rear.has(key))) &&
          (!state.locks.has(playerAt(state,key)) || playerAt(state,key)===id));
        const score=s=>s.ring*100+angularGap(s.angle,target)*200+
          (needsRear(player)||inWedge(s,area.start*180/Math.PI,area.end*180/Math.PI)?0:500);
        options.sort((a,b)=>score(a[1])-score(b[1]));
        if (!options.length) { waiting++; continue; }
        const key=options[0][0],prior=state.assignments.get(id),other=playerAt(state,key);
        state.assignments.set(id,key);
        if (other!=null && other!==id) state.assignments.set(other,prior);
        used.add(key);if(key!==prior)moved++;
      }
    }
    assertPairZones(state);
    return {moved,waiting};
  }

  function fill(state, options = {}) {
    const { start = 0, end = 360, section = '', zone = '' } = options;
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw Error('Wedge angles must be numbers');
    const next = new Map(state.assignments), rear=rearSites(state);
    let changed = 0;
    for (const terrain of (zone ? [zone] : ['mud', 'grass'])) {
      const ids = [...state.players.keys()].filter(id => {
        const site = state.sites.get(next.get(id));
        const player = state.players.get(id);
        const mudEligible = !player.highRisk && !isUnaligned(player) && player.attendanceProxy !== 'outside_capital_area' &&
          (state.leadershipMudBoundaries ? player.section!=='Other' : player.hq>=24);
        return player.placementEligible!==false&&!state.locks.has(id) && (site ? site.zone === terrain && inWedge(site, start, end)
          : terrain === 'grass' || mudEligible)
          && (!section || state.players.get(id).section === section);
      });
      const movable = new Set(ids);
      const open = [...state.sites].filter(([key,s]) => s.zone === terrain && inWedge(s,start,end) &&
        (playerAt({ ...state, assignments: next },key) == null || movable.has(playerAt({ ...state, assignments: next },key))))
        .map(([,site]) => site);
      for (const id of ids) next.set(id,null);
      ids.sort((a, b) => {
        const x = state.players.get(a), y = state.players.get(b);
        if (terrain === 'mud') return (y.heroPower ?? -1) - (x.heroPower ?? -1) ||
          (y.totalPower ?? -1) - (x.totalPower ?? -1) || y.hq - x.hq || a - b;
        return Number(isUnaligned(x))-Number(isUnaligned(y)) || x.priority - y.priority || y.hq - x.hq || a - b;
      });
      const full = Math.abs(end - start) >= 360;
      for (const id of ids) {
        const player = state.players.get(id);
        const sectionInfo = state.sections[player.section] || options.sections?.[player.section];
        const playerRear=rearForPlayer(state,player,rear);
        const target = !full ? norm(start + ((end - start + 360) % 360) / 2) * Math.PI / 180
          : sectionInfo ? (sectionInfo.start + sectionInfo.end) / 2 : 0;
        let best = -1, bestScore = Infinity;
        for (let k = 0; k < open.length; k++) {
          const s = open[k];
          const insideSection = !sectionInfo || inWedge(s, sectionInfo.start*180/Math.PI, sectionInfo.end*180/Math.PI);
          if (terrain==='mud' && state.leadershipMudBoundaries && (!sectionInfo || player.section==='Other' || !inMudArea(s,sectionInfo))) continue;
          if (terrain==='grass' && sectionInfo?.grassOnly && !inMudArea(s,sectionInfo)) continue;
          if (terrain==='grass' && !isUnaligned(player) && needsRear(player)!==playerRear.has(siteKey(s))) continue;
          if(fieldObstacles(state).some(p=>distance(p,s)<3))continue;
          if (state.sites.size>state.baseSites.size && [...next].some(([other,key])=>other!==id&&key!=null&&distance(s,state.sites.get(key))<(terrain==='grass'&&state.sites.get(key).zone==='grass'?4:3))) continue;
          const score = (insideSection || fallsBack(player) ? 0 : 500) + (fallsBack(player) ? -s.ring : s.ring) * 100 + angularGap(s.angle, target)*200;
          if (score < bestScore) { bestScore = score; best = k; }
        }
        if (best < 0) continue;
        const site = open.splice(best, 1)[0];
        const key = siteKey(site);
        if (key !== next.get(id)) changed++;
        next.set(id, key);
      }
    }
    assertPairZones(state, next);
    state.assignments = next;
    return changed;
  }

  function addPair(state, strike, reserve) {
    strike = Number(strike); reserve = Number(reserve);
    if (!state.players.has(strike) || !state.players.has(reserve) || strike === reserve)
      throw Error('Choose distinct strike and reserve players');
    if (state.pairs.some(p => [p.strike, p.reserve].includes(strike) || [p.strike, p.reserve].includes(reserve)))
      throw Error('A player can belong to only one swap pair');
    if (state.sites.get(state.assignments.get(strike))?.zone !== 'grass' ||
        state.sites.get(state.assignments.get(reserve))?.zone !== 'mud')
      throw Error('Stage the strike player in grass and the reserve in mud first');
    state.pairs.push({ strike, reserve });
    state.locks.add(strike); state.locks.add(reserve);
  }

  function removePair(state, strike) {
    state.pairs = state.pairs.filter(p => p.strike !== Number(strike));
  }

  function exportDraft(state) {
    const used=new Set(state.assignments.values());
    const sites=[...state.sites].filter(([key])=>used.has(key)&&!state.baseSites.has(key)).map(([,s])=>({x:s.x,y:s.y}));
    const survey=state.survey&&{...state.survey,anchors:state.survey.anchors.filter(p=>isFieldAnchor(state,p.id)&&state.assignments.get(p.id)===siteKey(p))};
    return { version: 1, signature: state.signature, ...(state.planningMode?{planningMode:true}:{}), ...(sites.length?{sites}:{}), ...(survey?{survey}:{}),
      ...(state.allianceTags?.size?{allianceTags:[...state.allianceTags]}:{}), assignments: [...state.assignments], sections: structuredClone(state.sections), locks: [...state.locks], pairs: state.pairs.map(p => ({ ...p })) };
  }

  function importDraft(state, draft) {
    if (draft?.version !== 1 || draft.signature !== state.signature) throw Error('Draft belongs to a different base plan');
    if (!Array.isArray(draft.assignments) || draft.assignments.length !== state.players.size) throw Error('Draft is missing players');
    if(draft.planningMode!==undefined&&typeof draft.planningMode!=='boolean')throw Error('Invalid draft planning mode');
    validateSurvey(state,draft.survey);
    const allianceTags=new Map(draft.allianceTags||[]);
    if(draft.allianceTags!==undefined&&(!Array.isArray(draft.allianceTags)||draft.allianceTags.length>state.players.size||allianceTags.size!==draft.allianceTags.length||draft.allianceTags.some(p=>!Array.isArray(p)||p.length!==2||!Number.isSafeInteger(p[0])||!state.players.has(p[0])||!validAllianceTag(p[1]))))throw Error('Invalid alliance memberships');
    const players=alliancePlayers(state,draft.sections||state.sections,draft.survey,allianceTags);
    const anchorMap=new Map((draft.survey?.anchors||[]).map(p=>[p.id,p]));
    if (draft.sites!==undefined && (!Array.isArray(draft.sites)||draft.sites.length>state.players.size)) throw Error('Draft has invalid custom tiles');
    const sites=new Map(state.baseSites);
    for(const s of draft.sites||[]) {
      if(!s||sites.has(siteKey(s)))throw Error('Draft has duplicate custom tiles');
      const legal=coordinateSite(state,s.x,s.y);sites.set(siteKey(legal),legal);
    }
    const assignments = new Map(draft.assignments.map(([id, key]) => [Number(id), key]));
    const placed = [...assignments.values()].filter(key => key !== null);
    if (assignments.size !== state.players.size || new Set(placed).size !== placed.length ||
        [...assignments.keys()].some(id => !state.players.has(id)) ||
        placed.some(key => !sites.has(key))) throw Error('Draft has duplicate or unknown players or sites');
    const custom=new Set((draft.sites||[]).map(siteKey));
    const anchoredSites=new Set([...anchorMap.values()].map(siteKey));
    const owners=new Map([...assignments].map(([id,key])=>[key,id])),defence={...state,players,sections:draft.sections||state.sections};
    for(const key of custom) {
      if(!placed.includes(key))throw Error('Draft has unused custom tiles');
      const a=sites.get(key);
      for(const other of placed)if(other!==key) {
        const b=sites.get(other);
        const existing=anchoredSites.has(key)&&anchoredSites.has(other);
        const ownerA=owners.get(key),ownerB=owners.get(other);
        if(distance(a,b)<(!existing&&a.zone==='grass'&&b.zone==='grass'&&!tightPlacement(defence,ownerA)&&!tightPlacement(defence,ownerB)?4:3))throw Error('Draft has overlapping HQ footprints');
      }
    }
    const locks = new Set((draft.locks || []).map(Number));
    for(const p of anchorMap.values())if(!locks.has(p.id)||assignments.get(p.id)!==siteKey(p))throw Error('Surveyed HQ must stay locked at its observed coordinates');
    for(const p of draft.survey?.obstacles||[])for(const key of placed)if(distance(p,sites.get(key))<3)throw Error('Draft overlaps an observed in-game HQ');
    if ([...locks].some(id => !state.players.has(id) || assignments.get(id) == null)) throw Error('Draft has an unknown or unassigned locked player');
    const pairs = (draft.pairs || []).map(p => ({ strike: Number(p.strike), reserve: Number(p.reserve) }));
    const members = pairs.flatMap(p => [p.strike, p.reserve]);
    if (new Set(members).size !== members.length || members.some(id => !state.players.has(id) || !locks.has(id)))
      throw Error('Draft has an invalid swap pair');
    const candidate = { ...state, players, sites, assignments, pairs };
    assertPairZones(candidate);
    if (draft.sections !== undefined) {
      if (!draft.sections || typeof draft.sections !== 'object' || Array.isArray(draft.sections) ||
          Object.keys(draft.sections).length>100 || Object.keys(draft.sections).some(tag => !validAllianceTag(tag)) ||
          new Set(Object.keys(draft.sections).map(t=>t.toLowerCase())).size!==Object.keys(draft.sections).length ||
          Object.values(draft.sections).some(s => !s || !Number.isFinite(s.start) || !Number.isFinite(s.end) ||
            (s.grassOnly!==undefined&&typeof s.grassOnly!=='boolean') ||
            (s.grassCompact!==undefined&&typeof s.grassCompact!=='boolean') ||
            (s.defencePacking!==undefined&&typeof s.defencePacking!=='boolean') ||
            (s.grassOrder!==undefined&&(!Array.isArray(s.grassOrder)||s.grassOrder.length>state.players.size||
              new Set(s.grassOrder).size!==s.grassOrder.length||s.grassOrder.some(id=>!state.players.has(id)))) ||
            (s.mudOrder!==undefined&&(!Array.isArray(s.mudOrder)||s.mudOrder.length>state.players.size||
              new Set(s.mudOrder).size!==s.mudOrder.length||s.mudOrder.some(id=>!state.players.has(id)))) ||
            (s.frontLayers!==undefined&&![0,1,2,3].includes(s.frontLayers)) ||
            (s.bodyGap!==undefined&&![0,1,2,3].includes(s.bodyGap))))
        throw Error('Draft has invalid alliance boundaries');
      state.sections = structuredClone(draft.sections);
    }
    state.players=players;state.allianceTags=allianceTags;
    state.survey=draft.survey?structuredClone(draft.survey):undefined;state.anchorMap=anchorMap;
    state.planningMode=draft.planningMode===true;
    state.sites=sites;state.assignments = assignments; state.locks = locks; state.pairs = pairs;
  }

  return { create, siteKey, playerAt, current, rows, moveAndLock, inWedge, fill, rearReasons, isUnaligned, clearOfTurrets,
           distance, coordinateSite, defineSite, checkPlacement, areaReport, teleportGaps, teleportOpenings, defenceReport,
           clearForPlanning, validAllianceTag, addAlliance, removeAlliance, refreshAllianceMemberships, clear, unassign, setSection, pushBack, arrangeAlliance, arrangeGrass, arrangeAll, addPair, removePair, exportDraft, importDraft };
});

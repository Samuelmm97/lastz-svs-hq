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
  function rearReasons(player) {
    const reasons=[];
    if (player.attendanceProxy==='outside_capital_area') reasons.push('Not in the capital area last SvS');
    if (player.highRisk) reasons.push('Unshielded last SvS');
    return reasons;
  }
  const needsRear = player => rearReasons(player).length>0;
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

  function create(plan) {
    const players = new Map(plan.placements.map(p => [p.id, p]));
    const blocked = new Set(plan.blockedSites || []);
    const allSites = new Map(plan.placements.map(p => [siteKey(p), siteOf(p)]));
    for(const [key,site] of allSites)if(!clearOfTurrets(site,plan.meta?.turrets))blocked.add(key);
    const sites = new Map([...allSites].filter(([key]) => !blocked.has(key)));
    if (players.size !== plan.placements.length || allSites.size !== plan.placements.length) throw Error('Base plan has duplicate IDs or sites');
    const signature = (plan.planId ? `${plan.planId}:` : '') + plan.placements.map(p => `${p.id}@${siteKey(p)}`).sort().join('|');
    return { players, sites, signature, assignments: new Map(plan.placements.map(p => [p.id, blocked.has(siteKey(p)) ? null : siteKey(p)])),
             sections: structuredClone(plan.sections || {}), locks: new Set(), pairs: [],
             leadershipMudBoundaries: plan.meta?.leadershipMudBoundaries===true };
  }

  function playerAt(state, key) {
    for (const [id, site] of state.assignments) if (site === key) return id;
    return null;
  }

  function current(state, id) {
    const player = state.players.get(Number(id)), key = state.assignments.get(Number(id));
    if (!player) return null;
    if (key == null) return { ...player, x: null, y: null, zone: 'unassigned', ring: null, angle: null, spot: null, locked: false };
    return { ...player, ...state.sites.get(key), locked: state.locks.has(Number(id)) };
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
      if (state.sites.get(assignments.get(pair.strike)).zone !== 'grass' ||
          state.sites.get(assignments.get(pair.reserve)).zone !== 'mud')
        throw Error('Strike players must stage in grass and reserves must hold mud spots');
    }
  }

  function moveAndLock(state, id, targetKey) {
    id = Number(id);
    if (!state.players.has(id)) throw Error('Choose a player first');
    if (!state.sites.has(targetKey)) throw Error('Choose an existing legal site');
    const prior = state.assignments.get(id);
    const occupant = playerAt(state, targetKey);
    if (occupant !== id && state.locks.has(occupant)) throw Error('That site is held by another locked player');
    const next = new Map(state.assignments);
    next.set(id, targetKey);
    if (occupant !== id && occupant != null) next.set(occupant, prior);
    assertPairZones(state, next);
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
      if (!site || site.zone !== zone || !inWedge(site, start, end) ||
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

  function setSection(state, section, start, end) {
    if (!state.sections[section] || !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || start > 360 || end < 0 || end > 360 || start === end)
      throw Error('Choose an alliance and two different boundary angles between 0° and 360°');
    const group=state.sections[section].group;
    for (const [tag,area] of Object.entries(state.sections)) if (tag===section || (group && area.group===group))
      state.sections[tag] = { ...area, start: start*Math.PI/180, end: end*Math.PI/180 };
  }

  function pushBack(state, section = '') {
    const ids = [...state.players.keys()].filter(id => state.assignments.get(id) == null &&
      (!section || state.players.get(id).section === section));
    ids.sort((a,b) => state.players.get(b).priority - state.players.get(a).priority ||
      state.players.get(a).hq - state.players.get(b).hq || a-b);
    const used = new Set(), rear=rearSites(state);
    for (const id of ids) {
      const player = state.players.get(id), area = state.sections[player.section];
      const choices = [...state.sites].filter(([key,s]) => s.zone === 'grass' && !used.has(key) &&
        (needsRear(player) ? rear.has(key) : !rear.has(key)) &&
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
    const used=new Set(), rear=rearSites(state); let moved=0, waiting=0;
    const inArea=s=>inMudArea(s,area);
    const members=[...state.players].filter(([id,p])=>p.section===section&&!state.locks.has(id));
    const mudCapacity=[...state.sites].filter(([key,s])=>s.zone==='mud'&&inArea(s)&&!state.locks.has(playerAt(state,key))).length;
    const strictMud=members.filter(([,p])=>!needsRear(p)).sort((a,b)=>
      (b[1].heroPower??-1)-(a[1].heroPower??-1)||(b[1].totalPower??-1)-(a[1].totalPower??-1)||b[1].hq-a[1].hq||a[0]-b[0])
      .slice(0,mudCapacity).map(([id])=>id);
    for (const zone of ['mud','grass']) {
      const ids=members.filter(([id,p]) => state.leadershipMudBoundaries ?
        (zone==='mud')===strictMud.includes(id) :
        (zone==='mud')===(p.hq>=24 && !p.highRisk && p.attendanceProxy!=='outside_capital_area'))
        .map(([id])=>id);
      ids.sort((a,b) => {
        const x=state.players.get(a),y=state.players.get(b);
        return zone==='mud' ? (y.heroPower??-1)-(x.heroPower??-1) || (y.totalPower??-1)-(x.totalPower??-1) || y.hq-x.hq || a-b
          : x.priority-y.priority || y.hq-x.hq || a-b;
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
        const mudEligible = !player.highRisk && player.attendanceProxy !== 'outside_capital_area' &&
          (state.leadershipMudBoundaries ? player.section!=='Other' : player.hq>=24);
        return !state.locks.has(id) && (site ? site.zone === terrain && inWedge(site, start, end)
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
        return x.priority - y.priority || y.hq - x.hq || a - b;
      });
      const full = Math.abs(end - start) >= 360;
      for (const id of ids) {
        const player = state.players.get(id);
        const sectionInfo = state.sections[player.section] || options.sections?.[player.section];
        const target = !full ? norm(start + ((end - start + 360) % 360) / 2) * Math.PI / 180
          : sectionInfo ? (sectionInfo.start + sectionInfo.end) / 2 : 0;
        let best = -1, bestScore = Infinity;
        for (let k = 0; k < open.length; k++) {
          const s = open[k];
          const insideSection = !sectionInfo || inWedge(s, sectionInfo.start*180/Math.PI, sectionInfo.end*180/Math.PI);
          if (terrain==='mud' && state.leadershipMudBoundaries && (!sectionInfo || player.section==='Other' || !inMudArea(s,sectionInfo))) continue;
          if (terrain==='grass' && needsRear(player)!==rear.has(siteKey(s))) continue;
          const score = (insideSection || needsRear(player) ? 0 : 500) + s.ring * 100 + angularGap(s.angle, target)*200;
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
    if (state.sites.get(state.assignments.get(strike)).zone !== 'grass' ||
        state.sites.get(state.assignments.get(reserve)).zone !== 'mud')
      throw Error('Stage the strike player in grass and the reserve in mud first');
    state.pairs.push({ strike, reserve });
    state.locks.add(strike); state.locks.add(reserve);
  }

  function removePair(state, strike) {
    state.pairs = state.pairs.filter(p => p.strike !== Number(strike));
  }

  function exportDraft(state) {
    return { version: 1, signature: state.signature,
      assignments: [...state.assignments], sections: structuredClone(state.sections), locks: [...state.locks], pairs: state.pairs.map(p => ({ ...p })) };
  }

  function importDraft(state, draft) {
    if (draft?.version !== 1 || draft.signature !== state.signature) throw Error('Draft belongs to a different base plan');
    if (!Array.isArray(draft.assignments) || draft.assignments.length !== state.players.size) throw Error('Draft is missing players');
    const assignments = new Map(draft.assignments.map(([id, key]) => [Number(id), key]));
    const placed = [...assignments.values()].filter(key => key !== null);
    if (assignments.size !== state.players.size || new Set(placed).size !== placed.length ||
        [...assignments.keys()].some(id => !state.players.has(id)) ||
        placed.some(key => !state.sites.has(key))) throw Error('Draft has duplicate or unknown players or sites');
    const locks = new Set((draft.locks || []).map(Number));
    if ([...locks].some(id => !state.players.has(id) || assignments.get(id) == null)) throw Error('Draft has an unknown or unassigned locked player');
    const pairs = (draft.pairs || []).map(p => ({ strike: Number(p.strike), reserve: Number(p.reserve) }));
    const members = pairs.flatMap(p => [p.strike, p.reserve]);
    if (new Set(members).size !== members.length || members.some(id => !state.players.has(id) || !locks.has(id)))
      throw Error('Draft has an invalid swap pair');
    const candidate = { ...state, assignments, pairs };
    assertPairZones(candidate);
    if (draft.sections !== undefined) {
      if (!draft.sections || typeof draft.sections !== 'object' || Array.isArray(draft.sections) ||
          Object.keys(draft.sections).some(tag => !Object.hasOwn(state.sections,tag)) ||
          Object.values(draft.sections).some(s => !s || !Number.isFinite(s.start) || !Number.isFinite(s.end)))
        throw Error('Draft has invalid alliance boundaries');
      state.sections = structuredClone(draft.sections);
    }
    state.assignments = assignments; state.locks = locks; state.pairs = pairs;
  }

  return { create, siteKey, playerAt, current, rows, moveAndLock, inWedge, fill, rearReasons, clearOfTurrets,
           clear, unassign, setSection, pushBack, arrangeAlliance, addPair, removePair, exportDraft, importDraft };
});

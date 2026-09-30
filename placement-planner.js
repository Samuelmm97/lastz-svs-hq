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

  function create(plan) {
    const players = new Map(plan.placements.map(p => [p.id, p]));
    const sites = new Map(plan.placements.map(p => [siteKey(p), siteOf(p)]));
    if (players.size !== plan.placements.length || sites.size !== plan.placements.length) throw Error('Base plan has duplicate IDs or sites');
    const signature = plan.placements.map(p => `${p.id}@${siteKey(p)}`).sort().join('|');
    return { players, sites, signature, assignments: new Map(plan.placements.map(p => [p.id, siteKey(p)])),
             locks: new Set(), pairs: [] };
  }

  function playerAt(state, key) {
    for (const [id, site] of state.assignments) if (site === key) return id;
    return null;
  }

  function current(state, id) {
    const player = state.players.get(Number(id)), key = state.assignments.get(Number(id));
    if (!player || !key) return null;
    return { ...player, ...state.sites.get(key), locked: state.locks.has(Number(id)) };
  }

  function rows(state, afterSwap = false) {
    const overrides = new Map();
    if (afterSwap) for (const pair of state.pairs) {
      overrides.set(pair.strike, state.assignments.get(pair.reserve));
      overrides.set(pair.reserve, state.assignments.get(pair.strike));
    }
    return [...state.players.keys()].map(id => ({ ...state.players.get(id),
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
    if (occupant !== id) next.set(occupant, prior);
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

  function fill(state, options = {}) {
    const { start = 0, end = 360, section = '', zone = '' } = options;
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw Error('Wedge angles must be numbers');
    const next = new Map(state.assignments);
    let changed = 0;
    for (const terrain of (zone ? [zone] : ['mud', 'grass'])) {
      const ids = [...state.players.keys()].filter(id => {
        const site = state.sites.get(next.get(id));
        return !state.locks.has(id) && site.zone === terrain && inWedge(site, start, end)
          && (!section || state.players.get(id).section === section);
      });
      const open = ids.map(id => state.sites.get(next.get(id)));
      ids.sort((a, b) => {
        const x = state.players.get(a), y = state.players.get(b);
        return x.priority - y.priority || y.hq - x.hq || a - b;
      });
      const full = Math.abs(end - start) >= 360;
      for (const id of ids) {
        const player = state.players.get(id);
        const sectionInfo = options.sections?.[player.section];
        const target = !full ? norm(start + ((end - start + 360) % 360) / 2) * Math.PI / 180
          : sectionInfo ? (sectionInfo.start + sectionInfo.end) / 2 : 0;
        let best = 0, bestScore = Infinity;
        for (let k = 0; k < open.length; k++) {
          const s = open[k];
          const score = s.ring * 100 + angularGap(s.angle, target);
          if (score < bestScore) { bestScore = score; best = k; }
        }
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
      assignments: [...state.assignments], locks: [...state.locks], pairs: state.pairs.map(p => ({ ...p })) };
  }

  function importDraft(state, draft) {
    if (draft?.version !== 1 || draft.signature !== state.signature) throw Error('Draft belongs to a different base plan');
    if (!Array.isArray(draft.assignments) || draft.assignments.length !== state.players.size) throw Error('Draft is missing players');
    const assignments = new Map(draft.assignments.map(([id, key]) => [Number(id), key]));
    if (assignments.size !== state.players.size || new Set(assignments.values()).size !== state.sites.size ||
        [...assignments.keys()].some(id => !state.players.has(id)) ||
        [...assignments.values()].some(key => !state.sites.has(key))) throw Error('Draft has duplicate or unknown players or sites');
    const locks = new Set((draft.locks || []).map(Number));
    if ([...locks].some(id => !state.players.has(id))) throw Error('Draft has an unknown locked player');
    const pairs = (draft.pairs || []).map(p => ({ strike: Number(p.strike), reserve: Number(p.reserve) }));
    const members = pairs.flatMap(p => [p.strike, p.reserve]);
    if (new Set(members).size !== members.length || members.some(id => !state.players.has(id) || !locks.has(id)))
      throw Error('Draft has an invalid swap pair');
    const candidate = { ...state, assignments, pairs };
    assertPairZones(candidate);
    state.assignments = assignments; state.locks = locks; state.pairs = pairs;
  }

  return { create, siteKey, playerAt, current, rows, moveAndLock, inWedge, fill,
           addPair, removePair, exportDraft, importDraft };
});

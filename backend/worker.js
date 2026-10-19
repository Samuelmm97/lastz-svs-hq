import '../placement-planner.js';
const P = globalThis.PlacementPlanner;
const ORIGIN = 'https://samuelmm97.github.io';

function response(body, status = 200, origin = '') {
  const headers = { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin === ORIGIN || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, PUT, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Read-Key';
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function validDraft(draft) {
  if (!draft || draft.version !== 1 || typeof draft.signature !== 'string' ||
      !Array.isArray(draft.assignments) || draft.assignments.length !== 2000 ||
      !Array.isArray(draft.locks) || !Array.isArray(draft.pairs)) return false;
  const ids = new Set(), sites = new Set();
  for (const pair of draft.assignments) {
    if (!Array.isArray(pair) || pair.length !== 2 || !Number.isSafeInteger(pair[0]) ||
        (pair[1] !== null && (typeof pair[1] !== 'string' || !/^\d{1,3},\d{1,3}$/.test(pair[1])))) return false;
    if (ids.has(pair[0]) || (pair[1] !== null && sites.has(pair[1]))) return false;
    ids.add(pair[0]); if (pair[1] !== null) sites.add(pair[1]);
  }
  if (draft.pairs.some(p => !p || typeof p !== 'object')) return false;
  const locks = new Set(draft.locks);
  const members = draft.pairs.flatMap(p => [p.strike, p.reserve]);
  const assignments = new Map(draft.assignments);
  const sections = draft.sections;
  if(draft.sites!==undefined && (!Array.isArray(draft.sites)||draft.sites.length>2000||draft.sites.some(s=>
    !s||!Number.isInteger(s.x)||!Number.isInteger(s.y)||s.x<0||s.x>999||s.y<0||s.y>999)))return false;
  if (sections !== undefined && (!sections || Array.isArray(sections) || typeof sections !== 'object' ||
      Object.keys(sections).length > 100 || Object.entries(sections).some(([tag, s]) =>
        tag.length > 20 || !s || !Number.isFinite(s.start) || !Number.isFinite(s.end) ||
        Math.abs(s.start) > 4*Math.PI || Math.abs(s.end) > 4*Math.PI ||
        (s.grassOnly!==undefined&&typeof s.grassOnly!=='boolean') ||
        (s.grassCompact!==undefined&&typeof s.grassCompact!=='boolean') ||
        (s.defencePacking!==undefined&&typeof s.defencePacking!=='boolean') ||
        (s.grassOrder!==undefined&&(!Array.isArray(s.grassOrder)||s.grassOrder.length>2000||
          new Set(s.grassOrder).size!==s.grassOrder.length||s.grassOrder.some(id=>!Number.isSafeInteger(id)||!ids.has(id)))) ||
        (s.mudOrder!==undefined&&(!Array.isArray(s.mudOrder)||s.mudOrder.length>2000||
          new Set(s.mudOrder).size!==s.mudOrder.length||s.mudOrder.some(id=>!Number.isSafeInteger(id)||!ids.has(id)))) ||
        (s.frontLayers!==undefined&&![0,1,2,3].includes(s.frontLayers)) ||
        (s.bodyGap!==undefined&&![0,1,2,3].includes(s.bodyGap))))) return false;
  return ids.size === 2000 && locks.size === draft.locks.length &&
    draft.locks.every(id => Number.isSafeInteger(id) && ids.has(id) && assignments.get(id) !== null) &&
    members.length === new Set(members).size &&
    draft.pairs.every(p => Number.isSafeInteger(p.strike) && Number.isSafeInteger(p.reserve) &&
      ids.has(p.strike) && ids.has(p.reserve) && locks.has(p.strike) && locks.has(p.reserve));
}

function samePlan(before, after) {
  if (before.signature !== after.signature) return false;
  const ids = new Set(before.assignments.map(([id]) => id));
  const sites = new Set(before.assignments.map(([, site]) => site));
  return after.assignments.every(([id, site]) => ids.has(id) && (site === null || sites.has(site)));
}

export { validDraft, samePlan };

function planSignature(plan) {
  return (plan.planId ? `${plan.planId}:` : '') +
    plan.placements.map(p => `${p.id}@${p.x},${p.y}`).sort().join('|');
}

function validPlan(plan) {
  if (!plan || !Array.isArray(plan.placements) || plan.placements.length !== 2000 ||
      !plan.sections || typeof plan.sections !== 'object' || !plan.meta ||
      (plan.planId !== undefined && (typeof plan.planId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(plan.planId)))) return false;
  if (plan.blockedSites !== undefined && (!Array.isArray(plan.blockedSites) ||
      new Set(plan.blockedSites).size !== plan.blockedSites.length ||
      plan.blockedSites.some(key => typeof key !== 'string' || !plan.placements.some(p => `${p.x},${p.y}` === key)))) return false;
  return plan.placements.every(p => p && Number.isSafeInteger(p.id) && p.id >= 0 &&
    Number.isInteger(p.x) && p.x >= 0 && p.x <= 999 &&
    Number.isInteger(p.y) && p.y >= 0 && p.y <= 999 &&
    ['mud', 'grass'].includes(p.zone) && typeof p.name === 'string' &&
    Number.isFinite(p.ring) && Number.isFinite(p.angle) && (() => {
      const j = p.y - 500, i = p.x - 500 - Math.floor(j / 2);
      const ring = Math.max(Math.abs(i), Math.abs(j), Math.abs(i + j));
      const compact=plan.meta.mudMinDistance===3;
      return ring === p.ring && (p.zone === 'mud' ? ring >= (compact?19:20) && ring <= (compact?34:33) : ring >= 37 && ring <= 119);
    })()) &&
    (plan.meta.mudMinDistance!==3 || (() => {
      const mud=plan.placements.filter(p=>p.zone==='mud');
      for(let a=0;a<mud.length;a++)for(let b=a+1;b<mud.length;b++) {
        const aj=mud[a].y-500,bj=mud[b].y-500;
        const di=mud[a].x-Math.floor(aj/2)-mud[b].x+Math.floor(bj/2),dj=aj-bj;
        if(Math.max(Math.abs(di),Math.abs(dj),Math.abs(di+dj))<3)return false;
      }
      return true;
    })()) &&
    new Set(plan.placements.map(p => p.id)).size === 2000 &&
    new Set(plan.placements.map(p => `${p.x},${p.y}`)).size === 2000;
}

function draftFitsPlan(draft, plan) {
  if (!validDraft(draft) || !validPlan(plan) || draft.signature !== planSignature(plan)) return false;
  try {
    const state=P.create(plan);P.importDraft(state,draft);
    for(const [section,area] of Object.entries(state.sections))if(area.defencePacking&&P.teleportOpenings(state,section).some(p=>p.insideFormation))return false;
  } catch { return false; }
  return true;
}

async function archivedPlan(db, signature) {
  const row = await db.prepare('SELECT plan FROM placement_plans WHERE signature = ?').bind(signature).first();
  return row ? JSON.parse(row.plan) : null;
}

export { planSignature, validPlan, draftFitsPlan };

function changesBetween(before, after) {
  const oldSites = new Map(before?.assignments || []);
  const nextSites = new Map(after.assignments);
  const oldLocks = new Set(before?.locks || []);
  const nextLocks = new Set(after.locks);
  const pairKey = pair => `${pair.strike}:${pair.reserve}`;
  const oldPairs = new Set((before?.pairs || []).map(pairKey));
  const nextPairs = new Set(after.pairs.map(pairKey));
  return {
    added: after.assignments.filter(([id]) => !oldSites.has(id)).map(([id, to]) => ({ id, to })),
    removed: [...oldSites].filter(([id]) => !nextSites.has(id)).map(([id, from]) => ({ id, from })),
    moved: after.assignments.filter(([id, site]) => oldSites.has(id) && oldSites.get(id) !== site)
      .map(([id, to]) => ({ id, from: oldSites.get(id), to })),
    locked: after.locks.filter(id => !oldLocks.has(id)),
    unlocked: [...oldLocks].filter(id => !nextLocks.has(id)),
    paired: after.pairs.filter(pair => !oldPairs.has(pairKey(pair))),
    unpaired: (before?.pairs || []).filter(pair => !nextPairs.has(pairKey(pair)))
    , boundaries: Object.entries(after.sections || {}).filter(([tag,area]) =>
      JSON.stringify(before?.sections?.[tag]) !== JSON.stringify(area)).map(([tag,area]) => ({tag,...area}))
  };
}

async function currentDraft(db) {
  return db.prepare('SELECT revision, draft, updated_at, updated_by FROM placement_drafts WHERE id = ?')
    .bind('state-798').first();
}

async function saveDraft(db, baseRevision, draft, editor, action = 'edit', sourceRevision = null, plans = []) {
  const current = await currentDraft(db);
  if ((current?.revision || 0) !== baseRevision) return { conflict: current };
  if (current && action === 'edit') {
    const beforeDraft = JSON.parse(current.draft);
    const snapshot = await archivedPlan(db, draft.signature);
    if (beforeDraft.signature !== draft.signature || (snapshot ? !draftFitsPlan(draft, snapshot) : !samePlan(beforeDraft, draft)))
      return { invalid: true };
  }
  const now = new Date().toISOString();
  const serialized = JSON.stringify(draft);
  const before = current && JSON.parse(current.draft);
  const delta = changesBetween(before, draft);
  if (delta.added.length || delta.removed.length) {
    const oldPlan = plans.find(p => planSignature(p) === before?.signature) ||
      (before && await archivedPlan(db, before.signature));
    const nextPlan = plans.find(p => planSignature(p) === draft.signature) || await archivedPlan(db, draft.signature);
    const oldNames = new Map((oldPlan?.placements || []).map(p => [p.id, p.name]));
    const newNames = new Map((nextPlan?.placements || []).map(p => [p.id, p.name]));
    delta.added.forEach(p => { if (newNames.has(p.id)) p.name = newNames.get(p.id); });
    delta.removed.forEach(p => { if (oldNames.has(p.id)) p.name = oldNames.get(p.id); });
  }
  const changes = JSON.stringify(delta);
  const write = baseRevision === 0
    ? db.prepare(`INSERT OR IGNORE INTO placement_drafts
        (id, revision, draft, updated_at, updated_by) VALUES ('state-798', 1, ?, ?, ?)`)
        .bind(serialized, now, editor)
    : db.prepare(`UPDATE placement_drafts SET revision = revision + 1,
        draft = ?, updated_at = ?, updated_by = ? WHERE id = 'state-798' AND revision = ?`)
        .bind(serialized, now, editor, baseRevision);
  const history = db.prepare(`INSERT INTO placement_history
      (revision, draft, updated_at, updated_by, action, source_revision, changes)
      SELECT revision, draft, updated_at, updated_by, ?, ?, ? FROM placement_drafts
      WHERE id = 'state-798' AND revision = ? AND changes() > 0`)
    .bind(action, sourceRevision, changes, baseRevision + 1);
  // Plan snapshots are immutable. The revision check gates registering them,
  // and the D1 batch commits metadata and the new draft/history atomically.
  const snapshots = plans.map(plan => db.prepare(`INSERT OR IGNORE INTO placement_plans
    (signature, plan, created_at) SELECT ?, ?, ? WHERE EXISTS
    (SELECT 1 FROM placement_drafts WHERE id = 'state-798' AND revision = ? AND draft = ? AND updated_at = ?)`)
    .bind(planSignature(plan), JSON.stringify(plan), now, baseRevision + 1, serialized, now));
  const result = await db.batch([write, history, ...snapshots]);
  if (!result[0].meta.changes) return { conflict: await currentDraft(db) };
  return { revision: baseRevision + 1, updatedAt: now, updatedBy: editor,
    action, sourceRevision, changes: JSON.parse(changes) };
}

function conflictResponse(row, origin) {
  return response({ error: 'Revision conflict', revision: row?.revision || 0,
    updatedAt: row?.updated_at || null, updatedBy: row?.updated_by || null }, 409, origin);
}

// Helicopter relay: a find belongs to the alliance that saw it, and the whole
// alliance hears about it once. Members all report the same find, so the
// claiming insert is the lock: the first report wins and the rest are told the
// alert already went out.
const HELICOPTER_COLOR = 0xf2a93b;
const HELICOPTER_FRESH_MS = 10 * 60 * 1000;
const HELICOPTER_RATE_LIMIT = 40;
// A companion also reports the treasure cards it saw but decided not to send (a
// baseline sweep or a stale page), so a helicopter nobody alerted for can be found
// afterwards. Those are observations, not claims: they never occupy a dedupe key.
const HELICOPTER_SIGHTING_LIMIT = 400;
const HELICOPTER_SIGHTING_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const HELICOPTER_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// Discord webhooks only, plus loopback so the local relay test can stand in
// for Discord without a real channel.
const HELICOPTER_WEBHOOK = /^(?:https:\/\/(?:discord(?:app)?\.com|ptb\.discord\.com|canary\.discord\.com)\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+|http:\/\/127\.0\.0\.1:\d{2,5}\/[\w./-]*)$/;

function plainText(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function hexId(value, width) {
  const found = typeof value === 'string' ? value.trim().match(/^[0-9a-fA-F]+$/) : null;
  return found && found[0].length === width ? found[0].toLowerCase() : '';
}

function gridNumber(value) {
  const found = Number(value);
  return Number.isInteger(found) && found >= 0 && found <= 999 ? found : null;
}

// The channel reads as one card per find: who found it, where, and which
// alliance should be moving.
function helicopterEmbed(alert) {
  const place = alert.x !== null && alert.y !== null
    ? `**X:${alert.x} Y:${alert.y}**` : 'somewhere in the state';
  return {
    title: '🚁 Helicopter — Explore Treasure',
    description: `${alert.finder ? `Found by **${alert.finder}**` : 'Found by an alliance member'} · ${place}\n` +
      `Reported by ${alert.tag} on State ${alert.state}.`,
    color: HELICOPTER_COLOR,
    timestamp: new Date().toISOString(),
    footer: { text: `${alert.tag} · State ${alert.state}` },
  };
}

async function sendHelicopterAlert(env, alert, config) {
  const webhook = String(env.HELICOPTER_WEBHOOK || '').trim();
  if (!HELICOPTER_WEBHOOK.test(webhook)) return false;
  const payload = { embeds: [helicopterEmbed(alert)], allowed_mentions: { parse: [], roles: [] } };
  const role = String(config.role_id || '').trim();
  if (/^\d{5,25}$/.test(role)) {
    payload.content = `<@&${role}>`;
    payload.allowed_mentions.roles = [role];
  }
  const posted = await fetch(`${webhook}?wait=true`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'LastZ-Companion-Relay/1.0' },
    body: JSON.stringify(payload) });
  if (!posted.ok) return false;
  const answer = await posted.json().catch(() => null);
  return Boolean(answer && answer.id);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return response({}, 204, origin);
    if (url.pathname === '/health') return response({ ok: true }, 200, origin);
    if (url.pathname === '/api/editor-check' && request.method === 'POST')
      return response(env.EDITOR_KEY && request.headers.get('Authorization') === `Bearer ${env.EDITOR_KEY}`
        ? { ok: true } : { error: 'Invalid editor key' },
      env.EDITOR_KEY && request.headers.get('Authorization') === `Bearer ${env.EDITOR_KEY}` ? 200 : 401, origin);
    if (url.pathname.startsWith('/api/helicopter')) {
      if (!env.DB) return response({ error: 'Database is not configured' }, 503, origin);
      if (url.pathname === '/api/helicopter/alliances' && request.method === 'GET') {
        const rows = await env.DB.prepare(`SELECT a.tag, a.alliance_id, a.role_id, a.enabled,
          (SELECT COUNT(*) FROM helicopter_alerts h WHERE h.tag = a.tag AND h.result = 'posted') AS alerts,
          (SELECT MAX(h.posted_at) FROM helicopter_alerts h WHERE h.tag = a.tag AND h.result = 'posted') AS last_alert
          FROM helicopter_alliances a ORDER BY a.tag`).all();
        return response({ alliances: rows.results.map(row => ({ tag: row.tag,
          allianceId: row.alliance_id, role: Boolean(row.role_id), enabled: Boolean(row.enabled),
          alerts: row.alerts, lastAlert: row.last_alert || null })) }, 200, origin);
      }
      if (url.pathname === '/api/helicopter/alliances' && request.method === 'PUT') {
        if (!env.EDITOR_KEY || request.headers.get('Authorization') !== `Bearer ${env.EDITOR_KEY}`)
          return response({ error: 'Editor key required' }, 401, origin);
        const rawAlliance = await request.text();
        if (rawAlliance.length > 4000) return response({ error: 'Request is too large' }, 413, origin);
        let alliance;
        try { alliance = JSON.parse(rawAlliance); } catch { return response({ error: 'Invalid JSON' }, 400, origin); }
        const tag = plainText(alliance.tag, 20);
        const roleId = String(alliance.roleId || '').trim();
        const allianceId = alliance.allianceId ? hexId(alliance.allianceId, 32) : '';
        if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/.test(tag))
          return response({ error: 'Invalid alliance tag' }, 400, origin);
        if (roleId && !/^\d{5,25}$/.test(roleId))
          return response({ error: 'Invalid alliance role id' }, 400, origin);
        if (alliance.allianceId && !allianceId)
          return response({ error: 'Invalid alliance id' }, 400, origin);
        const known = await env.DB.prepare('SELECT tag, alliance_id, role_id, enabled FROM helicopter_alliances WHERE lower(tag) = lower(?)')
          .bind(tag).first();
        // Only what the caller sends changes: disabling an alliance keeps its
        // role and alliance id so re-enabling does not silently lose the ping.
        // Only what the caller sends changes; an explicit null clears a learned value
        // (an alliance that disbanded, and its tag reused by a new one). An empty
        // string is 'not specified', which is what keeps a disable from wiping the role.
        const given = name => Object.prototype.hasOwnProperty.call(alliance, name) &&
          String(alliance[name] ?? '').trim() !== '';
        const cleared = name => Object.prototype.hasOwnProperty.call(alliance, name) &&
          alliance[name] === null;
        const stored = {
          tag: known?.tag || tag,
          alliance_id: given('allianceId') ? allianceId
            : (cleared('allianceId') ? '' : (known?.alliance_id || '')),
          role_id: given('roleId') ? roleId
            : (cleared('roleId') ? '' : (known?.role_id || '')),
          enabled: given('enabled') ? (alliance.enabled ? 1 : 0) : (known?.enabled || 0),
        };
        await env.DB.prepare(`INSERT INTO helicopter_alliances (tag, alliance_id, role_id, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(tag) DO UPDATE SET
          alliance_id = excluded.alliance_id, role_id = excluded.role_id,
          enabled = excluded.enabled, updated_at = excluded.updated_at`)
          .bind(stored.tag, stored.alliance_id, stored.role_id, stored.enabled, Date.now()).run();
        return response({ tag: stored.tag, allianceId: stored.alliance_id,
          roleId: stored.role_id, enabled: Boolean(stored.enabled) }, 200, origin);
      }
      if (url.pathname === '/api/helicopter/queue' && request.method === 'GET') {
        if (!env.HELICOPTER_BOT_KEY || request.headers.get('Authorization') !== `Bearer ${env.HELICOPTER_BOT_KEY}`)
          return response({ error: 'Bot key required' }, 401, origin);
        const rows = await env.DB.prepare(`SELECT event_key, tag, state, x, y, finder, post, posted_at
            FROM helicopter_alerts WHERE result = 'claimed' ORDER BY posted_at LIMIT 25`).all();
        return response({ alerts: rows.results.map(row => ({ key: row.event_key, tag: row.tag,
          state: row.state, x: row.x, y: row.y, finder: row.finder, post: row.post,
          claimedAt: row.posted_at })) }, 200, origin);
      }
      if (url.pathname === '/api/helicopter/delivered' && request.method === 'POST') {
        if (!env.HELICOPTER_BOT_KEY || request.headers.get('Authorization') !== `Bearer ${env.HELICOPTER_BOT_KEY}`)
          return response({ error: 'Bot key required' }, 401, origin);
        const rawDelivered = await request.text();
        if (rawDelivered.length > 20000) return response({ error: 'Request is too large' }, 413, origin);
        let delivered;
        try { delivered = JSON.parse(rawDelivered); } catch { return response({ error: 'Invalid JSON' }, 400, origin); }
        const updates = (Array.isArray(delivered?.results) ? delivered.results : []).slice(0, 25)
          .map(item => ({ key: String(item?.key || ''), result: String(item?.result || '').slice(0, 24),
            message: String(item?.messageId || '').slice(0, 32) }))
          .filter(item => item.key && item.result);
        if (!updates.length) return response({ error: 'No results to record' }, 400, origin);
        await env.DB.batch(updates.map(item => env.DB.prepare(
          `UPDATE helicopter_alerts SET result = ?, delivery = 'bot', message_id = ?
           WHERE event_key = ? AND result = 'claimed'`)
          .bind(item.result, item.message, item.key)));
        const left = await env.DB.prepare(`SELECT COUNT(*) AS waiting FROM helicopter_alerts
            WHERE result = 'claimed'`).first();
        return response({ recorded: updates.length, waiting: left?.waiting || 0 }, 200, origin);
      }
      if (url.pathname === '/api/helicopter/observed' && request.method === 'POST') {
        const rawSight = await request.text();
        if (rawSight.length > 3000) return response({ error: 'Request is too large' }, 413, origin);
        let sight;
        try { sight = JSON.parse(rawSight); } catch { return response({ error: 'Invalid JSON' }, 400, origin); }
        const sightAlliance = hexId(sight.allianceId, 32);
        const sightKey = /^[0-9a-zA-Z:_-]{3,140}$/.test(String(sight.key || '')) ? String(sight.key) : '';
        const sightState = Number(sight.state);
        if (!sightAlliance || !sightKey || !sightKey.startsWith(`${sightAlliance}:`))
          return response({ error: 'Sighting key does not belong to this alliance' }, 400, origin);
        if (!Number.isInteger(sightState) || sightState < 1 || sightState > 9999)
          return response({ error: 'Invalid state' }, 400, origin);
        const now = Date.now();
        const recentSights = await env.DB.prepare(`SELECT COUNT(*) AS seen FROM helicopter_sightings
            WHERE alliance_id = ? AND last_seen > ?`)
          .bind(sightAlliance, now - 60 * 60 * 1000).first();
        if ((recentSights?.seen || 0) >= HELICOPTER_SIGHTING_LIMIT)
          return response({ ok: false, reason: 'rate-limited' }, 200, origin);
        await env.DB.prepare(`INSERT INTO helicopter_sightings
            (event_key, tag, alliance_id, state, x, y, post, reason, members, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(event_key) DO UPDATE SET members = members + 1,
              last_seen = excluded.last_seen`)
          .bind(sightKey, plainText(sight.tag, 20), sightAlliance, sightState,
                gridNumber(sight.x), gridNumber(sight.y), Number(sight.post) === 60 ? 60 : 63,
                plainText(sight.reason, 24), now, now).run();
        const recorded = await env.DB.prepare(`SELECT members, reason FROM helicopter_sightings
            WHERE event_key = ?`).bind(sightKey).first();
        // 'missed' means nobody was alerted for this card: either no report ever
        // arrived, or the report was refused. Only a posted or queued claim counts.
        const claim = await env.DB.prepare(`SELECT result FROM helicopter_alerts WHERE event_key = ?`)
          .bind(sightKey).first();
        const delivered = claim && (claim.result === 'posted' || claim.result === 'claimed');
        if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM helicopter_sightings WHERE last_seen < ?')
          .bind(now - HELICOPTER_SIGHTING_KEEP_MS).run();
        return response({ ok: true, members: recorded?.members || 1, missed: !delivered }, 200, origin);
      }
      if (url.pathname === '/api/helicopter/audit' && request.method === 'GET') {
        // The organiser's view: what allies' companions saw, what was alerted for, and
        // - the point of the whole thing - which treasure cards nobody ever alerted.
        if (!env.EDITOR_KEY || request.headers.get('Authorization') !== `Bearer ${env.EDITOR_KEY}`)
          return response({ error: 'Unauthorized' }, 401, origin);
        const now = Date.now();
        const dayAgo = now - 24 * 60 * 60 * 1000;
        const results = await env.DB.prepare(`SELECT result, COUNT(*) AS count FROM helicopter_alerts
            WHERE posted_at > ? GROUP BY result ORDER BY count DESC`).bind(dayAgo).all();
        const missed = await env.DB.prepare(`SELECT s.event_key, s.tag, s.state, s.x, s.y, s.post,
            s.reason, s.members, s.first_seen, s.last_seen FROM helicopter_sightings s
            WHERE NOT EXISTS (SELECT 1 FROM helicopter_alerts h WHERE h.event_key = s.event_key
                              AND h.result IN ('posted', 'claimed'))
            ORDER BY s.first_seen DESC LIMIT 50`).all();
        const perAlliance = await env.DB.prepare(`SELECT t.tag,
            (SELECT COUNT(*) FROM helicopter_alerts h WHERE h.tag = t.tag AND h.result = 'posted') AS alerts,
            (SELECT MAX(h.posted_at) FROM helicopter_alerts h WHERE h.tag = t.tag AND h.result = 'posted') AS last_alert,
            (SELECT COUNT(*) FROM helicopter_sightings s WHERE s.tag = t.tag) AS sightings,
            (SELECT COUNT(*) FROM helicopter_sightings s WHERE s.tag = t.tag
              AND NOT EXISTS (SELECT 1 FROM helicopter_alerts h WHERE h.event_key = s.event_key
                              AND h.result IN ('posted', 'claimed'))) AS misses
            FROM (SELECT DISTINCT tag FROM helicopter_sightings
                  UNION SELECT DISTINCT tag FROM helicopter_alerts) t ORDER BY t.tag`).all();
        const queue = await env.DB.prepare(`SELECT COUNT(*) AS waiting, MIN(posted_at) AS oldest
            FROM helicopter_alerts WHERE result = 'claimed'`).first();
        return response({
          now, dayAgo,
          queue: { waiting: queue?.waiting || 0, oldest: queue?.oldest || 0 },
          refusals: (results.results || []).map(row => ({ result: row.result, count: row.count })),
          missed: (missed.results || []).map(row => ({ key: row.event_key, tag: row.tag, state: row.state,
            x: row.x, y: row.y, post: row.post, reason: row.reason, members: row.members,
            firstSeen: row.first_seen, lastSeen: row.last_seen })),
          alliances: perAlliance.results || [],
        }, 200, origin);
      }
      if (url.pathname === '/api/helicopter/health' && request.method === 'GET') {
        // Public and secret-free: the bot polls it to know whether to worry, and the
        // companion panel shows the same numbers to a member.
        const now = Date.now();
        const hourAgo = now - 60 * 60 * 1000;
        const dayAgo = now - 24 * 60 * 60 * 1000;
        const queue = await env.DB.prepare(`SELECT COUNT(*) AS waiting, MIN(posted_at) AS oldest
            FROM helicopter_alerts WHERE result = 'claimed'`).first();
        const hour = await env.DB.prepare(`SELECT
            SUM(CASE WHEN result = 'posted' THEN 1 ELSE 0 END) AS alerts,
            SUM(CASE WHEN result NOT IN ('posted', 'claimed') THEN 1 ELSE 0 END) AS refusals
            FROM helicopter_alerts WHERE posted_at > ?`).bind(hourAgo).first();
        const day = await env.DB.prepare(`SELECT
            SUM(CASE WHEN result = 'posted' THEN 1 ELSE 0 END) AS alerts,
            COUNT(*) AS claims FROM helicopter_alerts WHERE posted_at > ?`).bind(dayAgo).first();
        const reasons = await env.DB.prepare(`SELECT result, COUNT(*) AS count FROM helicopter_alerts
            WHERE posted_at > ? AND result NOT IN ('posted', 'claimed', 'duplicate')
            GROUP BY result ORDER BY count DESC LIMIT 5`).bind(hourAgo).all();
        const sightings = await env.DB.prepare(`SELECT COUNT(*) AS seen,
            SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM helicopter_alerts h WHERE h.event_key = s.event_key
                                      AND h.result IN ('posted', 'claimed'))
                     THEN 1 ELSE 0 END) AS missed
            FROM helicopter_sightings s WHERE s.last_seen > ?`).bind(dayAgo).first();
        const last = await env.DB.prepare(`SELECT MAX(posted_at) AS at FROM helicopter_alerts
            WHERE result = 'posted'`).first();
        const alliances = await env.DB.prepare(`SELECT COUNT(*) AS total,
            SUM(enabled) AS reporting FROM helicopter_alliances`).first();
        return response({ ok: true, now,
          queue: { waiting: queue?.waiting || 0, oldest: queue?.oldest || 0,
                   oldestSeconds: queue?.oldest ? Math.round((now - queue.oldest) / 1000) : 0 },
          hour: { alerts: hour?.alerts || 0, refusals: hour?.refusals || 0,
                  refusalReasons: Object.fromEntries((reasons.results || []).map(row => [row.result, row.count])) },
          day: { alerts: day?.alerts || 0, claims: day?.claims || 0,
                 seen: sightings?.seen || 0, missed: sightings?.missed || 0 },
          lastAlertAt: last?.at || 0,
          alliances: { total: alliances?.total || 0, reporting: alliances?.reporting || 0 } }, 200, origin);
      }
      if (url.pathname === '/api/helicopter' && request.method === 'POST') {
        const rawAlert = await request.text();
        if (rawAlert.length > 4000) return response({ error: 'Request is too large' }, 413, origin);
        let body;
        try { body = JSON.parse(rawAlert); } catch { return response({ error: 'Invalid JSON' }, 400, origin); }
        const allianceId = hexId(body.allianceId, 32);
        const key = /^[0-9a-zA-Z:_-]{3,140}$/.test(String(body.key || '')) ? String(body.key) : '';
        const tag = plainText(body.tag, 20);
        const state = Number(body.state);
        const finder = plainText(body.finder, 32);
        const post = Number(body.post) === 60 ? 60 : 63;
        const observed = Number(body.observedAt);
        if (!allianceId || !key) return response({ error: 'Invalid alliance or alert key' }, 400, origin);
        // The key carries the alliance it belongs to, so one alliance cannot
        // claim another's find or block it by guessing keys.
        if (!key.startsWith(`${allianceId}:`))
          return response({ error: 'Alert key does not belong to this alliance' }, 400, origin);
        if (!Number.isInteger(state) || state < 1 || state > 9999)
          return response({ error: 'Invalid state' }, 400, origin);
        if (!Number.isFinite(observed)) return response({ error: 'Invalid find time' }, 400, origin);
        const x = gridNumber(body.x), y = gridNumber(body.y);
        const now = Date.now();
        const stale = Math.abs(now - observed) > HELICOPTER_FRESH_MS;
        const claim = await env.DB.prepare(`INSERT OR IGNORE INTO helicopter_alerts
            (event_key, tag, alliance_id, state, x, y, finder, post, posted_at, result)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(key, tag, allianceId, state, x, y, finder, post, now, stale ? 'stale' : 'claimed').run();
        if (!claim.meta.changes) return response({ alerted: false, reason: 'duplicate' }, 200, origin);
        if (stale) return response({ alerted: false, reason: 'stale' }, 200, origin);
        // Any alliance works by itself: the first report of a tag registers it, and the
        // alliance id is learned from the game rather than typed by anyone. This table
        // is a record of who is reporting (and the organiser's kill switch), not a list
        // that has to be filled in before an alliance is heard.
        const config = await env.DB.prepare('SELECT tag, alliance_id, role_id, enabled FROM helicopter_alliances WHERE lower(tag) = lower(?)')
          .bind(tag).first();
        let reason = '';
        if (config && !config.enabled) {
          reason = 'alliance-disabled';
        } else if (config && config.alliance_id && config.alliance_id !== allianceId) {
          // A tag belongs to the alliance that first reported it, so a different
          // alliance's companion cannot ping that alliance's role.
          reason = 'alliance-mismatch';
        } else {
          if (!config) {
            await env.DB.prepare(`INSERT OR IGNORE INTO helicopter_alliances
                (tag, alliance_id, role_id, enabled, updated_at) VALUES (?, ?, '', 1, ?)`)
              .bind(tag, allianceId, now).run();
          } else if (!config.alliance_id) {
            await env.DB.prepare('UPDATE helicopter_alliances SET alliance_id = ?, updated_at = ? WHERE tag = ?')
              .bind(allianceId, now, config.tag).run();
          }
          // Claims, not broadcasts: a queued alert for the bot already counts, so one
          // alliance cannot flood the channel through either delivery path.
          const recent = await env.DB.prepare(`SELECT COUNT(*) AS sent FROM helicopter_alerts
              WHERE alliance_id = ? AND result <> 'stale' AND posted_at > ?`)
            .bind(allianceId, now - 60 * 60 * 1000).first();
          if ((recent?.sent || 0) >= HELICOPTER_RATE_LIMIT) reason = 'rate-limited';
        }
        let alerted = false, delivery = '';
        if (!reason) {
          if (String(env.HELICOPTER_WEBHOOK || '').trim()) {
            // A webhook is configured, so the relay posts itself. This is the path
            // that keeps working while nobody's machine is awake.
            try { alerted = await sendHelicopterAlert(env, { tag, state, x, y, finder, post },
                                                     config || { role_id: '' }); }
            catch { alerted = false; }
            if (!alerted) reason = 'webhook-not-configured';
            else delivery = 'posted';
            if (alerted) await env.DB.prepare('UPDATE helicopter_alerts SET result = ?, delivery = ? WHERE event_key = ?')
              .bind('posted', 'webhook', key).run();
          } else if (!env.HELICOPTER_BOT_KEY) {
            reason = 'no-delivery-configured';
          } else {
            // Our state Discord bot collects the claim from /api/helicopter/queue and
            // posts it with its own token, exactly as it posts a /heli alert.
            alerted = true;
            delivery = 'queued';
          }
        }
        if (reason) await env.DB.prepare('UPDATE helicopter_alerts SET result = ? WHERE event_key = ?')
          .bind('webhook-not-configured' === reason ? 'undelivered' : reason, key).run();
        if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM helicopter_alerts WHERE posted_at < ?')
          .bind(now - HELICOPTER_KEEP_MS).run();
        return alerted ? response({ alerted: true, tag, delivery }, 200, origin)
          : response({ alerted: false, reason }, 200, origin);
      }
      return response({ error: 'Not found' }, 404, origin);
    }
    if (!url.pathname.startsWith('/api/placement') && !url.pathname.startsWith('/api/atlas')) return response({ error: 'Not found' }, 404, origin);
    const bearerKey = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const suppliedKey = request.headers.get('X-Read-Key') || url.searchParams.get('key') || bearerKey || '';
    const readAllowed = Boolean(env.READ_KEY && suppliedKey === env.READ_KEY) ||
      Boolean(env.EDITOR_KEY && suppliedKey === env.EDITOR_KEY);
    if (url.pathname.startsWith('/api/atlas')) {
      if (request.method !== 'GET') return response({ error: 'Method not allowed' }, 405, origin);
      if (!readAllowed) return response({ error: 'Access key required' }, 401, origin);
      if (!env.ATLAS_ORIGIN || !env.ATLAS_KEY) return response({ error: 'Atlas source is not configured' }, 503, origin);
      const suffix = url.pathname.slice('/api/atlas'.length) || '/';
      const upstream = await fetch(env.ATLAS_ORIGIN.replace(/\/$/, '') + suffix + (url.search || ''),
        { headers: { 'X-Atlas-Key': env.ATLAS_KEY } });
      return new Response(upstream.body, { status: upstream.status, headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
        'Cache-Control': upstream.headers.get('Cache-Control') || 'no-store',
        'Vary': 'Origin',
        ...(origin === ORIGIN || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) } });
    }
    if (!env.DB) return response({ error: 'Database is not configured' }, 503, origin);
    if (request.method === 'GET' && !readAllowed) return response({ error: 'Access key required' }, 401, origin);
    if (url.pathname === '/api/placement/history' && request.method === 'GET') {
      const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(before) || before < 1) return response({ error: 'Invalid cursor' }, 400, origin);
      const rows = await env.DB.prepare(`SELECT revision, updated_at, updated_by, action,
        source_revision, changes FROM placement_history WHERE revision < ?
        ORDER BY revision DESC LIMIT 51`).bind(before).all();
      const entries = rows.results.slice(0, 50).map(row => ({ revision: row.revision,
        updatedAt: row.updated_at, updatedBy: row.updated_by, action: row.action,
        sourceRevision: row.source_revision, changes: JSON.parse(row.changes) }));
      return response({ entries, hasMore: rows.results.length > 50 }, 200, origin);
    }
    if (url.pathname === '/api/placement/plan' && request.method === 'GET') {
      const plan = await archivedPlan(env.DB, url.searchParams.get('signature') || '');
      return plan ? response({ plan }, 200, origin) : response({ error: 'Plan snapshot not found' }, 404, origin);
    }
    const historyMatch = /^\/api\/placement\/history\/(\d+)$/.exec(url.pathname);
    if (historyMatch && request.method === 'GET') {
      const row = await env.DB.prepare(`SELECT revision, draft, updated_at, updated_by,
        action, source_revision, changes FROM placement_history WHERE revision = ?`)
        .bind(Number(historyMatch[1])).first();
      return row ? response({ revision: row.revision, draft: JSON.parse(row.draft),
        plan: await archivedPlan(env.DB, JSON.parse(row.draft).signature),
        updatedAt: row.updated_at, updatedBy: row.updated_by, action: row.action,
        sourceRevision: row.source_revision, changes: JSON.parse(row.changes) }, 200, origin)
        : response({ error: 'Revision not found' }, 404, origin);
    }
    if (url.pathname === '/api/placement' && request.method === 'GET') {
      const row = await currentDraft(env.DB);
      return response(row ? { revision: row.revision, draft: JSON.parse(row.draft),
        updatedAt: row.updated_at, updatedBy: row.updated_by }
        : { revision: 0, draft: null, updatedAt: null, updatedBy: null }, 200, origin);
    }
    if (!['/api/placement', '/api/placement/restore', '/api/placement/migrate'].includes(url.pathname))
      return response({ error: 'Not found' }, 404, origin);
    if ((url.pathname === '/api/placement' && request.method !== 'PUT') ||
        (url.pathname !== '/api/placement' && request.method !== 'POST'))
      return response({ error: 'Method not allowed' }, 405, origin);
    const bearer = request.headers.get('Authorization') || '';
    if (!env.EDITOR_KEY || bearer !== `Bearer ${env.EDITOR_KEY}`)
      return response({ error: 'Editor key required' }, 401, origin);
    const raw = await request.text();
    if (raw.length > (url.pathname === '/api/placement/migrate' ? 4000000 : 250000)) return response({ error: 'Request is too large' }, 413, origin);
    let body;
    try { body = JSON.parse(raw); } catch { return response({ error: 'Invalid JSON' }, 400, origin); }
    if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0)
      return response({ error: 'Invalid base revision' }, 400, origin);
    const editor = String(body.editor || 'Planner').trim().slice(0, 60);
    let draft = body.draft, action = 'edit', sourceRevision = null, plans = [];
    if (url.pathname === '/api/placement/migrate') {
      const current = await currentDraft(env.DB);
      if ((current?.revision || 0) !== body.baseRevision) return conflictResponse(current, origin);
      if (!draftFitsPlan(draft, body.plan) || !validPlan(body.previousPlan) ||
          (current && !draftFitsPlan(JSON.parse(current.draft), body.previousPlan)))
        return response({ error: 'Migration plans or assignments do not match' }, 400, origin);
      for (const plan of [body.previousPlan, body.plan]) {
        const prior = await archivedPlan(env.DB, planSignature(plan));
        if (prior && JSON.stringify(prior) !== JSON.stringify(plan))
          return response({ error: 'Plan snapshot is immutable; use a new plan ID' }, 400, origin);
      }
      plans = [body.previousPlan, body.plan]; action = 'atlas_refresh';
    }
    if (url.pathname === '/api/placement/restore') {
      if (!Number.isSafeInteger(body.sourceRevision) || body.sourceRevision < 1)
        return response({ error: 'Invalid source revision' }, 400, origin);
      const source = await env.DB.prepare('SELECT draft FROM placement_history WHERE revision = ?')
        .bind(body.sourceRevision).first();
      if (!source) return response({ error: 'Revision not found' }, 404, origin);
      draft = JSON.parse(source.draft); action = 'restore'; sourceRevision = body.sourceRevision;
      const current = await currentDraft(env.DB);
      const plan = await archivedPlan(env.DB, draft.signature);
      if (current && !samePlan(JSON.parse(current.draft), draft) && !draftFitsPlan(draft, plan))
        return response({ error: 'Archived plan snapshot is missing' }, 400, origin);
    }
    if (!validDraft(draft)) return response({ error: 'Invalid draft' }, 400, origin);
    const registered = await archivedPlan(env.DB, draft.signature);
    if (registered && !draftFitsPlan(draft, registered)) return response({ error: 'Draft does not fit plan snapshot' }, 400, origin);
    const result = await saveDraft(env.DB, body.baseRevision, draft, editor, action, sourceRevision, plans);
    return result.conflict ? conflictResponse(result.conflict, origin) :
      result.invalid ? response({ error: 'Draft belongs to a different plan' }, 400, origin) :
      response(result, 200, origin);
  }
};

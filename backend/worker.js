const ORIGIN = 'https://samuelmm97.github.io';

function response(body, status = 200, origin = '') {
  const headers = { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin === ORIGIN || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, PUT, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
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
        typeof pair[1] !== 'string' || !/^\d{1,3},\d{1,3}$/.test(pair[1])) return false;
    ids.add(pair[0]); sites.add(pair[1]);
  }
  if (draft.pairs.some(p => !p || typeof p !== 'object')) return false;
  const locks = new Set(draft.locks);
  const members = draft.pairs.flatMap(p => [p.strike, p.reserve]);
  return ids.size === 2000 && sites.size === 2000 && locks.size === draft.locks.length &&
    draft.locks.every(id => Number.isSafeInteger(id) && ids.has(id)) &&
    members.length === new Set(members).size &&
    draft.pairs.every(p => Number.isSafeInteger(p.strike) && Number.isSafeInteger(p.reserve) &&
      ids.has(p.strike) && ids.has(p.reserve) && locks.has(p.strike) && locks.has(p.reserve));
}

function samePlan(before, after) {
  if (before.signature !== after.signature) return false;
  const ids = new Set(before.assignments.map(([id]) => id));
  const sites = new Set(before.assignments.map(([, site]) => site));
  return after.assignments.every(([id, site]) => ids.has(id) && sites.has(site));
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
  return plan.placements.every(p => p && Number.isSafeInteger(p.id) && p.id >= 0 &&
    Number.isInteger(p.x) && p.x >= 0 && p.x <= 999 &&
    Number.isInteger(p.y) && p.y >= 0 && p.y <= 999 &&
    ['mud', 'grass'].includes(p.zone) && typeof p.name === 'string' &&
    Number.isFinite(p.ring) && Number.isFinite(p.angle) && (() => {
      const j = p.y - 500, i = p.x - 500 - Math.floor(j / 2);
      const ring = Math.max(Math.abs(i), Math.abs(j), Math.abs(i + j));
      return ring === p.ring && (p.zone === 'mud' ? ring >= 20 && ring <= 33 : ring >= 37 && ring <= 119);
    })()) &&
    new Set(plan.placements.map(p => p.id)).size === 2000 &&
    new Set(plan.placements.map(p => `${p.x},${p.y}`)).size === 2000;
}

function draftFitsPlan(draft, plan) {
  if (!validDraft(draft) || !validPlan(plan) || draft.signature !== planSignature(plan)) return false;
  const ids = new Set(plan.placements.map(p => p.id));
  const sites = new Map(plan.placements.map(p => [`${p.x},${p.y}`, p.zone]));
  const assignments = new Map(draft.assignments);
  return draft.assignments.every(([id, site]) => ids.has(id) && sites.has(site)) &&
    draft.pairs.every(p => sites.get(assignments.get(p.strike)) === 'grass' &&
      sites.get(assignments.get(p.reserve)) === 'mud');
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
  };
}

async function currentDraft(db) {
  return db.prepare('SELECT revision, draft, updated_at, updated_by FROM placement_drafts WHERE id = ?')
    .bind('state-798').first();
}

async function saveDraft(db, baseRevision, draft, editor, action = 'edit', sourceRevision = null, plans = []) {
  const current = await currentDraft(db);
  if ((current?.revision || 0) !== baseRevision) return { conflict: current };
  if (current && !samePlan(JSON.parse(current.draft), draft) && action === 'edit') return { invalid: true };
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
    if (!url.pathname.startsWith('/api/placement')) return response({ error: 'Not found' }, 404, origin);
    if (!env.DB) return response({ error: 'Database is not configured' }, 503, origin);
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

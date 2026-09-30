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
  return ids.size === 2000 && sites.size === 2000 &&
    draft.locks.every(id => Number.isSafeInteger(id) && ids.has(id)) &&
    draft.pairs.every(p => Number.isSafeInteger(p.strike) && Number.isSafeInteger(p.reserve) &&
      ids.has(p.strike) && ids.has(p.reserve));
}

function changesBetween(before, after) {
  const oldSites = new Map(before?.assignments || []);
  const oldLocks = new Set(before?.locks || []);
  const nextLocks = new Set(after.locks);
  const pairKey = pair => `${pair.strike}:${pair.reserve}`;
  const oldPairs = new Set((before?.pairs || []).map(pairKey));
  const nextPairs = new Set(after.pairs.map(pairKey));
  return {
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

async function saveDraft(db, baseRevision, draft, editor, action = 'edit', sourceRevision = null) {
  const current = await currentDraft(db);
  if ((current?.revision || 0) !== baseRevision) return { conflict: current };
  const now = new Date().toISOString();
  const serialized = JSON.stringify(draft);
  const changes = JSON.stringify(changesBetween(current && JSON.parse(current.draft), draft));
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
  const result = await db.batch([write, history]);
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
    const historyMatch = /^\/api\/placement\/history\/(\d+)$/.exec(url.pathname);
    if (historyMatch && request.method === 'GET') {
      const row = await env.DB.prepare(`SELECT revision, draft, updated_at, updated_by,
        action, source_revision, changes FROM placement_history WHERE revision = ?`)
        .bind(Number(historyMatch[1])).first();
      return row ? response({ revision: row.revision, draft: JSON.parse(row.draft),
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
    if (url.pathname !== '/api/placement' && url.pathname !== '/api/placement/restore')
      return response({ error: 'Not found' }, 404, origin);
    if ((url.pathname === '/api/placement' && request.method !== 'PUT') ||
        (url.pathname === '/api/placement/restore' && request.method !== 'POST'))
      return response({ error: 'Method not allowed' }, 405, origin);
    const bearer = request.headers.get('Authorization') || '';
    if (!env.EDITOR_KEY || bearer !== `Bearer ${env.EDITOR_KEY}`)
      return response({ error: 'Editor key required' }, 401, origin);
    const raw = await request.text();
    if (raw.length > 250000) return response({ error: 'Request is too large' }, 413, origin);
    let body;
    try { body = JSON.parse(raw); } catch { return response({ error: 'Invalid JSON' }, 400, origin); }
    if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0)
      return response({ error: 'Invalid base revision' }, 400, origin);
    const editor = String(body.editor || 'Planner').trim().slice(0, 60);
    let draft = body.draft, action = 'edit', sourceRevision = null;
    if (url.pathname === '/api/placement/restore') {
      if (!Number.isSafeInteger(body.sourceRevision) || body.sourceRevision < 1)
        return response({ error: 'Invalid source revision' }, 400, origin);
      const source = await env.DB.prepare('SELECT draft FROM placement_history WHERE revision = ?')
        .bind(body.sourceRevision).first();
      if (!source) return response({ error: 'Revision not found' }, 404, origin);
      draft = JSON.parse(source.draft); action = 'restore'; sourceRevision = body.sourceRevision;
    }
    if (!validDraft(draft)) return response({ error: 'Invalid draft' }, 400, origin);
    const result = await saveDraft(env.DB, body.baseRevision, draft, editor, action, sourceRevision);
    return result.conflict ? conflictResponse(result.conflict, origin) : response(result, 200, origin);
  }
};

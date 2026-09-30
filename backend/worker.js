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
    if (url.pathname !== '/api/placement') return response({ error: 'Not found' }, 404, origin);
    if (!env.DB) return response({ error: 'Database is not configured' }, 503, origin);
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT revision, draft, updated_at, updated_by FROM placement_drafts WHERE id = ?')
        .bind('state-798').first();
      return response(row ? { revision: row.revision, draft: JSON.parse(row.draft),
        updatedAt: row.updated_at, updatedBy: row.updated_by }
        : { revision: 0, draft: null, updatedAt: null, updatedBy: null }, 200, origin);
    }
    if (request.method !== 'PUT') return response({ error: 'Method not allowed' }, 405, origin);
    const bearer = request.headers.get('Authorization') || '';
    if (!env.EDITOR_KEY || bearer !== `Bearer ${env.EDITOR_KEY}`)
      return response({ error: 'Editor key required' }, 401, origin);
    const raw = await request.text();
    if (raw.length > 250000) return response({ error: 'Draft is too large' }, 413, origin);
    let body;
    try { body = JSON.parse(raw); } catch { return response({ error: 'Invalid JSON' }, 400, origin); }
    if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0 || !validDraft(body.draft))
      return response({ error: 'Invalid draft' }, 400, origin);
    const now = new Date().toISOString();
    const editor = String(body.editor || 'Planner').trim().slice(0, 60);
    const result = body.baseRevision === 0
      ? await env.DB.prepare(`INSERT OR IGNORE INTO placement_drafts
          (id, revision, draft, updated_at, updated_by) VALUES ('state-798', 1, ?, ?, ?)`)
          .bind(JSON.stringify(body.draft), now, editor).run()
      : await env.DB.prepare(`UPDATE placement_drafts SET revision = revision + 1,
          draft = ?, updated_at = ?, updated_by = ? WHERE id = 'state-798' AND revision = ?`)
          .bind(JSON.stringify(body.draft), now, editor, body.baseRevision).run();
    if (!result.meta.changes) {
      const current = await env.DB.prepare('SELECT revision, updated_at, updated_by FROM placement_drafts WHERE id = ?')
        .bind('state-798').first();
      return response({ error: 'Revision conflict', revision: current?.revision || 0,
        updatedAt: current?.updated_at || null, updatedBy: current?.updated_by || null }, 409, origin);
    }
    return response({ revision: body.baseRevision + 1, updatedAt: now, updatedBy: editor }, 200, origin);
  }
};

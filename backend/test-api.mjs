import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../placement-planner.js');
const plan = JSON.parse(readFileSync(new URL('../placement-plan.json', import.meta.url), 'utf8'));
const base = process.env.TEST_API_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_EDITOR_KEY || 'local-test-key';
const first = await fetch(`${base}/api/placement`).then(r => r.json());
assert(Number.isInteger(first.revision));
const draft = first.draft || P.exportDraft(P.create(plan));
const payload = { baseRevision: first.revision, draft, editor: 'Local API test' };
const save = await fetch(`${base}/api/placement`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify(payload) });
assert.equal(save.status, 200, await save.clone().text());
const saved = await save.json();
assert.equal(saved.revision, first.revision + 1);
const conflict = await fetch(`${base}/api/placement`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify(payload) });
assert.equal(conflict.status, 409);
const denied = await fetch(`${base}/api/placement`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
  body: JSON.stringify({ ...payload, baseRevision: saved.revision }) });
assert.equal(denied.status, 401);
const latest = await fetch(`${base}/api/placement`).then(r => r.json());
assert.equal(latest.revision, saved.revision);
const restored = P.create(plan);
P.importDraft(restored, latest.draft);
console.log('D1 save, read, auth, and concurrent revision conflict passed');

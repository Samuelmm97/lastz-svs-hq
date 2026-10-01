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
const wrongPlan = structuredClone(draft);
wrongPlan.signature = 'different base plan';
const invalid = await fetch(`${base}/api/placement`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ baseRevision: saved.revision, draft: wrongPlan, editor: 'Invalid test' }) });
assert.equal(invalid.status, 400);
const latest = await fetch(`${base}/api/placement`).then(r => r.json());
assert.equal(latest.revision, saved.revision);
const restored = P.create(plan);
P.importDraft(restored, latest.draft);
const history = await fetch(`${base}/api/placement/history`).then(r => r.json());
assert.equal(history.entries[0].revision, saved.revision);
const detail = await fetch(`${base}/api/placement/history/${saved.revision}`).then(r => r.json());
assert.deepEqual(detail.draft, draft);
const changed = P.create(plan); P.importDraft(changed, draft);
const pair = [...changed.assignments].find(([id, site], index, entries) =>
  index > 0 && changed.sites.get(site).zone === changed.sites.get(entries[0][1]).zone);
assert(pair);
const firstId = changed.assignments.keys().next().value;
const firstSite = changed.assignments.get(firstId);
changed.assignments.set(firstId, pair[1]); changed.assignments.set(pair[0], firstSite);
changed.locks.add(firstId);
const edit = await fetch(`${base}/api/placement`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ baseRevision: saved.revision, draft: P.exportDraft(changed), editor: 'Editor test' }) });
assert.equal(edit.status, 200, await edit.clone().text());
const edited = await edit.json();
assert.equal(edited.changes.moved.length, 2);
assert.equal(edited.changes.locked.length, 1);
const editDetail = await fetch(`${base}/api/placement/history/${edited.revision}`).then(r => r.json());
assert.equal(editDetail.changes.moved.length, 2);
const restore = await fetch(`${base}/api/placement/restore`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ baseRevision: edited.revision, sourceRevision: saved.revision, editor: 'Restore test' }) });
assert.equal(restore.status, 200, await restore.clone().text());
const restoredRevision = await restore.json();
assert.equal(restoredRevision.action, 'restore');
assert.equal(restoredRevision.sourceRevision, saved.revision);
const final = await fetch(`${base}/api/placement`).then(r => r.json());
assert.deepEqual(final.draft, draft);
console.log('D1 save, history, change details, restore, auth, and revision conflict passed');

const nextPlan = structuredClone(plan);
nextPlan.planId = 'test-atlas-' + Date.now();
nextPlan.meta.powerCaptured = '2026-10-01';
nextPlan.placements[0].name = 'New snapshot display name';
nextPlan.placements[0].id = Math.max(...plan.placements.map(p => p.id)) + 1;
const nextDraft = P.exportDraft(P.create(nextPlan));
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
const migrationBody = { baseRevision: restoredRevision.revision,
  previousPlan: plan, plan: nextPlan, draft: nextDraft, editor: 'Atlas refresh test' };
const migration = await fetch(`${base}/api/placement/migrate`, {
  method: 'POST', headers, body: JSON.stringify(migrationBody) });
assert.equal(migration.status, 200, await migration.clone().text());
const migrated = await migration.json();
assert.equal(migrated.action, 'atlas_refresh');
assert.equal(migrated.changes.added.length, 1);
assert.equal(migrated.changes.removed.length, 1);
assert.equal(migrated.changes.added[0].name, nextPlan.placements[0].name);
assert.equal(migrated.changes.removed[0].name, plan.placements[0].name);
const conflictMigration = await fetch(`${base}/api/placement/migrate`, {
  method: 'POST', headers, body: JSON.stringify(migrationBody) });
assert.equal(conflictMigration.status, 409);
const migratedHistory = await fetch(`${base}/api/placement/history/${migrated.revision}`).then(r => r.json());
assert.deepEqual(migratedHistory.plan, nextPlan);
const oldHistory = await fetch(`${base}/api/placement/history/${saved.revision}`).then(r => r.json());
assert.deepEqual(oldHistory.plan, plan);
assert.notEqual(oldHistory.plan.placements[0].name, migratedHistory.plan.placements[0].name);
const immutable = structuredClone(migrationBody);
immutable.baseRevision = migrated.revision;
immutable.previousPlan = nextPlan;
immutable.plan.placements[0].name = 'Illegal metadata overwrite';
const rejected = await fetch(`${base}/api/placement/migrate`, {
  method: 'POST', headers, body: JSON.stringify(immutable) });
assert.equal(rejected.status, 400);
const crossRestore = await fetch(`${base}/api/placement/restore`, {
  method: 'POST', headers, body: JSON.stringify({ baseRevision: migrated.revision,
    sourceRevision: saved.revision, editor: 'Old roster restore test' }) });
assert.equal(crossRestore.status, 200, await crossRestore.clone().text());
const crossRestored = await crossRestore.json();
assert.deepEqual((await fetch(`${base}/api/placement`).then(r => r.json())).draft, draft);
const restoreRefresh = await fetch(`${base}/api/placement/restore`, {
  method: 'POST', headers, body: JSON.stringify({ baseRevision: crossRestored.revision,
    sourceRevision: migrated.revision, editor: 'New roster restore test' }) });
assert.equal(restoreRefresh.status, 200, await restoreRefresh.clone().text());
const loadedPlan = await fetch(`${base}/api/placement/plan?signature=${encodeURIComponent(nextDraft.signature)}`).then(r => r.json());
assert.deepEqual(loadedPlan.plan, nextPlan);
console.log('Atlas migration preserves old names/roster, immutable snapshots, CAS, and restores across snapshots');

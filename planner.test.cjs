const assert = require('node:assert/strict');
const fs = require('node:fs');
const P = require('./placement-planner.js');
const plan = JSON.parse(fs.readFileSync('placement-plan.json', 'utf8'));
const state = P.create(plan);
const original = P.rows(state);
assert.equal(original.length, 2000);

const mud = original.find(p => p.zone === 'mud');
const grass = original.find(p => p.zone === 'grass');
const otherGrass = original.find(p => p.zone === 'grass' && p.id !== grass.id);
const mudKey = P.siteKey(mud), grassKey = P.siteKey(grass);
P.moveAndLock(state, grass.id, P.siteKey(otherGrass));
assert.equal(P.current(state, grass.id).x, otherGrass.x);
assert.equal(P.current(state, otherGrass.id).x, grass.x);
assert.throws(() => P.moveAndLock(state, otherGrass.id, P.siteKey(P.current(state, grass.id))), /locked/);

P.addPair(state, grass.id, mud.id);
assert.equal(state.pairs.length, 1);
assert(state.locks.has(grass.id) && state.locks.has(mud.id));
const after = P.rows(state, true);
assert.equal(after.find(p => p.id === grass.id).zone, 'mud');
assert.equal(after.find(p => p.id === mud.id).zone, 'grass');
assert.throws(() => P.moveAndLock(state, grass.id, mudKey), /locked/);

const beforeFill = new Map(state.assignments);
const wedge = { start: 0, end: 60, zone: 'grass', sections: plan.sections };
P.fill(state, wedge);
for (const [id, key] of beforeFill) {
  const site = state.sites.get(key);
  if (state.locks.has(id) || site.zone !== 'grass' || !P.inWedge(site, 0, 60))
    assert.equal(state.assignments.get(id), key);
}
assert.equal(new Set(state.assignments.values()).size, 2000);
assert.equal(P.current(state, mud.id).zone, 'mud');
assert.equal(P.current(state, grass.id).zone, 'grass');
assert(P.inWedge(state.sites.get(grassKey), 350, 70) ===
  ((state.sites.get(grassKey).angle * 180 / Math.PI) % 360 >= 350 ||
   (state.sites.get(grassKey).angle * 180 / Math.PI) % 360 <= 70));

const draft = P.exportDraft(state), restored = P.create(plan);
P.importDraft(restored, draft);
assert.deepEqual(P.exportDraft(restored), draft);
assert.throws(() => P.importDraft(restored, { ...draft, signature: 'wrong' }), /different base/);
console.log('Manual locks, wedge fill, strike swap, and draft validation passed');

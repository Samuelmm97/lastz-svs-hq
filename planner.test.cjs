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
const wrongSite = structuredClone(draft);
wrongSite.assignments[0][1] = '999,999';
assert.throws(() => P.importDraft(restored, wrongSite), /unknown players or sites/);
console.log('Manual locks, wedge fill, strike swap, and draft validation passed');

const ranked = P.create({ sections: {}, placements: [
  { id: 1, name: 'Highest HQ', hq: 27, heroPower: 100, totalPower: 200, priority: 2, zone: 'mud', x: 1, y: 1, ring: 20, angle: 0 },
  { id: 2, name: 'Highest hero', hq: 24, heroPower: 200, totalPower: 100, priority: 1, zone: 'mud', x: 2, y: 2, ring: 21, angle: 0 },
  { id: 3, name: 'Hero tie, more power', hq: 25, heroPower: 100, totalPower: 300, priority: 0, zone: 'mud', x: 3, y: 3, ring: 22, angle: 0 },
  { id: 4, name: 'Prior unshielded', hq: 27, priority: 2, zone: 'grass', x: 4, y: 4, ring: 37, angle: 0 },
  { id: 5, name: 'Prior attendee', hq: 24, priority: 0, zone: 'grass', x: 5, y: 5, ring: 45, angle: 0 },
  { id: 6, name: 'Prior outside', hq: 25, priority: 1, zone: 'grass', x: 6, y: 6, ring: 70, angle: 0 },
] });
P.fill(ranked);
assert.equal(P.current(ranked, 2).ring, 20);
assert.equal(P.current(ranked, 3).ring, 21);
assert.equal(P.current(ranked, 1).ring, 22);
assert.equal(P.current(ranked, 5).ring, 37);
assert.equal(P.current(ranked, 6).ring, 45);
assert.equal(P.current(ranked, 4).ring, 70);
console.log('Mud uses hero/total/HQ; grass keeps old SvS priority groups');

const cleared=P.create(plan);
const keeper=P.rows(cleared).find(p=>p.zone==='mud');
P.moveAndLock(cleared,keeper.id,P.siteKey(keeper));
assert.equal(P.clear(cleared),180);
assert.equal(P.current(cleared,keeper.id).zone,'mud');
const waiting=P.rows(cleared).filter(p=>p.zone==='unassigned');
assert.equal(waiting.length,180);
assert(waiting.every(p=>p.x===null&&p.y===null));
const emptyMud=[...cleared.sites].find(([key,s])=>s.zone==='mud'&&P.playerAt(cleared,key)===null)[0];
P.moveAndLock(cleared,waiting[0].id,emptyMud);
assert.equal(P.current(cleared,waiting[0].id).zone,'mud');
assert.equal(P.rows(cleared).filter(p=>p.zone==='unassigned').length,179);
const savedWaiting=P.exportDraft(cleared),again=P.create(plan);
P.importDraft(again,savedWaiting);
assert.deepEqual(P.exportDraft(again),savedWaiting);
P.setSection(again,'Helm',285,345);
assert.equal(again.sections.Helm.start,285*Math.PI/180);
assert.equal(P.exportDraft(again).sections.Helm.end,345*Math.PI/180);
const placedBack=P.pushBack(again,'Helm');
assert(placedBack>=0);
const assigned=[...again.assignments.values()].filter(key=>key!==null);
assert.equal(new Set(assigned).size,assigned.length);
const blockedPlan={...plan,blockedSites:[P.siteKey(keeper)]};
const blocked=P.create(blockedPlan);
assert.equal(P.current(blocked,keeper.id).zone,'unassigned');
assert.throws(()=>P.moveAndLock(blocked,keeper.id,P.siteKey(keeper)),/legal site/);
console.log('Clear-to-waiting, refill, boundaries, back grass, and blocked sites passed');

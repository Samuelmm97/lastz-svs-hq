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
  { id: 1, name: 'Highest HQ', tag: 'A', section: 'A', hq: 27, heroPower: 100, totalPower: 200, priority: 2, zone: 'mud', x: 1, y: 1, ring: 20, angle: 0 },
  { id: 2, name: 'Highest hero', tag: 'A', section: 'A', hq: 24, heroPower: 200, totalPower: 100, priority: 1, zone: 'mud', x: 2, y: 2, ring: 21, angle: 0 },
  { id: 3, name: 'Hero tie, more power', tag: 'A', section: 'A', hq: 25, heroPower: 100, totalPower: 300, priority: 0, zone: 'mud', x: 3, y: 3, ring: 22, angle: 0 },
  { id: 4, name: 'Prior unshielded', tag: 'A', section: 'A', hq: 27, priority: 2, zone: 'grass', x: 4, y: 4, ring: 37, angle: 0 },
  { id: 5, name: 'Prior attendee', tag: 'A', section: 'A', hq: 24, priority: 0, zone: 'grass', x: 5, y: 5, ring: 45, angle: 0 },
  { id: 6, name: 'Prior outside', tag: 'A', section: 'A', hq: 25, priority: 1, zone: 'grass', x: 6, y: 6, ring: 70, angle: 0 },
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
assert.equal(P.clear(cleared),original.filter(p=>p.zone==='mud').length-1);
assert.equal(P.current(cleared,keeper.id).zone,'mud');
const waiting=P.rows(cleared).filter(p=>p.zone==='unassigned');
assert.equal(waiting.length,original.filter(p=>p.zone==='mud').length-1);
assert(waiting.every(p=>p.x===null&&p.y===null));
const emptyMud=[...cleared.sites].find(([key,s])=>s.zone==='mud'&&P.playerAt(cleared,key)===null)[0];
P.moveAndLock(cleared,waiting[0].id,emptyMud);
assert.equal(P.current(cleared,waiting[0].id).zone,'mud');
assert.equal(P.rows(cleared).filter(p=>p.zone==='unassigned').length,waiting.length-1);
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

const rearPlan=P.create(plan);
const rearPeople=P.rows(rearPlan).filter(p=>P.rearReasons(p).length);
assert(rearPeople.some(p=>p.attendanceProxy==='outside_capital_area'));
assert(rearPeople.some(p=>p.highRisk));
const assertRear=state=>{
  const rows=P.rows(state),rear=rows.filter(p=>P.rearReasons(p).length&&!P.isUnaligned(p)&&!p.locked&&p.zone!=='unassigned');
  const regular=rows.filter(p=>!P.rearReasons(p).length&&!p.locked&&p.zone==='grass');
  assert(rear.every(p=>p.zone==='grass'));
  assert(Math.min(...rear.map(p=>p.ring))>=Math.max(...regular.map(p=>p.ring)));
};
assertRear(rearPlan);
P.arrangeAlliance(rearPlan,'Helm');
assertRear(rearPlan);
P.fill(rearPlan);
assertRear(rearPlan);
assert.equal(new Set([...rearPlan.assignments.values()].filter(Boolean)).size,2000);

const risk=rearPeople.find(p=>p.section==='Helm');
const manualTarget=P.rows(rearPlan).find(p=>p.zone==='grass'&&p.ring<60&&!P.rearReasons(p).length);
P.moveAndLock(rearPlan,risk.id,P.siteKey(manualTarget));
const manualKey=rearPlan.assignments.get(risk.id);
P.arrangeAlliance(rearPlan,'Helm');
assert.equal(rearPlan.assignments.get(risk.id),manualKey);
assert(P.rearReasons(P.current(rearPlan,risk.id)).length);
assert.deepEqual(P.rearReasons({tag:'A',section:'A',highRisk:false,attendanceProxy:'unknown'}),[]);
assert.deepEqual(P.rearReasons({highRisk:false,attendanceProxy:'unknown',tag:'',section:'Other'}),['No alliance \u00b7 least likely to join']);
console.log('Global rear priority survives alliance arrange/fill; manual reservations preserved and missing attendance labeled');

// Sign-ups from outside the event alliances always fall behind alliance members in the grass,
// however powerful they are, and never take a mud slot.
const strays = P.create({ sections: { A: { start: 0, end: Math.PI }, Other: { start: 0, end: 2*Math.PI, sharedOpenSpots: true } }, placements: [
  { id: 11, name: 'Huge unaligned', tag: '', section: 'Other', hq: 30, heroPower: 9000000, totalPower: 12000000, priority: 0, zone: 'grass', x: 520, y: 540, ring: 40, angle: 0 },
  { id: 12, name: 'Modest aligned', tag: 'A', section: 'A', hq: 30, priority: 3, zone: 'grass', x: 530, y: 560, ring: 60, angle: 0 },
  { id: 13, name: 'Aligned in mud', tag: 'A', section: 'A', hq: 30, priority: 3, zone: 'mud', x: 510, y: 520, ring: 20, angle: 0 },
] });
P.fill(strays);
const straySite=strays.sites.get(strays.assignments.get(11)), rivalSite=strays.sites.get(strays.assignments.get(12));
assert.equal(straySite.zone,'grass','A player from outside the alliances must never take a mud slot');
assert(straySite.ring>rivalSite.ring,`The unaligned player drops behind the alliance member: ${straySite.ring} vs ${rivalSite.ring}`);
assert.equal(P.current(strays,13).zone,'mud','Alliance members keep the mud slots');
assert(P.isUnaligned(strays.players.get(11))&&!P.isUnaligned(strays.players.get(12)));
assert(P.rearReasons(strays.players.get(11)).some(r=>/No alliance/.test(r)),'Unaligned players are labeled back priority');
console.log('Unaligned sign-ups land behind alliance members in the grass and never in mud');

// A draft can name a tile this state does not know about (an older revision, or a hand-written plan
// that skipped defineSite). Counting the openings inside a wedge has to skip it, not throw -
// teleportGaps already filtered its misses and this is the same data.
const oddSites=P.create({ sections:{A:{start:0,end:Math.PI/2}}, placements:[
  {id:21,name:'A one',tag:'A',section:'A',hq:30,priority:1,zone:'grass',x:520,y:540,ring:40,angle:0},
  {id:22,name:'A two',tag:'A',section:'A',hq:30,priority:2,zone:'grass',x:530,y:560,ring:60,angle:0},
  {id:23,name:'A three',tag:'A',section:'A',hq:30,priority:3,zone:'grass',x:522,y:548,ring:44,angle:.2}]});
oddSites.assignments.set(23,'9999,9999');
assert.doesNotThrow(()=>P.teleportGaps(oddSites,new Map(oddSites.assignments)),'teleportGaps ignores an unknown tile');
assert.doesNotThrow(()=>P.teleportOpenings(oddSites,'A'),'teleportOpenings ignores an unknown tile too');
console.log('Openings measurement skips assignments that name an unknown tile instead of throwing');

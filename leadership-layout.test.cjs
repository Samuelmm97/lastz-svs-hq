const assert=require('node:assert/strict');
const fs=require('node:fs');
const P=require('./placement-planner.js');
const {applyLeadership,groups,match}=require('./leadership-layout.cjs');
const previous=JSON.parse(fs.readFileSync('placement-plan.json','utf8'));
assert.deepEqual(match([[8,1,4],[2,9,5]]),[1,0]);
const state=P.create(previous);
const reserve=P.rows(state).find(p=>p.zone==='mud'&&!P.rearReasons(p).length);
const strike=P.rows(state).find(p=>p.zone==='grass'&&!P.rearReasons(p).length);
P.addPair(state,strike.id,reserve.id);
const waiter=P.rows(state).find(p=>p.zone==='grass'&&p.id!==strike.id);
P.unassign(state,waiter.id);
const shared={revision:18,draft:P.exportDraft(state)};
const {plan,draft,report}=applyLeadership(previous,shared);
const next=P.create(plan);P.importDraft(next,draft);
assert.equal(next.assignments.get(waiter.id),null);
assert.deepEqual(draft.pairs,shared.draft.pairs);
for(const id of shared.draft.locks)assert.equal(next.assignments.get(id),state.assignments.get(id));
for(const p of plan.placements){
  const old=state.players.get(p.id);
  for(const field of ['hq','heroPower','totalPower','attendanceProxy','highRisk','priority','shield'])
    assert.equal(p[field],old[field]);
  if(P.rearReasons(p).length&&!state.locks.has(p.id))assert.equal(p.zone,'grass');
}
assert.equal(plan.placements.length,2000);
assert.equal(new Set(plan.placements.map(P.siteKey)).size,2000);
assert(report.rearGrassMinRing>=report.frontGrassMaxRing);
for(const g of groups)for(const tag of g.tags){
  assert.equal(plan.sections[tag].start,g.start*Math.PI/180);
  assert.equal(plan.sections[tag].end,g.end*Math.PI/180);
}
P.setSection(next,'SHSN',350,25);
assert.equal(next.sections.movR.start,next.sections.SHSN.start);
assert.equal(next.sections.movR.end,next.sections.SHSN.end);
assert.notEqual(next.sections.Ayaa.start,next.sections.SHSN.start);
console.log('Leadership areas, paired boundaries, attendance, locks, waiting and swap reservations passed');

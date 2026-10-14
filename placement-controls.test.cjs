const assert=require('node:assert/strict');
const fs=require('node:fs');
const P=require('./placement-planner.js');
const plan=JSON.parse(fs.readFileSync('placement-plan.json','utf8'));
const state=P.create(plan);
P.setSection(state,'Helm',270,308,{grassOnly:true,frontLayers:2,bodyGap:2});
const before=new Map(state.assignments);
const locked=P.rows(state).find(p=>p.section==='Helm'&&p.zone==='grass');
state.locks.add(locked.id);
const report=P.arrangeAlliance(state,'Helm');
assert(report.moved>0);
assert.equal(state.assignments.get(locked.id),before.get(locked.id));
for(const [id,key] of before)if(state.players.get(id).section!=='Helm')assert.equal(state.assignments.get(id),key,'Foreign alliance moved');
const members=P.rows(state).filter(p=>p.section==='Helm'&&!p.locked&&p.zone!=='unassigned');
assert(members.every(p=>P.inWedge(p,270,308)),'Grass or mud leaked out of the wedge');
const front=members.filter(p=>p.zone==='mud'&&[19,22].includes(p.ring));
assert(front.length>2,'Touching frontline was not built');
assert(front.some(a=>front.some(b=>a.id!==b.id&&P.distance(a,b)===3)),'Front footprints do not touch');
const body=members.filter(p=>p.zone==='mud'&&p.ring>22);
for(const b of body)for(const a of members.filter(p=>p.zone==='mud'&&p.id!==b.id))assert(P.distance(a,b)>=5,'Two empty body tiles not maintained');
const grass=members.filter(p=>p.zone==='grass');
const rear=grass.filter(p=>P.rearReasons(p).length),regular=grass.filter(p=>!P.rearReasons(p).length);
if(rear.length&&regular.length)assert(Math.min(...rear.map(p=>p.ring))>=Math.max(...regular.map(p=>p.ring)));
const draft=P.exportDraft(state),restored=P.create(plan);
assert(draft.sites.length>0,'Frontline requires new legal tiles');
P.importDraft(restored,draft);assert.deepEqual(P.exportDraft(restored),draft);
const corrupt=structuredClone(draft);corrupt.sites[0].x=500;corrupt.sites[0].y=500;
assert.throws(()=>P.importDraft(restored,corrupt),/buildable/);
assert.throws(()=>P.defineSite(state,500,500),/buildable/);
assert.throws(()=>P.defineSite(state,500.1,481),/whole-number/);
assert.throws(()=>P.defineSite(state,491,520),/blocked|buffer/);
const movable=members.find(p=>p.zone==='mud');
const outside=P.rows(state).find(p=>p.zone==='grass'&&!P.inWedge(p,270,308));
assert.throws(()=>P.moveAndLock(state,movable.id,P.siteKey(outside)),/wedge/);
// Exact placement in an empty region survives export/import; adjacent HQs are rejected.
const manual=P.create(plan);
P.clear(manual,{includeLocked:true});
const player=P.rows(manual).find(p=>p.section==='Helm');
P.setSection(manual,'Helm',270,308,{grassOnly:true,frontLayers:1,bodyGap:1});
const key=P.defineSite(manual,480,495);P.moveAndLock(manual,player.id,key);
assert.equal(manual.assignments.get(player.id),key);assert(manual.locks.has(player.id));
const other=P.rows(manual).find(p=>p.section==='Helm'&&p.id!==player.id);
const tooClose=P.defineSite(manual,481,495);
assert.throws(()=>P.moveAndLock(manual,other.id,tooClose),/close/);
P.importDraft(P.create(plan),P.exportDraft(manual));
// A wedge with no available grass must produce waiting, never spill or swap foreign HQs.
const tiny=P.create({sections:{A:{start:0,end:Math.PI/2}},placements:[
  {id:1,section:'A',name:'A',hq:20,priority:0,highRisk:true,x:500,y:540,zone:'grass',ring:40,angle:Math.PI},
  {id:2,section:'B',name:'B',hq:20,priority:0,x:540,y:500,zone:'grass',ring:40,angle:Math.PI/2}]});
P.setSection(tiny,'A',0,90,{grassOnly:true,frontLayers:0,bodyGap:1});
assert.equal(P.arrangeAlliance(tiny,'A').waiting,1);
assert.equal(tiny.assignments.get(1),null);assert.equal(tiny.assignments.get(2),'540,500');
P.pushBack(tiny,'A');assert.equal(tiny.assignments.get(1),null);
// Shared alliance rules and north-crossing boundaries use the same area.
const grouped=P.create(plan);P.setSection(grouped,'SHSN',350,25,{grassOnly:true,frontLayers:2,bodyGap:3});
if(grouped.sections.SHSN.group)assert.equal(grouped.sections.movR.bodyGap,3);
console.log('Strict wedges, touching fronts, body spacing, exact tiles, collisions, shortages, locks and draft persistence passed');

const gapPlan={sections:{},placements:[
  {id:1,name:'Front',hq:24,x:480,y:500,ring:20,angle:3*Math.PI/2,zone:'mud'},
  {id:2,name:'Neighbor',hq:24,x:477,y:500,ring:23,angle:3*Math.PI/2,zone:'mud'}]};
const gaps=P.create(gapPlan),beforeGap=new Map(gaps.assignments);
const far=P.defineSite(gaps,470,500);
const proposed=P.checkPlacement(gaps,1,far);
const openings=P.teleportGaps(gaps,beforeGap,proposed.next);
assert(openings.length>0,'Vacating the front must expose a teleport-sized hole');
for(const s of openings)for(const key of proposed.next.values())if(key)assert(P.distance(s,gaps.sites.get(key))>=3);
P.moveAndLock(gaps,1,far);assert.deepEqual(P.teleportGaps(gaps,beforeGap),openings);
const swap=P.create(gapPlan),beforeSwap=new Map(swap.assignments);
P.moveAndLock(swap,1,'477,500');assert.deepEqual(P.teleportGaps(swap,beforeSwap),[],'An occupied-for-occupied swap creates no hole');
const clustered=P.create(plan),clusterBefore=new Map(clustered.assignments);
P.setSection(clustered,'Helm',270,328,{grassOnly:true,grassCompact:true,frontLayers:2,bodyGap:1});
const grassReport=P.arrangeGrass(clustered,'Helm');assert(grassReport.moved>0);
for(const [id,key] of clusterBefore)if(clustered.players.get(id).section!=='Helm'&&clustered.assignments.get(id)!==key) {
  const old=clustered.sites.get(key),p=P.current(clustered,id),own=clustered.sections[p.section];
  assert.equal(old.zone,'grass');assert(P.inWedge(old,270,328));assert.equal(p.zone,'grass');
  assert(!P.inWedge(p,270,328));
  if(p.section!=='Other'&&own)assert(P.inWedge(p,own.start*180/Math.PI,own.end*180/Math.PI));
}
for(const [id,key] of clusterBefore)if(clustered.sites.get(key)?.zone==='mud')assert.equal(clustered.assignments.get(id),key,'Grass grouping changed mud');
const together=P.rows(clustered).filter(p=>p.section==='Helm'&&p.zone==='grass');
assert(together.every(p=>P.inWedge(p,270,328)));
const low=together.filter(p=>p.hq<24);assert(low.length>0,'Lower HQs must be included in the cluster');
assert.equal(grassReport.waiting,0,'Tight grouping must include every grass member');
const connected=new Set([together[0].id]),queue=[together[0]];
while(queue.length){const p=queue.pop();for(const other of together)if(!connected.has(other.id)&&P.distance(p,other)===4){connected.add(other.id);queue.push(other);}}
assert.equal(connected.size,together.length,'A chain allowing eight-tile jumps hides isolated grass players');
const displaced=P.rows(clustered).filter(p=>p.section==='Other'&&clustered.assignments.get(p.id)!==clusterBefore.get(p.id));
assert.equal(displaced.length,grassReport.displacedShared);
assert(displaced.every(p=>p.zone==='grass'&&!P.inWedge(p,270,328)),'Blocking shared HQs must receive legal grass outside the alliance wedge');
const bearOrder=[...together].sort((a,b)=>clustered.sites.get(clusterBefore.get(a.id)).ring-clustered.sites.get(clusterBefore.get(b.id)).ring||
  Math.abs(Math.atan2(Math.sin(clustered.sites.get(clusterBefore.get(a.id)).angle-299*Math.PI/180),Math.cos(clustered.sites.get(clusterBefore.get(a.id)).angle-299*Math.PI/180)))-
  Math.abs(Math.atan2(Math.sin(clustered.sites.get(clusterBefore.get(b.id)).angle-299*Math.PI/180),Math.cos(clustered.sites.get(clusterBefore.get(b.id)).angle-299*Math.PI/180)))||a.id-b.id);
const anchor=bearOrder[0];
for(let i=1;i<bearOrder.length;i++)assert(P.distance(bearOrder[i],anchor)>=P.distance(bearOrder[i-1],anchor),'Existing grass order was reranked');
P.importDraft(P.create(plan),P.exportDraft(clustered));
const savedOrder=[...clustered.sections.Helm.grassOrder];
P.arrangeGrass(clustered,'Helm');assert.deepEqual(clustered.sections.Helm.grassOrder,savedOrder,'Repeated grouping must preserve Bear’s original order');
const invalidOrder=P.exportDraft(clustered);invalidOrder.sections.Helm.grassOrder.push(-1);
assert.throws(()=>P.importDraft(P.create(plan),invalidOrder),/boundaries/);
console.log('Manual teleport gaps and tight grass grouping passed: normal-spacing connectivity, all lower HQs included, stable order, safe relocation into own/shared grass and all mud fixed');

const formation=P.create(plan),formationBefore=P.exportDraft(formation);
const currentMud=P.rows(formation).filter(p=>p.section==='Helm'&&p.zone==='mud').sort((a,b)=>a.ring-b.ring||a.id-b.id).map(p=>p.id);
const currentGrass=P.rows(formation).filter(p=>p.section==='Helm'&&p.zone==='grass').sort((a,b)=>a.ring-b.ring||a.id-b.id).map(p=>p.id);
P.setSection(formation,'Helm',270,328,{grassOnly:true,grassCompact:true,frontLayers:2,bodyGap:1,mudOrder:currentMud,grassOrder:[...currentMud,...currentGrass]});
const formationReport=P.arrangeAlliance(formation,'Helm');assert.equal(formationReport.waiting,0);
const formationRows=P.rows(formation).filter(p=>p.section==='Helm'),formationFront=formationRows.filter(p=>p.zone==='mud'&&p.ring<=22);
assert(formationFront.length>2);
assert(formationFront.every(a=>formationFront.some(b=>a.id!==b.id&&P.distance(a,b)===3)),'Every front HQ must touch another front HQ');
const formationBody=formationRows.filter(p=>p.zone==='mud'&&p.ring>22);
for(const b of formationBody)for(const a of formationRows.filter(p=>p.zone==='mud'&&p.id!==b.id))assert(P.distance(a,b)>=4,'One empty tile must separate body footprints');
assert.deepEqual(formation.sections.Helm.mudOrder,currentMud);
const formationDraft=P.exportDraft(formation),formationRestored=P.create(plan);P.importDraft(formationRestored,formationDraft);
assert.deepEqual(P.exportDraft(formationRestored),formationDraft);
const beforeNamed=new Map(formationBefore.assignments);
for(const p of P.rows(formation))if(p.section!=='Helm'&&formation.sites.get(beforeNamed.get(p.id))?.zone==='mud')assert.equal(formation.assignments.get(p.id),beforeNamed.get(p.id));
console.log('Combined saved formation passed: touching front block, one empty tile behind/body, persisted Bear order, compact grass overflow, and other mud preserved');

const landing=P.create({sections:{A:{start:0,end:2*Math.PI}},placements:[
  {...P.coordinateSite(gaps,480,500),id:1,section:'A',name:'Moved front'},
  {...P.coordinateSite(gaps,477,500),id:2,section:'A',name:'Front neighbor'},
  {...P.coordinateSite(gaps,480,504),id:3,section:'A',name:'Body neighbor'},
  {...P.coordinateSite(gaps,480,508),id:4,section:'B',name:'Hidden other alliance'},
]});
P.moveAndLock(landing,1,P.defineSite(landing,470,500));
const existing=P.teleportOpenings(landing,'A');
assert(existing.some(p=>p.x===480&&p.y===500),'Existing gap must be detected without a last-move warning');
assert(!existing.some(p=>p.x===480&&p.y===508),'Hidden other-alliance HQ must block a landing');
for(const s of existing)for(const p of P.rows(landing))assert(P.distance(s,p)>=3);
console.log('Existing openings are scanned independently of manual-move history and include hidden-alliance footprint checks');

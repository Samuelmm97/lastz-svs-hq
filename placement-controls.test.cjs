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
for(const [id,key] of clusterBefore)if(clustered.players.get(id).section!=='Helm'||clustered.sites.get(key)?.zone==='mud')
  assert.equal(clustered.assignments.get(id),key,'Grass-only grouping changed mud or another alliance');
const together=P.rows(clustered).filter(p=>p.section==='Helm'&&p.zone==='grass');
assert(together.every(p=>P.inWedge(p,270,328)));
const low=together.filter(p=>p.hq<24);assert(low.length>0,'Lower HQs must be included in the cluster');
const bearOrder=[...together].sort((a,b)=>clustered.sites.get(clusterBefore.get(a.id)).ring-clustered.sites.get(clusterBefore.get(b.id)).ring||
  Math.abs(Math.atan2(Math.sin(clustered.sites.get(clusterBefore.get(a.id)).angle-299*Math.PI/180),Math.cos(clustered.sites.get(clusterBefore.get(a.id)).angle-299*Math.PI/180)))-
  Math.abs(Math.atan2(Math.sin(clustered.sites.get(clusterBefore.get(b.id)).angle-299*Math.PI/180),Math.cos(clustered.sites.get(clusterBefore.get(b.id)).angle-299*Math.PI/180)))||a.id-b.id);
const anchor=bearOrder[0];
for(let i=1;i<bearOrder.length;i++)assert(P.distance(bearOrder[i],anchor)>=P.distance(bearOrder[i-1],anchor),'Existing grass order was reranked');
P.importDraft(P.create(plan),P.exportDraft(clustered));
console.log('Manual moves expose legal teleport gaps; swaps do not. Grass-only compact grouping includes lower HQs, preserves current order and leaves mud/other alliances fixed');

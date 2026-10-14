const assert=require('node:assert/strict'),P=require('./placement-planner.js');
function fixture(){const plan={placements:[],sections:{A:{start:0,end:2*Math.PI},B:{start:Math.PI,end:2*Math.PI,grassOnly:true}},meta:{mudMinDistance:3}},grid=P.create(plan);plan.placements=[[540,500,'A'],[450,500,'B']].map(([x,y,section],id)=>({...P.coordinateSite(grid,x,y),id,name:'Player '+id,section,tag:section,hq:25}));return P.create(plan);}
let state=fixture(),before=P.exportDraft(state);
assert.throws(()=>P.checkPlacement(state,0,'450,500'),/outside their wedge/);
const result=P.checkPlacement(state,0,'450,500',{occupied:'unplace'});
assert.equal(result.next.get(0),'450,500');assert.equal(result.next.get(1),null);assert.deepEqual(P.exportDraft(state),before,'Checking must not mutate either player');
P.moveAndLock(state,0,'450,500',{occupied:'unplace'});assert.equal(state.assignments.get(1),null);assert(state.locks.has(0));
state=fixture();state.sections.B.grassOnly=false;P.moveAndLock(state,0,'450,500',{occupied:'swap'});assert.equal(state.assignments.get(1),'540,500');
for(const occupied of ['swap','unplace']){state=fixture();state.locks.add(1);assert.throws(()=>P.moveAndLock(state,0,'450,500',{occupied}),/locked/);assert.equal(state.assignments.get(0),'540,500');assert.equal(state.assignments.get(1),'450,500');}
assert.throws(()=>P.checkPlacement(fixture(),0,'450,500',{occupied:'discard'}),/occupied target action/);
console.log('Occupied drop swap/unplaced choices are atomic; wedge checks and reservations preserved');

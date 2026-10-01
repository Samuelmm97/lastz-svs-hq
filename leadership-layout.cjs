/* Apply the October 1 leadership sketch to an existing roster and shared draft. */
const P = require('./placement-planner.js');
const crypto = require('node:crypto');
const groups = [
  {id:'north',label:'SHSN / MOVR',tags:['SHSN','movR'],start:0,end:20},
  {id:'northeast',label:'E45Y / AYAA',tags:['E45Y','Ayaa'],start:20,end:61},
  {id:'east',label:'SWT',tags:['SWT'],start:61,end:104},
  {id:'east-southeast',label:'UPS',tags:['UpS'],start:104,end:135},
  {id:'southeast',label:'7CIE / ULD',tags:['7cie','ULD'],start:135,end:161},
  {id:'south',label:'ATAM',tags:['aTam'],start:161,end:180},
  {id:'southwest',label:'WRATH',tags:['WRtH'],start:180,end:224},
  {id:'west-southwest',label:'4NG',tags:['4NG'],start:224,end:270},
  {id:'west',label:'Helm',tags:['Helm'],start:270,end:308},
  {id:'northwest',label:'MERC',tags:['mERC'],start:308,end:360},
];
const rad = d => d*Math.PI/180;
const gap = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const inArea=(s,g)=>{const deg=(s.angle*180/Math.PI+360)%360;return deg>=g.start&&deg<g.end;};
const grid=s=>{const j=s.y-500;return [s.x-500-Math.floor(j/2),j];};
const distance=(a,b)=>{const [ai,aj]=grid(a),[bi,bj]=grid(b);return Math.max(Math.abs(ai-bi),Math.abs(aj-bj),Math.abs(ai+aj-bi-bj));};
const combat = (a,b) => (b.heroPower??-1)-(a.heroPower??-1) ||
  (b.totalPower??-1)-(a.totalPower??-1) || b.hq-a.hq || a.id-b.id;

// Rectangular minimum-cost matching. The shared slots, rather than the order
// alliances are processed, determine how much neighboring groups must spread.
function match(cost) {
  const n=cost.length,m=cost[0]?.length||0;
  if (n>m) throw Error('Not enough placement slots');
  const u=new Float64Array(n+1),v=new Float64Array(m+1),p=new Int32Array(m+1),way=new Int32Array(m+1);
  for (let i=1;i<=n;i++) {
    p[0]=i;let j0=0;
    const min=new Float64Array(m+1);min.fill(Infinity);
    const used=new Uint8Array(m+1);
    do {
      used[j0]=1;const i0=p[j0];let delta=Infinity,j1=0;
      for(let j=1;j<=m;j++)if(!used[j]) {
        const cur=cost[i0-1][j-1]-u[i0]-v[j];
        if(cur<min[j]){min[j]=cur;way[j]=j0;}
        if(min[j]<delta){delta=min[j];j1=j;}
      }
      for(let j=0;j<=m;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;
      j0=j1;
    }while(p[j0]);
    do {const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
  }
  const out=new Int32Array(n);
  for(let j=1;j<=m;j++)if(p[j])out[p[j]-1]=j-1;
  return [...out];
}

function applyLeadership(previous,shared) {
  const state=P.create(previous);P.importDraft(state,shared.draft);
  const compactGroups=groups.filter(g=>g.tags.some(tag=>['Helm','SWT'].includes(tag)));
  const lockedSites=new Set([...state.locks].map(id=>state.assignments.get(id)));
  const catalog=new Map([...state.sites].filter(([key,s])=>s.zone!=='mud'||lockedSites.has(key)||
    !compactGroups.some(g=>inArea(s,g))));
  const blocked=new Set(previous.blockedSites||[]);
  for(const row of require('./mud-spots-compact.json')) {
    const j=row.Y-500,i=row.X-500-Math.floor(j/2);
    const s={x:row.X,y:row.Y,ring:row.ring,angle:(Math.atan2(i+j/2,-j)+2*Math.PI)%(2*Math.PI),zone:'mud',spot:row.n};
    const key=P.siteKey(s);
    if(blocked.has(key)||!compactGroups.some(g=>inArea(s,g))||catalog.has(key))continue;
    if([...catalog.values()].some(other=>distance(s,other)<3))continue;
    catalog.set(key,s);
  }
  const extra=catalog.size-state.players.size;
  if(extra<0)throw Error('Compact catalog has fewer slots than the existing roster');
  const removable=[...catalog].filter(([key,s])=>s.zone==='grass'&&!lockedSites.has(key))
    .sort((a,b)=>a[1].ring-b[1].ring||a[1].angle-b[1].angle);
  if(removable.length<extra)throw Error('Manual grass reservations prevent compact placement');
  for(const [key] of removable.slice(0,extra))catalog.delete(key);
  state.sites=catalog;
  const waiting=new Set([...state.assignments].filter(([,key])=>key===null).map(([id])=>id));
  const people=[...state.players.values()].map(p=>({...p}));
  const byTag=new Map(groups.flatMap(g=>g.tags.map(tag=>[tag,g])));
  const sections={};
  for(const g of groups)for(const tag of g.tags)sections[tag]={
    start:rad(g.start),end:rad(g.end),group:g.id,label:g.label,
    players:people.filter(p=>p.tag===tag).length};
  sections.Other={start:0,end:2*Math.PI,sharedOpenSpots:true,
    players:people.filter(p=>!byTag.has(p.tag)).length};
  for(const p of people)p.section=byTag.has(p.tag)?p.tag:'Other';
  const placement=new Map(),pool=new Map(state.sites);
  for(const id of state.locks){const key=state.assignments.get(id);placement.set(id,key);pool.delete(key);}
  // Waiting players remain waiting in the shared draft. They are assigned a
  // unique catalog slot in the immutable base so editors can place them later.
  const mutable=people.filter(p=>!state.locks.has(p.id));
  const rear=mutable.filter(p=>P.rearReasons(p).length);
  const normal=mutable.filter(p=>!P.rearReasons(p).length);
  const mudEligible=p=>p.hq>=24&&!P.rearReasons(p).length;
  const assign=(p,key)=>{placement.set(p.id,key);pool.delete(key);};
  const mudSlots=[...pool].filter(([,s])=>s.zone==='mud');
  for(const g of groups) {
    const slots=mudSlots.filter(([,s])=>inArea(s,g)).sort((a,b)=>a[1].ring-b[1].ring||
      gap(a[1].angle,rad((g.start+g.end)/2))-gap(b[1].angle,rad((g.start+g.end)/2)));
    const candidates=normal.filter(p=>g.tags.includes(p.tag)).sort(combat);
    if(candidates.length<slots.length)throw Error(g.label+' lacks enough safe players for its mud area');
    candidates.slice(0,slots.length).forEach((p,i)=>assign(p,slots[i][0]));
  }
  for(const g of [...groups,{tags:people.filter(p=>!byTag.has(p.tag)).map(p=>p.tag),start:0,end:360}]) {
    const members=normal.filter(p=>g.tags.includes(p.tag)&&placement.has(p.id));
    const slots=members.map(p=>placement.get(p.id)).sort((a,b)=>state.sites.get(a).ring-state.sites.get(b).ring||
      gap(state.sites.get(a).angle,rad((g.start+g.end)/2))-gap(state.sites.get(b).angle,rad((g.start+g.end)/2)));
    members.sort(combat);
    members.forEach((p,i)=>placement.set(p.id,slots[i]));
  }
  const grass=[...pool].filter(([,s])=>s.zone==='grass').sort((a,b)=>b[1].ring-a[1].ring||a[1].angle-b[1].angle);
  if(grass.length<rear.length)throw Error('Not enough back grass');
  const rearSlots=grass.slice(0,rear.length),frontSlots=grass.slice(rear.length);
  function grassGroup(players,slots) {
    players.sort((a,b)=>b.hq-a.hq||a.id-b.id);
    const cost=players.map(p=>Float64Array.from(slots,([key,s])=>{
      const g=byTag.get(p.tag);
      const angle=g?gap(s.angle,rad((g.start+g.end)/2)):0;
      return angle*angle*10000+s.ring*(p.hq-2)*5;
    }));
    const targets=match(cost);
    players.forEach((p,i)=>assign(p,slots[targets[i]][0]));
  }
  grassGroup(normal.filter(p=>!placement.has(p.id)),frontSlots);
  grassGroup(rear,rearSlots);
  const placements=people.map(p=>({...p,...state.sites.get(placement.get(p.id))}));
  if(new Set(placement.values()).size!==people.length)throw Error('Placement collision');
  const plan={...previous,sections,placements,meta:{...previous.meta,
    allianceGrouping:'Leadership map enforced in mud; grass groups stay nearby with prior SvS risks in back',
    layoutSource:'Leadership sketch received October 1, 2026; edge angles estimated from the drawn rays',
    leadershipAreas:groups.map(({label,start,end})=>({label,start,end})),
    helmCenterDegrees:289,helmMudEnvelopeDegrees:38,
    leadershipMudBoundaries:true,mudMinDistance:3,mudSpacingMode:'Footprints touch in Helm and SWT; other mud areas retain the existing gaps',
    compactAlliances:['Helm','SWT'],mudSpots:[...catalog.values()].filter(s=>s.zone==='mud').length,
    grassSpots:[...catalog.values()].filter(s=>s.zone==='grass').length,
    refreshProgress:'Leadership mud boundaries enforced. Helm and SWT use denser positions with nonoverlapping HQ footprints. Hero power, total power, then HQ rank each group’s mud players, including lower tiers when needed. Overflow supports from nearby grass. Confirmed old risks stay in back; unknown attendance has no back penalty. Roster and turret checks continue.'}};
  plan.planId='leadership-2026-10-01-'+crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0,16);
  const next=P.create(plan);
  next.assignments=new Map([...placement].map(([id,key])=>[id,waiting.has(id)?null:key]));
  next.sections=sections;next.locks=new Set(state.locks);next.pairs=structuredClone(state.pairs);
  const draft=P.exportDraft(next);P.importDraft(P.create(plan),draft);
  const report={basedOnRevision:shared.revision,waiting:waiting.size,locked:state.locks.size,
    rearPlayers:rear.length,rearGrassMinRing:Math.min(...rearSlots.map(([,s])=>s.ring)),
    frontGrassMaxRing:Math.max(...frontSlots.map(([,s])=>s.ring)),
    mudSpots:plan.meta.mudSpots,grassSpots:plan.meta.grassSpots,
    groups:groups.map(g=>({label:g.label,start:g.start,end:g.end,
      mud:placements.filter(p=>g.tags.includes(p.tag)&&p.zone==='mud').length,
      grass:placements.filter(p=>g.tags.includes(p.tag)&&p.zone==='grass').length}))};
  return {plan,draft,report};
}

module.exports={applyLeadership,groups,match,distance,inArea};
if(require.main===module) {
  const fs=require('node:fs'),path=require('node:path');
  const [priorFile,sharedFile,output]=process.argv.slice(2);
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const previous=read(priorFile),shared=read(sharedFile),result=applyLeadership(previous,shared);
  fs.mkdirSync(output,{recursive:true});
  for(const [name,value] of Object.entries({'previous-plan':previous,'placement-plan':result.plan,
    'placement-draft':result.draft,'placement-review':result.report,'migration-request':{
      baseRevision:shared.revision,previousPlan:previous,plan:result.plan,draft:result.draft,
      editor:'Leadership alliance map update'}}))fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(value));
  console.log(JSON.stringify(result.report,null,2));
}

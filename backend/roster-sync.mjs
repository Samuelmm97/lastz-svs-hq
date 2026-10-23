import '../placement-planner.js';
const P=globalThis.PlacementPlanner;
export function rosterPayload(power){
  if(power?.schemaVersion!==1||power.state!==798||!Array.isArray(power.players)||!power.players.length||power.players.length>5000||!Array.isArray(power.alliances)||!Number.isFinite(Date.parse(power.source?.observedAt)))throw Error('Current collected roster is unavailable');
  const seen=new Set();
  for(const p of power.players){
    if(typeof p.uid!=='string'||!/^\d{1,30}$/.test(p.uid)||seen.has(p.uid)||typeof p.name!=='string'||!p.name||!P.validAllianceTag(p.tag)||!Number.isInteger(p.hq)||p.hq<1||p.hq>99||!Number.isFinite(p.personalPower?.value)||p.personalPower.value<0)throw Error('Current collected roster has invalid player IDs or data');
    seen.add(p.uid);
  }
  return {state:798,source:power.source,alliances:power.alliances,players:power.players.map(p=>({uid:p.uid,name:p.name,tag:p.tag,hq:p.hq}))};
}
export async function syncRoster(previous,before,power){
  rosterPayload(power);
  const sourceRows=[...power.players].sort((a,b)=>a.uid.localeCompare(b.uid));
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({source:power.source,players:sourceRows,alliances:power.alliances})));
  const fingerprint=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(previous.meta?.rosterFingerprint===fingerprint&&previous.meta.rosterSignatureVersion===2)return null;
  const oldByUid=new Map();
  for(const p of previous.placements){if(p.playerId){const uid=String(p.playerId);if(oldByUid.has(uid))throw Error('Previous roster has duplicate player IDs');oldByUid.set(uid,p);}}
  const oldState=P.create(previous);P.importDraft(oldState,before);
  const sections=structuredClone(oldState.sections);
  const slots=previous.placements.map(p=>({x:p.x,y:p.y,zone:p.zone,ring:p.ring,angle:p.angle,...(p.spot!==undefined?{spot:p.spot}:{})}));
  const keys=new Set(slots.map(P.siteKey));
  for(let y=381;y<=619&&slots.length<sourceRows.length;y++)for(let x=381;x<=619&&slots.length<sourceRows.length;x++){
    const key=x+','+y;if(keys.has(key))continue;
    try{const point=P.coordinateSite(oldState,x,y);if(point.zone!=='grass')continue;slots.push(point);keys.add(key);}catch{}
  }
  if(slots.length<sourceRows.length)throw Error('Not enough terrain sites for the collected roster');
  let nextId=Math.max(...previous.placements.map(p=>p.id))+1;
  const placements=sourceRows.map((p,i)=>{
    const old=oldByUid.get(p.uid),section=Object.keys(sections).find(t=>t.toLowerCase()===p.tag.toLowerCase())||'Other';
    return {...old,...slots[i],id:old?.id??nextId++,playerId:p.uid,name:p.name,tag:p.tag,section,hq:p.hq,
      totalPower:p.personalPower.value,totalPowerApproximate:false,heroPower:p.components?.hero?.value??null,
      powerObservedAt:p.personalPower.observedAt,powerCaptured:p.personalPower.observedAt?.slice(0,10),
      nameAliases:[p.name],placementEligible:true,rosterStatus:'confirmed'};
  });
  const ids=new Set(placements.map(p=>p.id));
  for(const area of Object.values(sections))for(const field of ['grassOrder','mudOrder'])if(area[field])area[field]=area[field].filter(id=>ids.has(id));
  const plan={...previous,planId:'roster-uid-'+crypto.randomUUID(),sections,placements,
    meta:{...previous.meta,selected:placements.length,atlasCount:placements.length,rosterFingerprint:fingerprint,
      rosterIdentity:'playerId',rosterSignatureVersion:2,currentPowerSource:power.source,rosterCaptured:power.source.observedAt,
      source:'Latest collected roster shared with Google Sheets',manualRearOverrides:(previous.meta?.manualRearOverrides||[]).filter(id=>ids.has(id))}};
  // Old blocked sites belong to terrain, never to a player's identity.
  if(plan.blockedSites)plan.blockedSites=plan.blockedSites.filter(key=>placements.some(p=>P.siteKey(p)===key));
  const assignments=placements.map(p=>[p.id,oldByUid.has(p.playerId)?oldState.assignments.get(p.id)??null:null]);
  const assigned=new Map(assignments),base=P.create(plan),used=new Set(assignments.map(([,key])=>key).filter(Boolean));
  const sites=[...used].filter(key=>!base.baseSites.has(key)).map(key=>{const [x,y]=key.split(',').map(Number);return {x,y};});
  const locks=[...oldState.locks].filter(id=>ids.has(id)&&assigned.get(id)!=null);
  const pairs=oldState.pairs.filter(pair=>locks.includes(pair.strike)&&locks.includes(pair.reserve));
  const survey=before.survey?structuredClone(before.survey):undefined;
  if(survey){
    const removed=survey.anchors.filter(p=>!ids.has(p.id));
    survey.anchors=survey.anchors.filter(p=>ids.has(p.id));
    survey.relocations=(survey.relocations||[]).filter(p=>ids.has(p.id));
    survey.obstacles.push(...removed.map(({id,...p})=>p));
  }
  const draft={version:1,signature:base.signature,sections,assignments,locks,pairs,sites,
    ...(before.planningMode?{planningMode:true}:{}),...(survey?{survey}:{})};
  P.importDraft(base,draft);
  return {plan,draft,added:placements.filter(p=>!oldByUid.has(p.playerId)).length,
    removed:previous.placements.filter(p=>!power.players.some(current=>current.uid===String(p.playerId))).length};
}

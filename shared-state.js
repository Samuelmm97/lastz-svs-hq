/* Shared current observations. Proposed placement coordinates never enter this feed. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.LastZSharedState=api;})(globalThis,function(){
  const normal=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]/gu,'');
  function index(power,positions){
    if(power?.schemaVersion!==1||power.state!==798||!Array.isArray(power.players))throw Error('Invalid shared power source');
    const byUid=new Map(),byId=new Map(),byName=new Map();
    for(const p of power.players){if(byUid.has(p.uid))throw Error('Duplicate shared player ID');byUid.set(p.uid,p);const key=p.tag+'|'+normal(p.name);byName.set(key,[...(byName.get(key)||[]),p]);}
    const points=new Map();for(const p of positions){byId.set(p.id,p);if(p.playerId&&p.identity_alias_of==null){const uid=String(p.playerId),old=points.get(uid);if(!old||String(p.observed_at_utc||p.observed_date||'')>String(old.observed_at_utc||old.observed_date||''))points.set(uid,p);}}
    return {power,positions,byUid,byId,byName,points};
  }
  async function load(base){const url=base.replace(/\/$/,'');const h=typeof globalThis.readHeaders==='function'?globalThis.readHeaders():{};const responses=await Promise.all([fetch(url+'/data/power-current.json',{cache:'no-store',headers:h}),fetch(url+'/data/hqs.json',{cache:'no-store',headers:h})]);if(responses.some(r=>!r.ok))throw Error('Shared state data is unavailable');const data=index(await responses[0].json(),await responses[1].json());data.fingerprint=responses.map(r=>r.headers.get('etag')||r.headers.get('last-modified')||'').join('|');return data;}
  function identity(p,data){const id=p.playerId||p.uid||data.byId.get(p.id)?.playerId;if(id)return String(id);return null;}
  function enrich(p,data){
    const uid=identity(p,data),power=data.byUid.get(uid),position=data.points.get(uid);
    const names=[p.name,power?.name,position?.name].filter(Boolean);
    const fields={playerId:uid||p.playerId,nameAliases:[...new Set([...(p.nameAliases||[]),...names])],
      totalPower:power?.personalPower?.value??null,heroPower:power?.components?.hero?.value??null,totalPowerApproximate:false,
      powerCaptured:power?.personalPower?.observedAt?.slice(0,10)||null,powerObservedAt:power?.personalPower?.observedAt||null,
      heroPowerCaptured:power?.components?.hero?.observedAt||null,heroPowerMetric:'hero_component_power',
      powerStatus:power?'verified_workbook_player_id':'not_in_current_workbook',powerSourceUrl:data.power.source.url};
    if(power){fields.name=power.name;fields.hq=power.hq;fields.hqCaptured=power.personalPower.observedAt.slice(0,10);}
    if(position){fields.actualX=position.x;fields.actualY=position.y;fields.actualObservedAt=position.observed_at_utc||position.observed_date;fields.actualSource='Field Atlas game-map observations';}
    return {...p,...fields};
  }
  function enrichPlan(plan,data){if(plan.meta?.rosterIdentity==='playerId')return plan;return {...plan,placements:plan.placements.map(p=>enrich(p,data)),meta:{...plan.meta,currentPowerSource:data.power.source}};}
  function enrichState(state,data){for(const [id,p]of state.players)state.players.set(id,enrich(p,data));state.sharedPowerSource=data.power.source;}
  function applyAtlas(records,data){
    const players={};
    for(const p of data.power.players){const location=data.points.get(p.uid);players[p.uid]={name:p.name,tag:p.tag,display:`[${p.tag}] ${p.name}`,playerId:p.uid,
      ...(location?{atlas_id:location.id,atlas:{name:p.name,hq:p.hq,x:location.x,y:location.y,zone:location.zone}}:{}),
      personal_power:{value:p.personalPower.value,rank:null,source:'authoritative_workbook',data_date:p.personalPower.observedAt.slice(0,10)},
      ...(p.components?.hero?{hero_component_power:{value:p.components.hero.value,rank:null,source:'authoritative_workbook',data_date:p.components.hero.observedAt.slice(0,10)}}:{})};}
    for(const p of records){const uid=identity(p,data),member=data.byUid.get(uid);p.power=players[uid]||null;
      if(member&&p.playerId){p.name=member.name;p.roster_current=true;p.roster_observed_date=data.power.source.observedAt.slice(0,10);}
      if(!p.playerId&&p.current===false)p.roster_current=false;
    }
    const alliances=Object.fromEntries(data.power.alliances.map(p=>[p.tag,{tag:p.tag,display:`[${p.tag}]${p.name}`,allianceId:p.uid,alliance_power:{value:p.power.value,rank:p.rank,data_date:p.power.observedAt.slice(0,10),source:'authoritative_workbook'}}]));
    return {players,alliances,captured_date:data.power.source.observedAt.slice(0,10),source:data.power.source,
      warnings:['Current power comes from the States 792–815 workbook. Hero component observations retain their separate dates.']};
  }
  return {index,load,identity,enrich,enrichPlan,enrichState,applyAtlas};
});

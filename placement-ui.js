const $ = id => document.getElementById(id);
const P = PlacementPlanner;
const canvas = $('map'), ctx = canvas.getContext('2d');
const apiUrl = globalThis.PLACEMENT_API_URL || '';
let sharedSource=null;
let allianceRoster=null;
let sharedSourceError=false;
const palette = { mud: '#efb86b', grass: '#7ad7c0', outside: '#abb0f5', stray: '#c9d4da',
  risk: '#ef6f77', absent: '#f3b65e', unknown: '#abb0f5', team: '#f9e37e' };
// Zoom threshold for HQ name labels: once a tile is this many screen pixels wide there is room to
// write a name and HQ level beside the dot without burying the map in text.
const LABEL_PX_PER_TILE = 9;
let hqLabels = [], hqInfoId = null, areaLabelBoxes = [];
// Touch gestures: one finger pans (the drag below), two fingers pinch-zoom around their midpoint.
let pointers = new Map(), pinch = null;
let plan, state, visible = [], selectedId = null, targetKey = null, pendingStrike = null;
let revision = 0, editorKey = '', busy = false, scale = 1, panX = 0, panY = 0, drag = null, lastPointer = null;
let historyEntries = [], selectedHistory = null;
let copyMessages = [], copyIndex = 0, copyFingerprint = '';
let layoutPreview = null;
let pendingDrop = null;
let rosterPlacing=false,rosterDragId=null;
if(innerWidth<=800)$('mapRoster').open=false;
let lastMoveGaps=[],shownGaps=[];
let openingCache=null;
let defenceCache=null;
let lastSimulatedId=null;
function currentDefence(){
  const openings=existingOpenings(),fingerprint=openingCache?.fingerprint;
  if(defenceCache?.fingerprint!==fingerprint)defenceCache={fingerprint,report:P.defenceReport(state,$('section').value)};
  return defenceCache.report;
}
function existingOpenings(){
  if(!state)return [];
  const fingerprint=state.signature+'|'+$('section').value+'|'+JSON.stringify(state.sections[$('section').value])+'|'+JSON.stringify(state.survey?.obstacles)+'|'+[...state.assignments].map(([id,key])=>`${id}@${key}`).join('|');
  if(openingCache?.fingerprint!==fingerprint)openingCache={fingerprint,sites:P.teleportOpenings(state,$('section').value)};
  return openingCache.sites;
}
let copiedParts = new Set();
const editMode = new URLSearchParams(location.search).get('edit') === '1';
document.body.classList.toggle('editing', editMode);
$('modeLink').textContent = editMode ? 'View plan' : 'Edit plan';
$('modeLink').href = editMode ? 'placement.html' : 'placement.html?edit=1';
$('mapMode').textContent = editMode ? 'Editor workspace' : 'Shared team plan';
let boundaryHandles = [];
const sectionColor = tag => `hsl(${[...tag].reduce((n,c) => (n*31+c.charCodeAt(0))%360,0)} 65% 70%)`;
const normalDegrees = angle => ((angle%360)+360)%360;
function syncBoundary() {
  if (!state) return;
  const area = state.sections[$('section').value];
  $('grassOnly').checked=area?.grassOnly??true;
  $('grassCompact').checked=area?.grassCompact??($('section').value==='Helm');
  $('defencePacking').checked=area?.defencePacking??false;
  $('frontLayers').value=area?.frontLayers??1;
  $('bodyGap').value=area?.bodyGap??1;
  if (area) {
    const difference = (area.end-area.start)*180/Math.PI;
    const width = Math.abs(difference)>=360 ? 360 : normalDegrees(difference);
    $('wedgeStart').value = width===360 ? 0 : normalDegrees(area.start*180/Math.PI);
    $('wedgeEnd').value = width===360 ? 360 : normalDegrees(area.end*180/Math.PI);
    $('boundaryCenter').value = Math.round(normalDegrees(area.start*180/Math.PI+width/2));
    $('boundaryWidth').value = Math.round(width);
  } else {
    $('wedgeStart').value=0;$('wedgeEnd').value=360;
    $('boundaryCenter').value=0;$('boundaryWidth').value=360;
  }
  renderCapacity();
}
function renderCapacity() {
  if (!state) return;
  const b=bounds(), counts={mud:0,grass:0};
  for (const site of state.sites.values()) if (P.inWedge(site,b.start,b.end)) counts[site.zone]++;
  $('areaCapacity').textContent = `${counts.mud} mud spots · ${counts.grass} grass spots in this area`;
  const report=P.areaReport(state,$('section').value);
  $('wedgeHealth').textContent=report ? `${report.members} members in this shared area · ${report.grassOutside} grass outside wedge · ${report.waiting} waiting`+
    (report.lockedOutside?` · ${report.lockedOutside} fixed outside the wedge`:'') : 'Choose an alliance to adjust its layout.';
}
function areaRules(){return {grassOnly:$('grassOnly').checked,grassCompact:$('grassCompact').checked,defencePacking:$('defencePacking').checked,frontLayers:Number($('frontLayers').value),bodyGap:Number($('bodyGap').value)};}
$('helmCorners').onclick=()=>{
  cancelPreview();$('section').value='Helm';syncBoundary();
  const start=270,end=360-Math.atan(.5)*180/Math.PI;
  $('wedgeStart').value=start;$('wedgeEnd').value=end;
  $('boundaryCenter').value=(start+end)/2;$('boundaryWidth').value=end-start;
  $('grassOnly').checked=true;$('grassCompact').checked=true;
  message('Helm area: west hex corner to northwest hex corner. Preview the layout to review changes.');render();
};
function cancelPreview(){
  if(!layoutPreview)return;
  P.importDraft(state,layoutPreview.before);layoutPreview=null;
  $('layoutPreview').hidden=true;$('mapMode').textContent='Editor workspace';render();
}

function message(value) { $('status').textContent = value; }
// Alliance tags drawn across the wedges are clickable: they filter the map to that alliance's members.
function allianceLabelAt(x, y, pointerType) {
  const pad = pointerType === 'touch' ? 10 : 2;
  for (let i = areaLabelBoxes.length - 1; i >= 0; i--) {
    const box = areaLabelBoxes[i].box;
    if (x >= box.x - pad && x <= box.x + box.width + pad && y >= box.y - pad && y <= box.y + box.height + pad) return areaLabelBoxes[i];
  }
  return null;
}
function toggleSectionFilter({section, label}) {
  const select = $('section');
  const clearing = select.value === section;
  select.value = clearing ? '' : section;
  cancelPreview(); targetKey = null; hqInfoId = null; hideHqInfo(); syncBoundary(); render();
  if (clearing) { message(`Showing every HQ again (${state.players.size} players). Click any alliance tag to filter.`); return; }
  // A tag can cover a group of alliances (twins share a wedge); they are filtered one at a time, so
  // say which one this is and name the others.
  const area = state.sections[section] || {}, group = area.group || section;
  const others = Object.entries(state.sections).filter(([key, val]) => val && (val.group || key) === group && key !== section).map(([key]) => key);
  message(`Showing ${select.options[select.selectedIndex].textContent} — the tag "${label}" covers ${others.length ? `${others.join(' and ')}, listed separately` : 'only this alliance'}. Click the tag again to clear.`);
}
function showCopyPart() {
  const multiple = copyMessages.length > 1;
  $('copyParts').hidden = !multiple;
  $('nextCopyPart').hidden = !multiple;
  $('nextCopyPart').disabled = copyIndex >= copyMessages.length - 1;
  $('copyList').disabled = !copyMessages.length;
  $('copyList').textContent = multiple ? `Copy part ${copyIndex + 1} of ${copyMessages.length}` : 'Copy list';
  $('placementText').value = copyMessages[copyIndex]?.text || '';
  $('copyPart').replaceChildren();
  copyMessages.forEach((part, i) => {
    const option = document.createElement('option'); option.value = i;
    option.textContent = `Part ${i + 1} of ${copyMessages.length} - ${part.label} (${part.players})${copiedParts.has(i) ? ' - Copied' : ''}`;
    $('copyPart').append(option);
  });
  $('copyPart').value = String(copyIndex);
  $('copyHint').textContent = `${visible.length.toLocaleString()} players in ${copyMessages.length} ${multiple ? 'messages' : 'message'}. Copy each part and paste it separately.` +
    (copiedParts.size ? ` ${copiedParts.size} of ${copyMessages.length} copied.` : '');
}
function renderCopyMessages() {
  try {
    const parts = PlacementChat.messages(visible, { section: $('section').value, revision,
      afterSwap: $('swapPreview').checked, limit: Number($('copySize').value) });
    const fingerprint = JSON.stringify(parts);
    if (fingerprint !== copyFingerprint) {
      copyMessages = parts; copyFingerprint = fingerprint; copyIndex = 0; copiedParts = new Set();
      $('copyStatus').textContent = '';
      showCopyPart();
    }
  } catch (e) {
    copyMessages = []; copyFingerprint = ''; copyIndex = 0; copiedParts = new Set();
    showCopyPart(); $('copyStatus').textContent = e.message;
  }
}
function usePlan(data) {
  const previousSection = $('section').value;
  plan = sharedSource?LastZSharedState.enrichPlan(data,sharedSource):data;
  $('section').replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = 'All HQs (everyone, incl. unaligned)';
  $('section').append(all);
  for (const tag of Object.keys(data.sections)) {
    const option = document.createElement('option'); option.value = tag;
    option.textContent = tag==='Other' ? `Unaligned / other alliances (${data.sections[tag].players})` : `${tag} (${data.sections[tag].players})`; $('section').append(option);
  }
  if (data.sections[previousSection]) $('section').value = previousSection;
  $('snapshotNote').textContent = sharedSource?`Power: States 792–815 workbook · observed ${new Date(sharedSource.power.source.observedAt).toLocaleString()}. Positions: shared Field Atlas map observations. Proposed coordinates are separate.`:`Power ${data.meta.powerCaptured || data.meta.capturedDate || 'September 2026'} · Prior SvS ${data.meta.eventCaptured || '2026-09-26'}` + (data.meta.refreshProgress ? `. ${data.meta.refreshProgress}` : '');
  if(sharedSourceError)$('snapshotNote').textContent='Shared source unavailable; showing the dated saved snapshot. '+$('snapshotNote').textContent;
  $('explain').textContent = (sharedSource?'Current personal power comes from the States 792–815 workbook; hero component power keeps its own date. Bear’s saved ordering is preserved. ':`Roster/power: ${data.meta.powerCaptured || data.meta.capturedDate || 'September 2026'}. `) +
    `Shield/attendance: previous SvS (${data.meta.eventCaptured || '2026-09-26'}). ` +
    'Saved Bear ordering takes priority. Otherwise mud uses hero component power, then personal power and HQ; grass uses HQ within the previous SvS priority groups. ' +
    'Enable grass inside the wedge to keep all members in their alliance area, including prior no-shows and unshielded players at its back. ' +
    'Lock manual edge placements before filling your area. Strike players stage in grass with paired mud reserves.';
}
function bounds() { return { start: Number($('wedgeStart').value), end: Number($('wedgeEnd').value) }; }
function project(p) {
  const r = canvas.getBoundingClientRect(), base = Math.min(r.width / 260, r.height / 250) * scale;
  const centerX=p.x+(p.zone&&(p.y-500)%2!==0?.5:0);
  return [r.width / 2 + panX + (centerX - 500) * base,
    r.height / 2 + panY + (p.y - 500) * base * .8];
}
function size() {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  draw();
}
function draw() {
  if (!state) return;
  const r = canvas.getBoundingClientRect();
  ctx.fillStyle = '#131e25'; ctx.fillRect(0, 0, r.width, r.height);
  for (const [rad, color] of [[120, '#355944'], [35, '#6b5036'], [18, '#7b3d3d']]) {
    ctx.beginPath();
    const v = [[1, 0], [.5, 1], [-.5, 1], [-1, 0], [-.5, -1], [.5, -1]];
    for (let k = 0; k < 6; k++) {
      const [x, y] = project({ x: 500 + rad * v[k][0], y: 500 + rad * v[k][1] });
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#aebbc088'; ctx.stroke();
  }
  boundaryHandles = [];
  const areaLabels = [];
  const drawnGroups=new Set();
  for (const [tag,area] of Object.entries(state.sections)) {
    if (tag === 'Other') continue;
    const group=area.group||tag;
    if (drawnGroups.has(group)) continue;
    drawnGroups.add(group);
    const selected=$('section').value===tag ||
      (area.group && state.sections[$('section').value]?.group===area.group), color=sectionColor(tag);
    const label=area.label||tag;
    const preview=selected&&editMode ? bounds() : null;
    const start=preview ? preview.start*Math.PI/180 : area.start;
    const difference=preview ? (preview.end-preview.start)*Math.PI/180 : area.end-area.start;
    const width=(difference+2*Math.PI)%(2*Math.PI)||2*Math.PI;
    const center=start+width/2;
    const point=(a,rad) => {
      const x=Math.sin(a),y=-Math.cos(a);
      const ring=Math.max(Math.abs(x-y/2),Math.abs(y),Math.abs(x+y/2));
      return project({x:500+rad*x/ring,y:500+rad*y/ring});
    };
    ctx.beginPath();
    for (let i=0;i<=24;i++) { const [x,y]=point(start+width*i/24,118); if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y); }
    for (let i=24;i>=0;i--) { const [x,y]=point(start+width*i/24,19);ctx.lineTo(x,y); }
    ctx.closePath();ctx.fillStyle=color;ctx.globalAlpha=selected ? .16 : .035;ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle=color;ctx.lineWidth=selected?2:1;ctx.globalAlpha=selected?1:.45;
    for (const a of [start,start+width]) { const [x1,y1]=point(a,19),[x2,y2]=point(a,118);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke(); }
    ctx.globalAlpha=1;
    areaLabels.push({tag:label,section:tag,color,selected,point,center});
    if (selected && editMode) for (const [kind,a] of [['start',start],['end',start+width],['center',center]]) {
      const [x,y]=point(a,115);ctx.beginPath();ctx.arc(x,y,7,0,2*Math.PI);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();
      boundaryHandles.push({kind,x,y});
    }
  }
  const [capitalX,capitalY]=project({x:500,y:500});ctx.textAlign='center';ctx.fillStyle='#f0e0c5';ctx.font='bold 13px system-ui';ctx.fillText('CAPITAL',capitalX,capitalY);
  for(const turret of plan.meta.turrets || []) {
    const radius=turret.minCenterDistance-1;
    ctx.beginPath();
    for(const [k,[dx,dy]] of [[1,0],[.5,1],[-.5,1],[-1,0],[-.5,-1],[.5,-1]].entries()) {
      const [x,y]=project({x:turret.x+radius*dx,y:turret.y+radius*dy});
      if(k)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    }
    ctx.closePath();ctx.fillStyle='#422e29';ctx.fill();ctx.strokeStyle='#dfa66c';ctx.lineWidth=1;ctx.stroke();
    const [x,y]=project(turret);ctx.fillStyle='#f3d2a9';ctx.font='bold 9px system-ui';ctx.fillText(turret.name.replace('Turret ','T'),x,y+3);
  }
  ctx.fillStyle='#c4d6dc';ctx.font='12px system-ui';ctx.fillText('N ↑',26,20);
  const footprint=(p,color,fill,stroke,line)=>{
    const [x,y]=project(p),base=Math.min(r.width/260,r.height/250)*scale;
    for(const [dx,dy] of [[0,0],[1,0],[.5,1],[-.5,1],[-1,0],[-.5,-1],[.5,-1]]) {
      ctx.beginPath();
      for(const [i,[vx,vy]] of [[.5,1/3],[0,2/3],[-.5,1/3],[-.5,-1/3],[0,-2/3],[.5,-1/3]].entries()) {
        const px=x+(dx+vx)*base,py=y+(dy+vy)*base*.8;
        if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);
      }
      ctx.closePath();ctx.fillStyle=color;ctx.globalAlpha=fill;ctx.fill();ctx.globalAlpha=stroke;ctx.strokeStyle=color;ctx.lineWidth=line;ctx.stroke();ctx.globalAlpha=1;
    }
  };
  if($('section').value) {
    const all=P.rows(state),members=all.filter(p=>p.zone!=='unassigned'&&p.section===$('section').value),shown=new Set(visible.map(p=>p.id));
    for(const p of all)if(p.zone!=='unassigned'&&!shown.has(p.id)&&members.some(b=>P.distance(p,b)<=6)) {
      const [x,y]=project(p);ctx.beginPath();ctx.arc(x,y,Math.max(2,2.5*scale**.3),0,Math.PI*2);
      ctx.fillStyle='#d3e1e1';ctx.globalAlpha=.4;ctx.fill();ctx.globalAlpha=1;
    }
  }
  for (const p of visible) {
    if (p.zone === 'unassigned') continue;
    const [x, y] = project(p);
    if($('simulateDestroyed').checked&&p.id===selectedId){
      footprint(p,palette.risk,.08,.7,1);ctx.strokeStyle=palette.risk;ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(x-6,y-6);ctx.lineTo(x+6,y+6);ctx.moveTo(x+6,y-6);ctx.lineTo(x-6,y+6);ctx.stroke();continue;
    }
    const color=p.role ? palette.team : P.isUnaligned(p) ? palette.stray : p.highRisk ? palette.risk : p.attendanceProxy==='outside_capital_area' ? palette.absent : p.attendanceProxy==='unknown' ? palette.unknown : sectionColor(p.section);
    if(scale>=2)footprint(p,color,.3,.7,.6);
    ctx.beginPath(); ctx.arc(x, y, p.id === selectedId ? 5 : Math.max(2, 2.5 * scale ** .3), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (p.locked) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
    if(p.placedInGame){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.strokeRect(x-4,y-4,8,8);}
  }
  for(const p of state.survey?.obstacles||[]) {
    const [x,y]=project({...p,zone:'grass'});if(scale>=2)footprint({...p,zone:'grass'},'#d3e1e1',.35,.8,.7);
    ctx.fillStyle=p.tag?sectionColor(Object.keys(state.sections).find(tag=>tag.toLowerCase()===p.tag.toLowerCase())||p.tag):'#d3e1e1';ctx.fillRect(x-3,y-3,6,6);
    ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(x-4,y-4,8,8);
  }
  const highlights = [[targetKey, '#fff'],
    [selectedId != null && P.current(state,selectedId)?.zone !== 'unassigned' ? P.siteKey(P.current(state, selectedId)) : null, '#ffdf73']];
  for (const [key, color] of highlights) {
    const s = key && state.sites.get(key); if (!s) continue;
    const [x, y] = project(s);
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  }
  const gaps=[...shownGaps];
  for(const s of existingOpenings())if(($('showEdges').checked||s.insideFormation)&&gaps.every(b=>P.distance(s,b)>=3))gaps.push(s);
  if($('showGaps').checked)for(const gap of gaps) {
    footprint(gap,'#ffb347',.15,1,1.2);
    if(scale>=2){const [x,y]=project(gap);ctx.fillStyle='#ffcf85';ctx.font='bold 10px system-ui';ctx.fillText(gap.insideFormation===false?'EDGE':'GAP',x,y-8);}
  }
  if (drag && drag.hq != null && drag.moved && drag.tile) {
    const status = drag.status || (drag.error ? 'bad' : 'ok');
    const tone = status === 'ok' ? '#7ee787' : status === 'gap' ? '#ffb347' : status === 'choice' ? '#8ab4ff' : '#f3858f';
    const t = drag.tile, target = { x: t.x, y: t.y, zone: t.zone || 'grass' };
    const [tx, ty] = project(target), from = drag.origin && state.sites.get(drag.origin);
    if (from) {
      const [fx, fy] = project(from);
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = tone; ctx.lineWidth = 2; ctx.globalAlpha = .9;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.restore();
    }
    footprint(target, tone, t.zone ? .3 : .14, 1.1, 2.5);
    ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI * 2); ctx.strokeStyle = tone; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(tx, ty, 3.5, 0, Math.PI * 2); ctx.fillStyle = tone; ctx.fill();
    const mover = state.players.get(drag.hq);
    if (mover) {
      const label = t.zone ? `${mover.name} \u2192 ${t.x}, ${t.y}` : `${t.x}, ${t.y} is not a buildable tile`;
      ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
      const w = ctx.measureText(label).width + 14, lx = Math.max(4, Math.min(r.width - w - 4, tx - w / 2)), ly = ty + 14;
      ctx.fillStyle = '#101a20ee'; ctx.fillRect(lx, ly, w, 19);
      ctx.strokeStyle = tone; ctx.lineWidth = 1; ctx.strokeRect(lx, ly, w, 19);
      ctx.fillStyle = tone; ctx.fillText(label, lx + w / 2, ly + 13.5);
      ctx.textAlign = 'left';
    }
  }
  if($('simulateDestroyed').checked&&selectedId!=null){
    const removal=currentDefence().removals.find(r=>r.id===selectedId);
    for(const p of removal?.newLandings||[])footprint(p,palette.risk,.18,.85,1);
    for(const p of removal?.pair||[])footprint(p,palette.risk,.3,1,2);
  }
  const labelBoxes=[];
  // Zoomed in far enough, write each HQ's player name and HQ level beside its dot: the HQ level to
  // compare players at a glance, the name to find someone. Nearest the middle of the viewport wins
  // a label first (that is the HQ being looked at), then the selected one; a label that would
  // collide with one already placed is skipped, so the map stays readable instead of a wall of text.
  // This runs before the wedge labels so a name is never pushed aside by an alliance tag.
  hqLabels = [];
  const tilePixels = Math.min(r.width / 260, r.height / 250) * scale;
  if (tilePixels >= LABEL_PX_PER_TILE) {
    const centerX = r.width / 2, centerY = r.height / 2;
    const order = visible.filter(p => p.zone !== 'unassigned').map(p => {
      const [x, y] = project(p);
      return { p, x, y, distance: Math.hypot(x - centerX, y - centerY) };
    }).filter(o => o.x > -220 && o.y > -24 && o.x < r.width + 220 && o.y < r.height + 24)
      .sort((a,b) => Number(b.p.id === selectedId) - Number(a.p.id === selectedId) || a.distance - b.distance);
    for (const { p, x, y } of order) {
      const name = p.name.length > 20 ? p.name.slice(0, 19) + '…' : p.name;
      const level = `HQ ${p.hq ?? '?'}`;
      ctx.font = '11px system-ui';
      const nameWidth = ctx.measureText(name).width;
      ctx.font = 'bold 11px system-ui';
      const levelWidth = ctx.measureText(level).width;
      const width = nameWidth + 7 + levelWidth + 8;
      const box = { x: x + 6, y: y - 8, width, height: 16 };
      if (box.x + box.width > r.width - 4) box.x = x - 6 - box.width;      // flip to the left of the dot
      box.x = Math.max(2, Math.min(r.width - box.width - 2, box.x));
      box.y = Math.max(2, Math.min(r.height - box.height - 2, box.y));
      if (labelBoxes.some(b => box.x < b.x + b.width + 3 && b.x < box.x + box.width + 3 &&
        box.y < b.y + b.height + 3 && b.y < box.y + box.height + 3)) continue;
      labelBoxes.push(box);
      hqLabels.push({ id: p.id, name: p.name, hq: p.hq, x, y, box });
      // A chip behind every label: in the dense mud rows a neighbouring dot would otherwise show
      // through the text and make it unclear which HQ a label belongs to.
      const selected = p.id === selectedId;
      ctx.fillStyle = selected ? '#101a20f2' : '#0e1a20d9';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      if (selected) { ctx.strokeStyle = '#ffdf73'; ctx.lineWidth = 1; ctx.strokeRect(box.x + .5, box.y + .5, box.width - 1, box.height - 1); }
      ctx.textAlign = 'left';
      ctx.font = '11px system-ui';
      ctx.fillStyle = '#f2f7f9'; ctx.fillText(name, box.x + 4, box.y + 12);
      ctx.font = 'bold 11px system-ui';
      ctx.fillStyle = '#ffcf85'; ctx.fillText(level, box.x + 4 + nameWidth + 7, box.y + 12);
      ctx.font = '11px system-ui';
    }
  }
  areaLabelBoxes = [];
  for (const {tag,section,color,selected,point,center} of areaLabels.sort((a,b)=>Number(b.selected)-Number(a.selected))) {
    ctx.font=`${selected?'bold 13':'11'}px system-ui`;
    const width=ctx.measureText(tag).width+10,height=20;
    let box;
    for (const radius of [102,86,70,54]) {
      const [x,y]=point(center,radius);
      box={x:Math.max(4,Math.min(r.width-width-4,x-width/2)),y:y-height/2,width,height};
      if (!labelBoxes.some(b=>box.x<b.x+b.width+3&&box.x+width+3>b.x&&box.y<b.y+b.height+3&&box.y+height+3>b.y)) break;
    }
    labelBoxes.push(box);
    areaLabelBoxes.push({section,label:tag,box});   // kept so a click can filter to this alliance
    ctx.fillStyle='#131e25';ctx.globalAlpha=.92;ctx.fillRect(box.x,box.y,width,height);ctx.globalAlpha=1;
    ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(tag,box.x+width/2,box.y+14);
  }
}
// The captured Sheet alliance list is ordered by alliance power rank.
function allianceRank(tag) {
  const index=allianceRoster?.alliances.findIndex(a=>a.tag.toLowerCase()===tag.toLowerCase())??-1;
  return index<0?Infinity:(allianceRoster.alliances[index].rank||index+1);
}
function rankedAllianceTags(tags) {
  return [...tags].sort((a,b)=>Number(a==='Other')-Number(b==='Other')||allianceRank(a)-allianceRank(b)||a.localeCompare(b));
}
function rankedAllianceLabel(tag) {
  const rank=allianceRank(tag);return Number.isFinite(rank)?`#${rank} ${tag}`:tag;
}
function syncAllianceOptions() {
  const tags=rankedAllianceTags(Object.keys(state.sections)),select=$('section');
  if(JSON.stringify([...select.options].slice(1).map(o=>o.value))===JSON.stringify(tags))return;
  const previous=select.value;select.replaceChildren(new Option('All HQs (everyone, incl. unaligned)',''));
  for(const tag of tags)select.add(new Option(tag,tag));
  select.value=Object.hasOwn(state.sections,previous)?previous:'';
}
function renderAllianceManager() {
  const select=$('allianceChoice'),previous=select.value;
  const entries=[...(allianceRoster?.alliances||[])].sort((a,b)=>allianceRank(a.tag)-allianceRank(b.tag)).filter(a=>!Object.keys(state.sections).some(t=>t.toLowerCase()===a.tag.toLowerCase()));
  select.replaceChildren(new Option('Choose an alliance from the sheet',''));
  for(const a of entries){
    const count=[...state.players.values()].filter(p=>(p.tag||'').toLowerCase()===a.tag.toLowerCase()).length;
    select.add(new Option(`${rankedAllianceLabel(a.tag)} · ${a.name} · ${count} in planner / ${a.members} captured`,a.tag));
  }
  if(entries.some(a=>a.tag===previous))select.value=previous;
  $('allianceSource').textContent=allianceRoster?`${allianceRoster.alliances.length} State 798 alliances · captured ${new Date(allianceRoster.source.observedAt).toLocaleString()}. Adding a zone includes matching players already in this planner; it does not import new people.`:'Sheet alliance list unavailable. You can still enter a custom tag.';
  const disabled=!editorKey||busy||!!layoutPreview;
  $('addAlliance').disabled=disabled;
  const removal=$('removeAllianceChoice'),prior=removal.value;
  removal.replaceChildren(new Option('Choose a saved zone to remove',''));
  for(const tag of rankedAllianceTags(Object.keys(state.sections).filter(t=>t!=='Other'))){
    const count=[...state.players.values()].filter(p=>p.section===tag).length;
    const inSheet=allianceRoster?.alliances.some(a=>a.tag.toLowerCase()===tag.toLowerCase());
    removal.add(new Option(`${rankedAllianceLabel(tag)} · ${count} players${allianceRoster&&!inSheet?' · not in current Sheet':''}`,tag));
  }
  removal.value=Object.hasOwn(state.sections,prior)&&prior!=='Other'?prior:($('section').value==='Other'?'':$('section').value);
  $('removeAlliance').disabled=disabled||!removal.value;
  $('refreshMemberships').disabled=disabled||!allianceRoster;
  $('allianceActionStatus').textContent=!editorKey?'Enable editing in Editor access to manage alliances.':busy?'Saving alliance changes…':layoutPreview?'Apply or cancel the preview before managing alliances.':'';
}
function render() {
  if(!state)return;
  syncAllianceOptions();renderAllianceManager();
  const memberCounts=new Map();for(const p of state.players.values())memberCounts.set(p.section,(memberCounts.get(p.section)||0)+1);
  for(const option of $('section').options)if(option.value){
    const count=memberCounts.get(option.value)||0;
    option.textContent=option.value==='Other'?`Unaligned / other alliances (${count})`:`${rankedAllianceLabel(option.value)} (${count})`;
  }
  if (!state) return;
  const after = $('swapPreview').checked, q = $('search').value.toLocaleLowerCase();
  const section = $('section').value, zone = $('zone').value;
  visible = P.rows(state, after).filter(p =>
    (!q || `${p.name} ${p.tag} ${p.id} ${(p.nameAliases||[]).join(' ')}`.toLocaleLowerCase().includes(q)) &&
    (!section || p.section === section) && (!zone || (zone==='rear' ? P.rearReasons(p).length>0 : p.zone === zone)));
  renderCopyMessages();
  if (selectedId != null && !visible.some(p => p.id === selectedId)) {selectedId = null;rosterPlacing=false;}
  renderMapRoster();
  if (hqInfoId != null && !visible.some(p => p.id === hqInfoId)) hideHqInfo();
  $('summary').textContent = `${visible.length.toLocaleString()} of ${state.players.size.toLocaleString()} HQs shown` +
    (visible.length===state.players.size ? ' (every player, filtered by nothing)' : '') +
    ` · ${[...state.players.values()].filter(P.isUnaligned).length.toLocaleString()} unaligned kept at the back · ` +
    `version ${revision}` +
    (after ? ' · POST-SWAP PREVIEW' : '');
  const allPlayers=[...state.players.values()];
  const attended=allPlayers.filter(p=>p.attendanceProxy==='inside_capital_area').length;
  const unknown=allPlayers.filter(p=>p.attendanceProxy==='unknown').length;
  const rear=allPlayers.filter(p=>P.rearReasons(p).length).length;
  const unshieldedAttendees=allPlayers.filter(p=>p.attendanceProxy==='inside_capital_area'&&p.highRisk).length;
  $('attendanceSummary').textContent = `All alliances: ${(allPlayers.length-rear).toLocaleString()} front priority · ${rear.toLocaleString()} back priority. ` +
    (plan.meta.priorCapitalSnapshotCount ? `The old scan recorded ${plan.meta.priorCapitalSnapshotCount.toLocaleString()} at the capital; ${attended.toLocaleString()} match this roster, including ${unshieldedAttendees} unshielded players kept in back. ` : '')+
    `${unknown.toLocaleString()} players have unknown attendance and receive no back penalty for a missing record.`;
  const body = $('rows'); body.replaceChildren();
  for (const p of visible.slice(0, 500)) {
    const tr = document.createElement('tr');
    if (p.id === selectedId) tr.className = 'active';
    for (const value of [p.hq, `${p.locked ? '🔒 ' : ''}${p.name}${p.role ? ' · ' + p.role : ''}`,
      p.tag || '—', p.zone === 'unassigned' ? 'Waiting' : `${p.x}, ${p.y}`]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    if (P.rearReasons(p).length) {
      const note=document.createElement('span');note.className='rear-note';
      note.textContent='Back priority · '+P.rearReasons(p).join('; ');
      tr.children[1].append(note);
    }
    if (p.attendanceProxy==='unknown') {
      const note=document.createElement('span');note.className='unknown-note';note.textContent='Attendance unknown';
      tr.children[1].append(note);
    }
    if(p.placementEligible===false){const note=document.createElement('span');note.className='unknown-note';note.textContent='Identity unconfirmed · unavailable for placement';tr.children[1].append(note);}
    tr.onclick = () => { selectedId = p.id; targetKey=null; $('mapAction').value='place'; hideHqInfo(); render(); };
    body.append(tr);
  }
  $('listNote').textContent = visible.length > 500 ? 'Showing the first 500 players. Choose an alliance or search a name to narrow the list.' : '';
  $('planningMode').checked=state.planningMode===true;
  $('planningStatus').textContent=state.planningMode?'Draft planning: temporary teleport gaps are allowed. Turn this off to validate the finished formation.':'Gap enforcement is active for alliances with footprint blocking enabled.';
  $('waitingCount').textContent = P.rows(state).filter(p => p.zone === 'unassigned'&&p.placementEligible!==false).length;
  $('surveyNote').textContent=state.survey?`In-game map observed ${new Date(state.survey.capturedAt).toLocaleString()}. White squares mark ${P.rows(state).filter(p=>p.placedInGame).length} fixed roster HQs and ${state.survey.obstacles.length} additional occupied HQs. ${state.survey.relocations?.length||0} observed HQs outside the held areas can relocate to their proposed positions. Positions can change after the scan.`:'';
  $('surveyDetails').hidden=!state.survey;
  $('surveyExtraList').replaceChildren();
  if(state.survey){
    const extras=state.survey.obstacles.filter(p=>!$('section').value||p.tag.toLowerCase()===$('section').value.toLowerCase());
    $('surveyExtraNote').textContent=`${extras.length} observed HQs outside the proposal roster in this view. Their occupied positions stay fixed.`;
    for(const p of extras){const line=document.createElement('p');line.textContent=`${p.tag||'No alliance'} · ${p.name} · X ${p.x}, Y ${p.y}`;$('surveyExtraList').append(line);}
  }
  const chosen = selectedId != null && P.current(state, selectedId);
  $('selectedPlayer').replaceChildren();
  if (chosen) {
    const lines = [['strong','',`${chosen.name} · HQ ${chosen.hq}`],
      ['span','coordinates',chosen.zone==='unassigned' ? 'Waiting for a spot' : `X ${chosen.x} · Y ${chosen.y}`],
      ['span','detail',`${chosen.tag || 'No alliance'} · ${chosen.zone === 'unassigned' ? 'Unassigned' : chosen.zone === 'mud' ? 'Mud front' : P.rearReasons(chosen).length && !chosen.locked ? 'Back grass' : 'Grass support'}${chosen.locked ? ' · Reserved' : ''}`],
      ['span','detail',`${chosen.heroPowerMetric==='hero_component_power'?'Hero component':'Hero power'} ${chosen.heroPower?.toLocaleString() || 'unknown'} · Total power ${chosen.totalPowerApproximate ? '≈ ' : ''}${chosen.totalPower?.toLocaleString() || 'unknown'}`]];
    if(chosen.powerObservedAt)lines.push(['span','detail',`Personal power observed ${new Date(chosen.powerObservedAt).toLocaleString()}${chosen.heroPowerCaptured?` · Hero component ${new Date(chosen.heroPowerCaptured).toLocaleDateString()}`:''}`]);
    if(Number.isFinite(chosen.actualX)&&Number.isFinite(chosen.actualY))lines.push(['span','detail',`Shared map observation: X ${chosen.actualX}, Y ${chosen.actualY} · ${chosen.actualObservedAt||'date unknown'}.`]);
    if (chosen.totalPowerApproximate) lines.push(['span','detail','Total power is a rounded reading from the alliance roster.']);
    if (chosen.nameReadingStatus==='partial') lines.push(['span','detail','Name partly unreadable; check the saved roster card.']);
    if(chosen.placementEligible===false)lines.push(['span','detail','Identity unconfirmed in the current roster. Retained for review; excluded from automatic placement.']);
    if(chosen.placedInGame)lines.push(['span','detail',`Already placed in game · ${new Date(chosen.observedAt*1000).toLocaleString()}. Fixed during replanning.`]);
    if(chosen.relocatingInGame)lines.push(['span','detail',`Observed in game at X ${chosen.observedX}, Y ${chosen.observedY}. The coordinates above are the proposed relocation.`]);
    if (P.rearReasons(chosen).length) lines.push(['span','detail rear-note',
      `${chosen.locked?'Prior SvS (manual reservation overrides automatic placement)':'Why back grass'}: ${P.rearReasons(chosen).join('; ')} · ${plan.meta.eventCaptured || '2026-09-26'}.`]);
    if (chosen.attendanceProxy==='unknown') lines.push(['span','detail unknown-note',
      'Prior SvS attendance unknown: no matched historical record. No back penalty for unknown attendance.']);
    for (const [tag,cl,text] of lines) { const el=document.createElement(tag);el.className=cl;el.textContent=text;$('selectedPlayer').append(el); }
    if (chosen.rosterPhoto) {
      const link=document.createElement('a');link.textContent='View roster card';
      // The atlas is gated now, so the card is fetched through this site's own
      // Worker proxy; the read code travels as a query parameter (it is already
      // in this page's localStorage) rather than the atlas service key.
      const code=globalThis.readKey ? readKey() : '';
      link.href=`${apiUrl}/api/atlas/${chosen.rosterPhoto}${code?`?key=${encodeURIComponent(code)}`:''}`;
      link.target='_blank';link.rel='noopener';$('selectedPlayer').append(link);
    }
  } else $('selectedPlayer').textContent = 'Choose a player to see their coordinates.';
  const target = targetKey && state.sites.get(targetKey), holder = target && P.playerAt(state, targetKey);
  $('targetInfo').textContent = target ? `Target: ${target.zone.toUpperCase()} X ${target.x}, Y ${target.y}` +
    `${target.spot ? ' · mud spot #' + target.spot : ''} · ${holder == null ? 'Open spot' : 'held by '+state.players.get(holder).name}` +
    `${state.locks.has(holder) ? ' (locked)' : ''}` : 'Click a map dot or enter a legal site’s X/Y.';
  let hint='Select a player, then choose a target tile.',valid=false;
  shownGaps=lastMoveGaps;
  if(chosen&&target) {
    try {const check=P.checkPlacement(state,selectedId,targetKey);valid=true;
      if(state.assignments.get(selectedId)!==targetKey)shownGaps=P.teleportGaps(state,state.assignments,check.next);
      hint=holder!=null&&holder!==selectedId ? `This swaps with ${state.players.get(holder).name} and reserves ${chosen.name}.` : `Ready to reserve this tile for ${chosen.name}.`;
    } catch(e){hint=e.message;if(e.openings)shownGaps=e.openings;}
  } else if(chosen)hint=`Choose a target tile for ${chosen.name}.`;
  $('placementHint').textContent=hint;
  $('gapWarning').textContent=shownGaps.length ? `Teleport-sized gap${shownGaps.length>1?'s':''} ${chosen&&target&&state.assignments.get(selectedId)!==targetKey?'would open with this move':'opened by the last move'}. Amber outlines mark ${shownGaps.length} possible HQ landing tile${shownGaps.length>1?'s':''}: `+
    shownGaps.slice(0,6).map(s=>`${s.x}, ${s.y}`).join(' · ')+(shownGaps.length>6?' …':'')+'. Close the opening or reserve a replacement there.' : chosen&&target&&valid ? 'This move creates no new teleport-sized gap.' : '';
  $('gapWarning').classList.toggle('has-gap',shownGaps.length>0);
  const currentOpen=existingOpenings();
  const internal=currentOpen.filter(s=>s.insideFormation).length,edges=currentOpen.length-internal;
  $('existingGapInfo').textContent=$('section').value ? `${internal} internal landable tile${internal===1?'':'s'} · ${edges} open-edge landing tile${edges===1?'':'s'}. Open edges are outside the occupied block; use Open edges to inspect them. All alliances and turret buffers are checked.` : 'Choose an alliance to inspect existing teleport openings.';
  const defence=currentDefence(),removal=defence.removals.find(r=>r.id===selectedId);
  $('defenceInfo').textContent=$('section').value?`${defence.gapFree?'PASS: no enemy HQ fits inside the formation.':`FAIL: ${defence.openings.length} landing centers in ${defence.holes?.length||0} connected openings.`} ${defence.vulnerable} HQ losses expose two or more non-overlapping enemy spots.`+($('simulateDestroyed').checked?(removal?` Removing ${removal.name}: ${removal.capacity===2?'at least 2':removal.capacity} new enemy HQ spaces.`:' Select a member to simulate their removal.'):''):'Choose an alliance to run the footprint test.';
  $('defenceInfo').classList.toggle('has-gap',!defence.gapFree);
  $('lockPlayer').disabled=!valid||busy||!!layoutPreview||!editorKey||after;
  $('mapHelp').textContent=editMode ? ($('mapAction').value==='select'?'Drag a name from Players to place onto a tile, or select a name then tap a tile. Drag an HQ onto another tile to move it; drop on a held tile to swap or send the holder to the unplaced list. Drag empty space to pan; scroll or pinch to zoom. Click an alliance tag to show just that alliance.':'Tap a tile to preview placement. Drag an HQ to move it; drop on a held tile to swap or unplace. Drag empty space to pan; scroll or pinch to zoom.') : 'Tap a player or search their name. Drag to pan; scroll or pinch to zoom. Click an alliance tag to show just that alliance.';
  $('pendingStrike').textContent = pendingStrike != null ? `Pending strike: ${state.players.get(pendingStrike).name}` : '';
  const pairs = $('pairs'); pairs.replaceChildren();
  for (const pair of state.pairs) {
    const strike = P.current(state, pair.strike), reserve = P.current(state, pair.reserve);
    const li = document.createElement('li'), remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.onclick = () => mutate(() => P.removePair(state, pair.strike));
    li.textContent = `${strike.name} (grass ${strike.x},${strike.y}) ⇄ ` +
      `${reserve.name} (mud ${reserve.x},${reserve.y})`;
    li.append(remove); pairs.append(li);
  }
  if($('simulateDestroyed').checked&&selectedId!==lastSimulatedId){
    const p=state.sites.get(state.assignments.get(selectedId));
    if(p){scale=8;const r=canvas.getBoundingClientRect(),base=Math.min(r.width/260,r.height/250)*scale;panX=-(p.x+((p.y-500)%2?.5:0)-500)*base;panY=-(p.y-500)*base*.8;}
    lastSimulatedId=selectedId;
  }else if(!$('simulateDestroyed').checked)lastSimulatedId=null;
  draw(); renderCapacity();
}
function changeSummary(changes) {
  const parts = [['added', 'added to roster'], ['removed', 'removed from roster'],
    ['moved', 'moved'], ['locked', 'locked'], ['unlocked', 'unlocked'],
    ['paired', 'paired'], ['unpaired', 'unpaired'], ['boundaries', 'alliance areas changed'], ['removedAlliances','alliance zones removed'], ['allianceMemberships','alliance memberships updated']]
    .filter(([key]) => changes[key]?.length)
    .map(([key, label]) => `${changes[key].length} ${label}`);
  return parts.join(' · ') || 'No placement changes';
}
function renderHistoryList() {
  const list = $('historyList'); list.replaceChildren();
  for (const entry of historyEntries) {
    const li = document.createElement('li'), button = document.createElement('button');
    const action = entry.action === 'restore' ? `restored revision ${entry.sourceRevision}`
      : entry.action === 'baseline' ? 'history begins here' : entry.action === 'atlas_refresh' ? 'atlas and roster refreshed' : changeSummary(entry.changes);
    li.append(document.createTextNode(`Revision ${entry.revision} · ${new Date(entry.updatedAt).toLocaleString()} · ` +
      `${entry.updatedBy} · ${action}`));
    button.textContent = 'View'; button.onclick = () => showHistory(entry.revision);
    li.append(button); list.append(li);
  }
  $('moreHistory').hidden = !historyEntries.length || !$('moreHistory').dataset.hasMore;
}
function renderMapRoster(){
  if(!editMode)return;
  $('rosterSearch').value=$('search').value;
  $('rosterAlliance').replaceChildren(...[...$('section').options].map(o=>new Option(o.textContent,o.value)));
  $('rosterAlliance').value=$('section').value;
  $('rosterWaiting').checked=$('zone').value==='unassigned';
  const review=visible.filter(p=>p.placementEligible===false);
  $('rosterReview').hidden=!review.length;
  $('rosterReviewTitle').textContent='Unconfirmed roster records ('+review.length+')';
  $('rosterReviewPlayers').replaceChildren(...review.map(p=>{const row=document.createElement('p');row.textContent=p.name+' · '+(p.tag||'Unaligned')+' · Identity unconfirmed';return row;}));
  const players=visible.filter(p=>p.placementEligible!==false).sort((a,b)=>(a.zone!=='unassigned')-(b.zone!=='unassigned')||a.name.localeCompare(b.name));
  $('rosterCount').textContent='('+players.length+')';
  $('rosterSelection').textContent=rosterPlacing&&state.players.has(selectedId)?'Placing '+state.players.get(selectedId).name+' — tap a tile.':'';
  $('rosterCancel').hidden=!rosterPlacing;
  const toolbar=document.querySelector('.map-toolbar');
  $('mapRoster').style.top=(toolbar.offsetTop+toolbar.offsetHeight+8)+'px';
  const list=$('rosterPlayers');list.replaceChildren();
  if(!players.length){list.textContent=review.length?'No placeable players match. See unconfirmed records below.':'No players match these filters.';return;}
  for(const p of players.slice(0,500)){
    const button=document.createElement('button');button.className='roster-player';button.dataset.playerId=p.id;
    button.textContent=p.name;button.setAttribute('aria-pressed',String(p.id===selectedId));
    const info=document.createElement('small');info.textContent=(p.tag||'Unaligned')+' · HQ '+p.hq+' · '+(p.zone==='unassigned'?'Waiting':p.x+', '+p.y)+(p.locked?' · Reserved':'');button.append(info);
    button.disabled=busy||!!layoutPreview||$('swapPreview').checked||!editorKey;button.draggable=!button.disabled;
    button.onclick=()=>{selectedId=p.id;targetKey=null;rosterPlacing=true;$('mapAction').value='place';hideHqInfo();render();message('Choose a tile for '+p.name+'.');if(innerWidth<=800)$('mapRoster').open=false;};
    button.ondragstart=e=>{rosterDragId=p.id;e.dataTransfer.setData('text/plain',String(p.id));e.dataTransfer.effectAllowed='move';};
    button.ondragend=()=>{rosterDragId=null;hideDragChip();};list.append(button);
  }
  if(players.length>500){const note=document.createElement('p');note.textContent='First 500 players shown. Choose an alliance or search to narrow the list.';list.append(note);}
}
$('rosterSearch').oninput=()=>{$('search').value=$('rosterSearch').value;render();};
$('rosterAlliance').onchange=()=>{$('section').value=$('rosterAlliance').value;$('section').dispatchEvent(new Event('change'));};
$('rosterWaiting').onchange=()=>{$('zone').value=$('rosterWaiting').checked?'unassigned':'';render();};
$('rosterCancel').onclick=()=>{rosterPlacing=false;render();};
canvas.addEventListener('dragover',e=>{
  if(rosterDragId==null||busy||layoutPreview)return;e.preventDefault();e.dataTransfer.dropEffect='move';
  const r=canvas.getBoundingClientRect(),tile=tileAt(e.clientX-r.left,e.clientY-r.top);
  const attempt=tempPreview(tile.x,tile.y,key=>dropPreview(rosterDragId,key));
  const feedback=dropFeedback(attempt.value,attempt.error);lastPointer={clientX:e.clientX,clientY:e.clientY};showDragChip(feedback.status,feedback.title,feedback.text);
});
canvas.addEventListener('drop',e=>{
  if(rosterDragId==null||busy||layoutPreview)return;e.preventDefault();const id=rosterDragId;rosterDragId=null;hideDragChip();
  const r=canvas.getBoundingClientRect();lastPointer={clientX:e.clientX,clientY:e.clientY};
  finishHqDrop(id,state.assignments.get(id),tileAt(e.clientX-r.left,e.clientY-r.top));
});
async function loadHistory(reset = true) {
  try {
    const before = reset || !historyEntries.length ? '' : `?before=${historyEntries.at(-1).revision}`;
    const r = await fetch(`${apiUrl}/api/placement/history${before}`, { cache: 'no-store', headers: globalThis.readHeaders ? readHeaders() : {} });
    if (!r.ok) throw Error(globalThis.needAccessCode && needAccessCode(r.status) ? 'Access code needed — open the link leadership gave you.' : `History unavailable (${r.status})`);
    const data = await r.json();
    historyEntries = reset ? data.entries : historyEntries.concat(data.entries);
    $('moreHistory').dataset.hasMore = data.hasMore ? 'yes' : '';
    renderHistoryList();
  } catch (e) { $('historyDetail').textContent = e.message; }
}
async function showHistory(number) {
  try {
    const r = await fetch(`${apiUrl}/api/placement/history/${number}`, { cache: 'no-store', headers: globalThis.readHeaders ? readHeaders() : {} });
    if (!r.ok) throw Error(globalThis.needAccessCode && needAccessCode(r.status) ? 'Access code needed — open the link leadership gave you.' : `Revision unavailable (${r.status})`);
    const entry = await r.json();
    const check = P.create(entry.plan || plan); P.importDraft(check, entry.draft);
    selectedHistory = entry;
    const detail = $('historyDetail'); detail.replaceChildren();
    const title = document.createElement('p');
    title.textContent = `Revision ${number} by ${entry.updatedBy} · ${changeSummary(entry.changes)}` +
      ` · Roster/power ${entry.plan?.meta.powerCaptured || entry.plan?.meta.capturedDate || 'September 2026'}`;
    detail.append(title);
    if (entry.action === 'restore') {
      const source = document.createElement('p');
      source.textContent = `Restored from revision ${entry.sourceRevision}.`; detail.append(source);
    }
    const list = document.createElement('ul'); list.className = 'history-changes';
    const add = value => { const li = document.createElement('li'); li.textContent = value; list.append(li); };
    const name = id => check.players.get(id)?.name || `Atlas ID ${id}`;
    for (const player of entry.changes.added || []) add(`${player.name || name(player.id)}: added to roster at ${player.to}`);
    for (const player of entry.changes.removed || []) add(`${player.name || name(player.id)}: removed from roster (previously ${player.from})`);
    for (const move of entry.changes.moved) add(`${name(move.id)}: ${move.from || 'Waiting'} → ${move.to || 'Waiting'}`);
    for (const area of entry.changes.boundaries || []) add(`${area.tag}: area ${Math.round(normalDegrees(area.start*180/Math.PI))}°–${Math.round(normalDegrees(area.end*180/Math.PI))}°`);
    for (const tag of entry.changes.removedAlliances || []) add(`${tag}: alliance zone removed`);
    for (const p of entry.changes.allianceMemberships || []) add(`${name(p.id)}: alliance ${p.tag}`);
    for (const id of entry.changes.locked) add(`${name(id)}: locked`);
    for (const id of entry.changes.unlocked) add(`${name(id)}: unlocked`);
    for (const pair of entry.changes.paired) add(`${name(pair.strike)} ⇄ ${name(pair.reserve)}: paired`);
    for (const pair of entry.changes.unpaired) add(`${name(pair.strike)} ⇄ ${name(pair.reserve)}: pair removed`);
    detail.append(list);
    $('restoreHistory').hidden = number === revision;
  } catch (e) { $('historyDetail').textContent = e.message; $('restoreHistory').hidden = true; }
}
async function loadShared(force = false) {
  if(layoutPreview)return;
  if (!apiUrl) { message('Shared backend URL is not configured yet.'); return; }
  if (busy) { if (force) message('Wait for the current save to finish.'); return; }
  try {
    const r = await fetch(`${apiUrl}/api/placement`, { cache: 'no-store', headers: globalThis.readHeaders ? readHeaders() : {} });
    if (!r.ok) throw Error(globalThis.needAccessCode && needAccessCode(r.status) ? 'Access code needed — open the link leadership gave you.' : `Shared plan unavailable (${r.status})`);
    const data = await r.json();
    if (busy) return;
    if (data.revision !== revision || force) {
      if (data.draft && data.draft.signature !== P.create(plan).signature) {
        const response = await fetch(`${apiUrl}/api/placement/plan?signature=${encodeURIComponent(data.draft.signature)}`, { cache: 'no-store', headers: globalThis.readHeaders ? readHeaders() : {} });
        if (!response.ok) throw Error('This revision’s roster could not be loaded.');
        usePlan((await response.json()).plan);
      }
      const next = P.create(plan);
      if (data.draft) P.importDraft(next, data.draft);
      if(sharedSource)LastZSharedState.enrichState(next,sharedSource);
      state = next; revision = data.revision;
      lastMoveGaps=[];
      syncBoundary();
      if (!state.players.has(selectedId)) selectedId = null;
      if (!state.sites.has(targetKey)) targetKey = null;
      if (!state.players.has(pendingStrike)) pendingStrike = null;
      render();
      if (selectedHistory) $('restoreHistory').hidden = selectedHistory.revision === revision;
      loadHistory();
      message(data.revision ? `Shared revision ${revision} by ${data.updatedBy} loaded.`
        : 'Shared plan is ready. No edits yet.');
    }
  } catch (e) { if (!busy) message(e.message); }
}
// Check the committed revision before retrying an interrupted save.
async function saveSharedChange(path,payload,matches) {
  const send=()=>fetch(apiUrl+path,{method:path.endsWith('/restore')?'POST':'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+editorKey},body:JSON.stringify(payload)});
  let response;
  try {response=await send();} catch {
    message('Connection interrupted. Checking whether your change was saved…');
    let current;
    try {const check=await fetch(apiUrl+'/api/placement',{cache:'no-store',headers:globalThis.readHeaders?readHeaders():{}});if(!check.ok)throw Error();current=await check.json();}
    catch {throw Error('Connection lost. Could not confirm the save. Reconnect and refresh before retrying.');}
    if(current.revision===payload.baseRevision+1&&matches(current))return current;
    if(current.revision!==payload.baseRevision)throw Error('Another planner saved first; reloading their version. Retry your edit.');
    message('Connection restored. Retrying your change…');
    try {response=await send();} catch {throw Error('Connection lost again. Could not confirm the save. Reconnect and refresh before retrying.');}
  }
  const data=await response.json();
  if(!response.ok)throw Error(response.status===409?'Another planner saved first; reloading their version. Retry your edit.':data.error||('Save failed ('+response.status+')'));
  return data;
}
async function mutate(action) {
  if(layoutPreview){message('Apply or cancel the layout preview before making another change.');return;}
  if (!editMode) { message('Open Edit plan to make changes.'); return; }
  if (!editorKey) { message('Enter the shared editor key to make changes.'); return; }
  if (busy) { message('A change is still saving.'); return; }
  const before = P.exportDraft(state), baseRevision = revision;
  try {
    const detail = action();
    busy = true; render(); message('Saving to shared database…');
    const draft=P.exportDraft(state);
    const data=await saveSharedChange('/api/placement',{baseRevision,draft,editor:$('editorName').value.trim()||'Planner'},current=>JSON.stringify(current.draft)===JSON.stringify(draft));
    revision = data.revision; render();
    if (selectedHistory) $('restoreHistory').hidden = selectedHistory.revision === revision;
    loadHistory();
    message(`Saved version ${revision}${typeof detail === 'number' ? ` · ${detail} players updated` : typeof detail === 'string' ? ` · ${detail}` : ''}.`);
    return true;
  } catch (e) {
    P.importDraft(state, before); syncBoundary();render(); message(e.message);
    if (e.message.startsWith('Another planner')) { busy = false; await loadShared(true); }
    return false;
  } finally { busy = false; render(); }
}
function setTarget(key) {
  const [x,y]=key.split(',').map(Number);
  P.defineSite(state,x,y);
  targetKey = key;
  const s = state.sites.get(key); $('targetX').value = s.x; $('targetY').value = s.y;
  render();
}
function download(name, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('downloadSurvey').onclick=()=>{
  if(!state.survey)return;
  const cell=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const header=['Player UID','Name','Alliance','Observed X','Observed Y','Observed UTC','Roster ID','Status','Proposed X','Proposed Y'];
  const rows=[...state.survey.anchors,...state.survey.obstacles,...state.survey.relocations||[]].map(p=>{const target=p.id!=null&&P.current(state,p.id);return [p.uid,p.name,p.tag,p.x,p.y,new Date(p.observed*1000).toISOString(),p.id,target?.relocatingInGame?'Relocate':'Keep fixed',target?target.x:p.x,target?target.y:p.y];});
  download('capital-in-game-'+state.survey.capturedAt.slice(0,10)+'.csv','\ufeff'+[header,...rows].map(r=>r.map(cell).join(',')).join('\r\n'));
};
function csv(after) {
  const columns = ['id', 'name', 'tag', 'hq', 'zone', 'x', 'y', 'ring', 'spot', 'role',
    'locked', 'shield', 'attendanceProxy', 'oldX', 'oldY'];
  const cell = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return '\ufeff' + columns.join(',') + '\r\n' +
    P.rows(state, after).map(p => columns.map(k => cell(p[k])).join(',')).join('\r\n');
}

// Drag an HQ to a new tile. Dropping onto a held tile offers a swap or sends the holder to
// the unplaced list; every drop is checked for wedge, spacing and teleport-gap safety first.
function hqAt(x,y,radius=14) {
  let best=null,d=radius;
  for(const [id,key] of state.assignments) {
    if(key==null)continue;
    const site=state.sites.get(key);if(!site)continue;
    const [px,py]=project(site),pd=Math.hypot(px-x,py-y);
    if(pd<d){d=pd;best={id,key,site};}
  }
  return best;
}
function tileAt(x,y) {
  const r=canvas.getBoundingClientRect(),base=Math.min(r.width/260,r.height/250)*scale;
  const tileY=Math.round(500+(y-r.height/2-panY)/(.8*base));
  const tileX=Math.round(500+(x-r.width/2-panX)/base-((tileY-500)%2!==0?.5:0));
  const j=tileY-500,i=tileX-500-Math.floor(j/2),ring=Math.max(Math.abs(i),Math.abs(j),Math.abs(i+j));
  return {x:tileX,y:tileY,ring,zone:ring>=19&&ring<=34?'mud':ring>=37&&ring<=119?'grass':null};
}
// Drag feedback lives next to the pointer: a chip that follows the cursor during the drag and the
// occupied-tile prompt anchored at the drop point. Both read the same preview the drop will use.
function tempPreview(x,y,fn){
  const key=`${x},${y}`,added=!state.sites.has(key);
  try{P.defineSite(state,x,y);}catch(e){return {error:e.message};}
  try{return {value:fn(key)};}finally{if(added)state.sites.delete(key);}
}
function hideDragChip(){const chip=$('dragChip');chip.hidden=true;chip.className='drag-chip';$('dragChipTitle').textContent='';$('dragChipText').textContent='';}
function showDragChip(status,title,text){
  const chip=$('dragChip');
  $('dragChipTitle').textContent=title;$('dragChipText').textContent=text;
  chip.className=`drag-chip ${status||''}`;chip.hidden=false;
  if(!lastPointer)return;
  const box=chip.parentElement.getBoundingClientRect(),w=chip.offsetWidth,h=chip.offsetHeight;
  const x=lastPointer.clientX-box.left,y=lastPointer.clientY-box.top;
  chip.style.left=`${Math.max(6,Math.min(box.width-w-6,x+16))}px`;
  chip.style.top=`${y+18+h>box.height-6?Math.max(6,y-h-18):y+18}px`;
}
function dropFeedback(preview,error){
  if(error||!preview)return {status:'bad',title:'Not allowed here',text:error||'That tile cannot hold this HQ.'};
  const occupied=preview.occupant!=null&&preview.occupant!==preview.id;
  if(occupied){
    const holder=state.players.get(preview.occupant).name,ok=preview.swap?.ok||preview.unplace?.ok;
    return {status:ok?'choice':'bad',title:ok?`Release to choose \u2014 ${holder} holds this tile`:`${holder} holds this tile and neither option is allowed`,
      text:ok?`Swap positions, or send ${holder} to the unplaced list.`:(preview.swap?.error?.message||preview.unplace?.error?.message||'That drop is not allowed.')};
  }
  const best=bestDrop(preview);
  if(!best)return {status:'bad',title:'Not allowed here',text:preview.move?.error?.message||'That drop is not allowed.'};
  if(best.gaps.length)return {status:'gap',title:`Opens ${best.gaps.length} teleport-sized gap${best.gaps.length>1?'s':''}`,text:'Release to move anyway, or pick a tile that keeps the formation closed.'};
  return {status:'ok',title:'Release to move here',text:'No new teleport-sized gap.'};
}
function dropAttempt(id,key,action) {
  try {
    const check=P.checkPlacement(state,id,key,action?{occupied:action}:undefined);
    const gaps=state.assignments.get(id)===key?[]:P.teleportGaps(state,state.assignments,check.next);
    return {action,ok:true,gaps,error:null};
  } catch(e) { return {action,ok:false,gaps:e.openings||[],error:e}; }
}
function dropPreview(id,key) {
  const occupant=P.playerAt(state,key),mine=state.assignments.get(id),mover=state.players.get(id);
  if(occupant==null||occupant===id)return {id,key,occupant,mover,move:dropAttempt(id,key,null)};
  const preview={id,key,occupant,mover};
  if(mine!=null)preview.swap=dropAttempt(id,key,'swap');
  preview.unplace=dropAttempt(id,key,'unplace');
  return preview;
}
function bestDrop(preview) {
  return preview.move?.ok?preview.move:preview.swap?.ok?preview.swap:preview.unplace?.ok?preview.unplace:null;
}
function dropHint(preview) {
  if(!preview)return '';
  const holder=preview.occupant!=null&&preview.occupant!==preview.id?state.players.get(preview.occupant).name:null;
  if(holder)return `${holder} holds this tile. Drop to choose: swap positions, or move ${holder} to the unplaced list.`;
  return preview.move?.ok?`Drop to reserve this tile for ${preview.mover.name}.`:preview.move?.error?.message||'That tile cannot hold this HQ.';
}
function dropGapText(preview) {
  const attempt=preview?bestDrop(preview):null;
  if(!attempt)return '';
  if(!attempt.gaps.length)return 'This move creates no new teleport-sized gap.';
  return `Teleport-sized gap${attempt.gaps.length>1?'s':''} would open with this move: `+
    attempt.gaps.slice(0,6).map(s=>`${s.x}, ${s.y}`).join(' \u00b7 ')+(attempt.gaps.length>6?' \u2026':'')+'. Close the opening or reserve a replacement there.';
}
function showDropChoice(preview) {
  const holder=state.players.get(preview.occupant).name,tile=state.sites.get(preview.key);
  const note=attempt=>attempt.gaps.length?` \u00b7 ${attempt.gaps.length} teleport-sized gap${attempt.gaps.length>1?'s':''} would open`:' \u00b7 no new teleport gap';
  const lines=[`${holder} already holds X ${tile.x}, Y ${tile.y}.`];
  if(preview.swap)lines.push(preview.swap.ok?`Swap keeps ${holder} in the formation${note(preview.swap)}.`:`Swap refused: ${preview.swap.error.message}`);
  if(preview.unplace)lines.push(preview.unplace.ok?`The unplaced list keeps ${holder} on the roster${note(preview.unplace)}.`:`Unplaced list refused: ${preview.unplace.error.message}`);
  $('dropChoiceText').textContent=lines.join(' ');
  $('dropSwap').hidden=!preview.swap;$('dropSwap').disabled=!preview.swap?.ok;
  $('dropUnplace').disabled=!preview.unplace?.ok;
  const box=$('dropChoice');box.hidden=false;box.classList.add('floating');
  if(lastPointer){const area=box.parentElement.getBoundingClientRect(),w=box.offsetWidth,h=box.offsetHeight;
    const x=lastPointer.clientX-area.left,y=lastPointer.clientY-area.top;
    box.style.left=`${Math.max(8,Math.min(area.width-w-8,x-w/2))}px`;
    box.style.top=`${y+16+h>area.height-8?Math.max(8,y-h-16):y+16}px`;}
  pendingDrop=preview;
  render();
  shownGaps=bestDrop(preview)?.gaps||[];
  $('gapWarning').textContent=dropGapText(preview);
  $('gapWarning').classList.toggle('has-gap',shownGaps.length>0);
  draw();
}
async function commitDrop(action) {
  const preview=pendingDrop;
  if(!preview)return;
  const attempt=action?preview[action]:preview.move;
  if(!attempt?.ok){message(attempt?.error?.message||'That drop is not allowed.');return;}
  try{const [sx,sy]=preview.key.split(',').map(Number);P.defineSite(state,sx,sy);}catch(e){}
  const previousGaps=lastMoveGaps;
  pendingDrop=null;$('dropChoice').hidden=true;hideDragChip();shownGaps=[];
  const result=await mutate(() => {
    const before=new Map(state.assignments);
    const occupant=P.moveAndLock(state,preview.id,preview.key,action?{occupied:action}:undefined);
    lastMoveGaps=P.teleportGaps(state,before);
    selectedId=preview.id;targetKey=preview.key;
    const holder=occupant!=null&&occupant!==preview.id?state.players.get(occupant).name:null;
    return (action==='swap'?`Swapped with ${holder}`:action==='unplace'?`${holder} moved to the unplaced list`:`Dropped on ${preview.key}`)+
      (lastMoveGaps.length?` \u00b7 ${lastMoveGaps.length} teleport-sized gap${lastMoveGaps.length>1?'s':''} opened; see the amber outlines`:' \u00b7 no new teleport-sized gap');
  });
  if(result===false)lastMoveGaps=previousGaps;
  render();
}
function finishHqDrop(id,fromKey,tile) {
  pendingDrop=null;$('dropChoice').hidden=true;hideDragChip();shownGaps=[];
  const key=tile?`${tile.x},${tile.y}`:null;
  if(!key||key===fromKey){render();message('Drag an HQ onto another tile to move it.');return;}
  let preview=null,error=null,added=false;
  try { added=!state.sites.has(key); P.defineSite(state,tile.x,tile.y); preview=dropPreview(id,key); } catch(e) { error=e.message; }
  if(!preview){ if(added)state.sites.delete(key); render();message(error||'That tile cannot hold this HQ.');return; }
  if(preview.occupant==null||preview.occupant===id) {
    if(preview.move.ok){pendingDrop=preview;commitDrop(null);return;}
    if(added)state.sites.delete(key);
    render();message(preview.move.error.message);return;
  }
  if(preview.swap?.ok||preview.unplace?.ok){preview.addedSite=added;showDropChoice(preview);return;}
  if(added)state.sites.delete(key);
  render();message(preview.swap?.error?.message||preview.unplace?.error?.message||'That drop is not allowed.');
}
$('dropSwap').onclick=()=>commitDrop('swap');
$('dropUnplace').onclick=()=>commitDrop('unplace');
$('dropCancel').onclick=()=>{if(pendingDrop?.addedSite)state.sites.delete(pendingDrop.key);pendingDrop=null;$('dropChoice').hidden=true;hideDragChip();shownGaps=[];render();message('Drop canceled.');};
// Click an HQ for its card. Same facts as the sidebar, but anchored to the HQ that was clicked -
// power first, because that is what people compare when they are looking at the formation.
function hideHqInfo(){const box=$('hqInfo');box.hidden=true;hqInfoId=null;}
function spotLabel(p){
  const spot=P.current(state,p.id);
  if(!spot||spot.zone==='unassigned')return 'Waiting for a spot';
  const zone=spot.zone==='mud'?'Mud front':spot.zone==='grass'?'Grass support':'—';
  return `X ${spot.x}, Y ${spot.y} · ${zone}${Number.isFinite(spot.ring)?` · ring ${spot.ring}`:''}${p.locked?' · reserved':''}`;
}
function showHqInfo(id, clientX, clientY){
  const p=state.players.get(id);if(!p)return;
  // On a phone the canvas is only ~290px tall, so the card drops its long notes and the observation
  // line: name, HQ level, alliance, powers and spot still say exactly who was tapped.
  const compact=canvas.clientWidth<520;
  $('hqInfoName').textContent=`${p.name}${p.role?` · ${p.role}`:''}`;
  const facts=[
    ['HQ level', p.hq ?? 'unknown'],
    ['Alliance', p.tag || 'No alliance'],
    [p.heroPowerMetric==='hero_component_power'?'Hero component power':'Hero power', p.heroPower?.toLocaleString()||'unknown'],
    ['Power', `${p.totalPowerApproximate?'≈ ':''}${p.totalPower?.toLocaleString()||'unknown'}`],
    ['Spot', spotLabel(p)],
  ];
  if(!compact&&Number.isFinite(p.actualX)&&Number.isFinite(p.actualY))facts.push(['Shared map observation',`X ${p.actualX}, Y ${p.actualY}`]);
  const dl=$('hqInfoFacts');dl.replaceChildren();
  for(const [key,value] of facts){const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=value;dl.append(dt,dd);}
  const notes=[];
  if(!compact){
    if(P.rearReasons(p).length)notes.push(`Back priority: ${P.rearReasons(p).join(' · ')}.`);
    if(p.attendanceProxy==='unknown')notes.push('No attendance record for the previous SvS, so no back penalty.');
    if(p.placedInGame)notes.push('Already placed in game; fixed during replanning.');
    if(p.relocatingInGame)notes.push(`Observed in game at X ${p.observedX}, Y ${p.observedY}; the coordinates above are the proposed relocation.`);
    if(p.powerObservedAt)notes.push(`Personal power observed ${new Date(p.powerObservedAt).toLocaleDateString()}.`);
    if(p.nameReadingStatus==='partial')notes.push('Name partly unreadable; check the saved roster card.');
  }
  $('hqInfoNotes').textContent=notes.join(' ');$('hqInfoNotes').hidden=!notes.length;
  const box=$('hqInfo');hqInfoId=id;box.hidden=false;
  box.classList.toggle('compact',compact);
  const area=box.parentElement.getBoundingClientRect(),w=box.offsetWidth,h=box.offsetHeight;
  if(canvas.clientWidth<520){
    // Phone: dock the card at the foot of the canvas, centred. Anchoring it to the tap would cover
    // the HQ the reader just tapped - on a 390px screen the card is nearly as wide as the map.
    const top=canvas.offsetTop+canvas.clientHeight-h-10;
    box.style.left=`${Math.max(8,Math.round((area.width-w)/2))}px`;
    box.style.top=`${Math.max(8,Math.round(top))}px`;
  } else {
    const x=clientX-area.left,y=clientY-area.top;
    box.style.left=`${Math.max(8,Math.min(area.width-w-8,x+14))}px`;
    box.style.top=`${y+14+h>area.height-8?Math.max(8,y-h-18):y+14}px`;
  }
}
$('hqInfoClose').onclick=hideHqInfo;
// Pinch zoom. The midpoint of the two fingers is anchored to the map: whatever tile is under it
// stays under it while the fingers open or close, so a pinch zooms where the user is pinching.
function canvasPoint(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
function pinchMetrics(){
  const [a,b]=[...pointers.values()];
  return {distance:Math.hypot(a.x-b.x,a.y-b.y),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};
}
function beginPinch(){
  const m=pinchMetrics();if(!m.distance)return;
  const r=canvas.getBoundingClientRect(),k=Math.min(r.width/260,r.height/250)*scale;
  // Tile-space coordinates under the midpoint, kept fixed for the whole gesture.
  pinch={distance:m.distance,scale,r,k,
    u:500+(m.center.x-r.width/2-panX)/k,
    v:500+(m.center.y-r.height/2-panY)/(k*.8)};
}
function updatePinch(){
  const m=pinchMetrics();if(!pinch||!m.distance)return;
  scale=Math.max(.5,Math.min(10,pinch.scale*m.distance/pinch.distance));
  const base=pinch.k*scale/pinch.scale;
  panX=m.center.x-pinch.r.width/2-(pinch.u-500)*base;
  panY=m.center.y-pinch.r.height/2-(pinch.v-500)*base*.8;
  draw();
}
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  lastPointer={clientX:e.clientX,clientY:e.clientY};
  hideHqInfo();
  pointers.set(e.pointerId,canvasPoint(e));
  if(pointers.size>1){   // a second finger means pinch, never a drag or a drop
    drag=null;pinch=null;hideDragChip();shownGaps=[];
    if(pointers.size===2)beginPinch();
    draw();return;
  }
  const r=canvas.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
  const canEdit=editMode&&editorKey&&!busy&&!layoutPreview;
  const reach=e.pointerType==='touch'?26:14;
  const handle=canEdit&&boundaryHandles.find(h=>Math.hypot(h.x-x,h.y-y)<reach);
  const grab=!handle&&canEdit?hqAt(x,y,reach):null;
  const hover=!handle&&!grab?hqAt(x,y,reach):null;
  hideDragChip();
  drag = { x:e.clientX,y:e.clientY,moved:false,handle:handle?.kind,original:bounds(),hq:grab?.id,hqKey:grab?.key,origin:grab?.key,viewOnly:hover?.id!=null&&!canEdit };
});
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); if(pointers.size<2)pinch=null; hideDragChip(); drag = null; });
canvas.addEventListener('pointermove', e => {
  if(pointers.has(e.pointerId))pointers.set(e.pointerId,canvasPoint(e));
  if(pinch){lastPointer={clientX:e.clientX,clientY:e.clientY};updatePinch();return;}
  if (!drag) {   // hovering: the alliance tags across the wedges are clickable
    if (e.pointerType !== 'touch') {
      const r = canvas.getBoundingClientRect();
      canvas.style.cursor = allianceLabelAt(e.clientX - r.left, e.clientY - r.top, e.pointerType) ? 'pointer' : '';
    }
    return;
  }
  lastPointer={clientX:e.clientX,clientY:e.clientY};
  if (drag.hq!=null) {
    const hx=e.clientX-drag.x,hy=e.clientY-drag.y;
    if(Math.abs(hx)+Math.abs(hy)>3)drag.moved=true;
    if(!drag.moved)return;
    const r=canvas.getBoundingClientRect(),tile=tileAt(e.clientX-r.left,e.clientY-r.top);
    drag.tile=tile;drag.preview=null;drag.error=null;
    const attempt=tempPreview(tile.x,tile.y,key=>dropPreview(drag.hq,key));
    if(attempt.error)drag.error=attempt.error;else drag.preview=attempt.value;
    shownGaps=drag.preview?bestDrop(drag.preview)?.gaps||[]:[];
    const feedback=dropFeedback(drag.preview,drag.error);
    drag.status=feedback.status;
    const mover=state.players.get(drag.hq);
    $('placementHint').textContent=drag.preview?dropHint(drag.preview):drag.error||'';
    $('gapWarning').textContent=dropGapText(drag.preview);
    $('gapWarning').classList.toggle('has-gap',shownGaps.length>0);
    showDragChip(feedback.status,feedback.title,
      `${mover?.name||'HQ'} \u2192 X ${tile.x}, Y ${tile.y}${tile.zone?'':' (outside the buildable rings)'} \u00b7 ${feedback.text}`);
    draw();
    return;
  }
  if (drag.handle) {
    const r=canvas.getBoundingClientRect(),[cx,cy]=project({x:500,y:500});
    const angle=normalDegrees(Math.atan2(e.clientX-r.left-cx,-(e.clientY-r.top-cy)/.8)*180/Math.PI);
    const width=normalDegrees(drag.original.end-drag.original.start)||360;
    if (drag.handle==='center') { $('wedgeStart').value=normalDegrees(angle-width/2);$('wedgeEnd').value=normalDegrees(angle+width/2); }
    else $(drag.handle==='start'?'wedgeStart':'wedgeEnd').value=Math.round(angle);
    const b=bounds(),clampedWidth=normalDegrees(b.end-b.start)||360;
    $('boundaryCenter').value=Math.round(normalDegrees(b.start+clampedWidth/2));$('boundaryWidth').value=Math.round(clampedWidth);
    drag.moved=true;draw();renderCapacity();return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  if(drag.viewOnly&&drag.moved)showDragChip('bad','Moves need the editor','Open Edit plan in the header to drag HQs. This shared view is read only, so dragging pans the map.');
  panX += dx; panY += dy; drag.x = e.clientX; drag.y = e.clientY; draw();
});
canvas.addEventListener('pointerup', e => {
  const pinching=!!pinch;
  pointers.delete(e.pointerId);
  if(pinching){
    // A pinch is never a tap. The finger still down keeps panning, and nothing is selected.
    pinch=null;hideDragChip();
    const left=[...pointers.values()],r=canvas.getBoundingClientRect();
    drag=left.length===1?{x:r.left+left[0].x,y:r.top+left[0].y,moved:true}:null;
    return;
  }
  if (!drag) return;
  lastPointer={clientX:e.clientX,clientY:e.clientY};
  hideDragChip();
  const moved=drag.moved,handle=drag.handle,hq=drag.hq,hqKey=drag.hqKey,tile=drag.tile;drag=null;
  if(hq!=null&&moved){finishHqDrop(hq,hqKey,tile);return;}
  if(handle && moved){const b=bounds();mutate(()=>P.setSection(state,$('section').value,b.start,b.end,areaRules()));return;}
  if (moved) return;
  if ($('swapPreview').checked) { message('Switch to staging view to choose a site.'); return; }
  const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  // A finger is far wider than a cursor: touch gets a generous target, and if the nearest tile is
  // empty it prefers the nearest tile that actually holds an HQ - a near miss should still say who.
  if(rosterPlacing&&selectedId!=null){
    if(!busy&&!layoutPreview&&editorKey){rosterPlacing=false;finishHqDrop(selectedId,state.assignments.get(selectedId),tileAt(x,y));}
    return;
  }
  const radius = e.pointerType === 'touch' ? 36 : 12;
  let best = null, d = radius;
  for (const s of state.sites.values()) {
    const [px, py] = project(s), pd = Math.hypot(px - x, py - y);
    if (pd < d) { d = pd; best = s; }
  }
  if (best && e.pointerType === 'touch' && P.playerAt(state, P.siteKey(best)) == null) {
    let held = null, hd = radius;
    for (const s of state.sites.values()) {
      const [px, py] = project(s), pd = Math.hypot(px - x, py - y);
      if (pd < hd && P.playerAt(state, P.siteKey(s)) != null) { hd = pd; held = s; }
    }
    if (held) best = held;
  }
  const holder = best ? P.playerAt(state, P.siteKey(best)) : null;
  if (e.pointerType === 'touch' && holder == null) {
    let held = null, hd = radius;
    for (const s of state.sites.values()) {
      const [px, py] = project(s), pd = Math.hypot(px - x, py - y);
      if (pd < hd && P.playerAt(state, P.siteKey(s)) != null) { hd = pd; held = s; }
    }
    if (held) { best = held; d = hd; }
  }
  const placing = editMode && $('mapAction').value === 'place';
  // The alliance tags are chips drawn on top of the map, so a click inside one filters to that
  // alliance - the same way any other control on top of the canvas would win. Skipped while choosing
  // a target tile, where a click on the map means "place it here".
  const label = allianceLabelAt(x, y, e.pointerType);
  if (label && !placing) { toggleSectionFilter(label); return; }
  const chosen = best ? P.playerAt(state, P.siteKey(best)) : null;
  if (chosen != null && !placing) {
    selectedId = chosen; targetKey = null; if (editMode) $('mapAction').value = 'place';
    render(); showHqInfo(chosen, e.clientX, e.clientY);
    return;
  }
  if (chosen == null) hideHqInfo();
  if (placing) {
    if (best) { try { setTarget(P.siteKey(best)); } catch (err) { message(err.message); } }
    else {
      const r = canvas.getBoundingClientRect(), base = Math.min(r.width / 260, r.height / 250) * scale;
      const tileY = Math.round(500 + (y - r.height / 2 - panY) / (.8 * base));
      try { setTarget(`${Math.round(500 + (x - r.width / 2 - panX) / base - ((tileY - 500) % 2 !== 0 ? .5 : 0))},${tileY}`); } catch (err) { message(err.message); }
    }
  }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault(); hideHqInfo(); scale = Math.max(.5, Math.min(10, scale * (e.deltaY < 0 ? 1.12 : .89))); draw();
}, { passive: false });
for (const id of ['search', 'section', 'zone', 'swapPreview'])
  $(id).addEventListener(id === 'search' ? 'input' : 'change', render);
for (const id of ['wedgeStart', 'wedgeEnd']) $(id).addEventListener('input',()=>{draw();renderCapacity();});
$('section').addEventListener('change',()=>{cancelPreview();targetKey=null;$('removeAllianceChoice').value=$('section').value==='Other'?'':$('section').value;syncBoundary();render();});
$('mapAction').onchange=render;
$('showGaps').onchange=draw;
$('showEdges').onchange=draw;
$('chooseOnMap').onclick=()=>{$('mapAction').value='place';render();canvas.scrollIntoView({behavior:'smooth',block:'center'});};
for(const button of document.querySelectorAll('[data-nudge]'))button.onclick=()=>{
  const current=targetKey?state.sites.get(targetKey):P.current(state,selectedId);
  if(!current||current.x==null){message('Choose a player or target tile first.');return;}
  const [dx,dy]=button.dataset.nudge.split(',').map(Number);
  try{setTarget(`${current.x+dx},${current.y+dy}`);}catch(e){message(e.message);}
};
$('resetView').onclick=()=>{scale=1;panX=panY=0;hideHqInfo();draw();};
$('showWaiting').onclick=()=>{$('zone').value='unassigned';$('search').value='';render();};
function updateAreaInputs(){
  const center=Number($('boundaryCenter').value),width=Number($('boundaryWidth').value);
  if(!Number.isFinite(center)||!Number.isFinite(width)||width<1||width>360)return;
  $('wedgeStart').value=width===360 ? 0 : normalDegrees(center-width/2);
  $('wedgeEnd').value=width===360 ? 360 : normalDegrees(center+width/2);
  draw();renderCapacity();
}
for(const id of ['boundaryCenter','boundaryWidth'])$(id).addEventListener('input',updateAreaInputs);
for(const button of document.querySelectorAll('[data-direction]'))button.onclick=()=>{$('boundaryCenter').value=button.dataset.direction;updateAreaInputs();};
$('saveBoundary').onclick=()=>mutate(()=>{const b=bounds();P.setSection(state,$('section').value,b.start,b.end,areaRules());});
function previewLayout(mode='alliance'){
  const all=mode==='all';
  if(!editorKey){message('Enter the shared editor key to preview changes.');return;}
  if(busy){message('A change is still saving.');return;}
  if(layoutPreview){message('Apply or cancel the current preview first.');return;}
  const before=P.exportDraft(state);
  try {
    if($('swapPreview').checked)throw Error('Switch to staging view first');
    let report;
    if(all)report=P.arrangeAll(state,areaRules());
    else {const b=bounds();P.setSection(state,$('section').value,b.start,b.end,areaRules());report=mode==='grass'?P.arrangeGrass(state,$('section').value):P.arrangeAlliance(state,$('section').value);}
    layoutPreview={before,after:P.exportDraft(state),revision};
    const failed=Object.entries(state.sections).filter(([tag,a])=>!state.planningMode&&a.defencePacking&&P.teleportOpenings(state,tag).some(p=>p.insideFormation));
    layoutPreview.blocked=failed.length>0;$('applyLayout').disabled=layoutPreview.blocked;
    $('layoutReport').textContent=`Preview: ${report.moved} players changed · ${report.waiting} waiting for room`+
      (report.displacedGrass?` · ${report.displacedGrass} blocking grass HQs relocated into their own/shared areas`:'')+
      (report.lockedOutside?` · ${report.lockedOutside} reserved outside the wedge`:'')+
      (all?'. All unlocked players rearranged using saved wedges and these spacing rules.':mode==='grass'?'. Grass grouped in saved order. All mud stays fixed; only blocking grass HQs from other groups may move.':'. Other alliances’ mud stays fixed; only blocking grass HQs may move.')+' Apply to save, or cancel.';
    $('layoutPreview').hidden=false;$('mapMode').textContent='UNSAVED LAYOUT PREVIEW';render();
    message(layoutPreview.blocked?'Cannot apply: an enemy HQ still fits inside the formation. Amber footprints show every opening.':'Preview only. Apply preview to save this layout.');
  }catch(e){P.importDraft(state,before);render();message(e.message);}
}
$('arrangeAlliance').onclick=()=>previewLayout();
$('arrangeAll').onclick=()=>previewLayout('all');
$('arrangeGrass').onclick=()=>previewLayout('grass');
$('cancelLayout').onclick=()=>{cancelPreview();syncBoundary();message('Preview canceled.');};
$('applyLayout').onclick=()=>{
  if(!layoutPreview)return;
  if(layoutPreview.blocked){message('Close every teleport opening before applying this layout.');return;}
  const after=layoutPreview.after,detail=layoutPreview.detail||'Alliance layout applied';cancelPreview();
  mutate(()=>{P.importDraft(state,after);return detail;});
};
for(const id of ['grassOnly','grassCompact','defencePacking','frontLayers','bodyGap','boundaryCenter','boundaryWidth','wedgeStart','wedgeEnd'])
  $(id).addEventListener('input',()=>{if(layoutPreview){cancelPreview();message('Preview canceled because the layout settings changed. Preview again to inspect the new settings.');}});
$('simulateDestroyed').onchange=render;
$('checkDefence').onclick=()=>{defenceCache=null;render();message(currentDefence().gapFree?'Every legal hex center checked: no enemy HQ fits inside the formation.':'Footprint check failed. Every legal hex center was tested; amber marks show the openings.');};
$('allianceChoice').onchange=()=>{$('customAllianceTag').value='';};
$('addAlliance').onclick=async()=>{
  let added;
  const saved=await mutate(()=>{added=P.addAlliance(state,$('customAllianceTag').value||$('allianceChoice').value);return `${added} zone added; adjust its direction and width, then save area & rules`;});
  if(saved){$('section').value=added;$('removeAllianceChoice').value=added;$('customAllianceTag').value='';syncBoundary();render();}
};
$('removeAllianceChoice').onchange=()=>{$('removeAlliance').disabled=!editorKey||busy||!!layoutPreview||!$('removeAllianceChoice').value;};
$('removeAlliance').onclick=async()=>{
  const tag=$('removeAllianceChoice').value;
  const saved=await mutate(()=>`${tag} zone removed; ${P.removeAlliance(state,tag)} players moved to waiting; reservations and affected swap pairs released`);
  if(saved){syncBoundary();render();}
};
$('refreshMemberships').onclick=()=>{
  if(!editorKey||busy||layoutPreview||!allianceRoster)return;
  const before=P.exportDraft(state);
  try{
    const report=P.refreshAllianceMemberships(state,allianceRoster);
    layoutPreview={before,after:P.exportDraft(state),revision,blocked:false,detail:'Alliance memberships refreshed from Google Sheets'};
    $('layoutReport').textContent=`Membership refresh preview: ${report.matched} players matched by player ID · ${report.changed} changed alliance and moved to waiting · ${report.unmatched} unmatched players kept unchanged. Changed players release reservations and affected swap pairs. Alliances without a zone use Other. Apply to save, or cancel.`;
    $('applyLayout').disabled=false;$('layoutPreview').hidden=false;render();
    $('layoutPreview').scrollIntoView({behavior:'smooth',block:'center'});
    message('Review the membership refresh preview before applying.');
  }catch(e){P.importDraft(state,before);render();message(e.message);}
};
$('planningMode').onchange=()=>{const enabled=$('planningMode').checked;mutate(()=>{
  if(!enabled){
    const failed=Object.entries(state.sections).filter(([tag,a])=>a.defencePacking&&P.teleportOpenings(state,tag).some(p=>p.insideFormation));
    if(failed.length)throw Error(`Draft planning stays on: close teleport openings in ${failed.map(([tag])=>tag).join(', ')} first.`);
  }
  state.planningMode=enabled;
  return enabled?'Draft planning enabled; temporary gaps allowed':'Draft planning finished; gap enforcement restored';
});render();};
$('clearEveryone').onclick=()=>mutate(()=>{
  const cleared=P.clearForPlanning(state);
  return `${cleared.players} players moved to waiting; ${cleared.observations} old observed HQ obstacles cleared; reservations and swap pairs released; draft planning enabled`;
});
$('clearMud').onclick=()=>mutate(()=>P.clear(state,{zone:'mud',includeLocked:!$('keepLocks').checked}));
$('clearArea').onclick=()=>mutate(()=>P.clear(state,{...bounds(),zone:'mud',includeLocked:!$('keepLocks').checked}));
$('unassignPlayer').onclick=()=>mutate(()=>{if(selectedId==null)throw Error('Choose a player first');P.unassign(state,selectedId);});
$('pushBack').onclick=()=>mutate(()=>`${P.pushBack(state,$('section').value)} placed in back grass · ${P.rows(state).filter(p=>p.zone==='unassigned').length} still waiting`);
$('findSite').onclick = () => {
  try { setTarget(`${Number($('targetX').value)},${Number($('targetY').value)}`); }
  catch (e) { targetKey=null;render();message(e.message); }
};
for(const id of ['targetX','targetY'])$(id).addEventListener('input',()=>{targetKey=null;render();});
$('lockPlayer').onclick = async () => {
  const beforeGaps=lastMoveGaps;
  const result=await mutate(() => {
  if ($('swapPreview').checked) throw Error('Switch to staging view first');
  if (selectedId == null || !targetKey) throw Error('Choose both a player and a site');
  const before=new Map(state.assignments);
  P.moveAndLock(state, selectedId, targetKey);
  lastMoveGaps=P.teleportGaps(state,before);
  return lastMoveGaps.length ? 'Placement reserved · teleport-sized gap detected; see amber outlines' : 'Placement reserved · no new teleport-sized gap';
  });
  if(result===false)lastMoveGaps=beforeGaps;
  render();
};
$('unlockPlayer').onclick = () => mutate(() => {
  if (selectedId == null) throw Error('Choose a player');
  if (state.pairs.some(p => p.strike === selectedId || p.reserve === selectedId))
    throw Error('Remove the swap pair before unlocking this player');
  state.locks.delete(selectedId);
});
$('fillWedge').onclick = () => mutate(() => {
  const zone=$('zone').value;
  if(zone==='rear'||zone==='unassigned')throw Error('Choose Mud, Grass, or All positions before refilling.');
  return P.fill(state,{...bounds(),section:$('section').value,zone,sections:plan.sections});
});
$('markStrike').onclick = () => {
  const p = selectedId == null ? null : P.current(state, selectedId);
  if (!p || p.zone !== 'grass') { message('Choose a grass player first.'); return; }
  pendingStrike = selectedId; render();
};
$('pairReserve').onclick = () => mutate(() => {
  if (pendingStrike == null || selectedId == null) throw Error('Mark a strike player, then choose a mud reserve');
  P.addPair(state, pendingStrike, selectedId); pendingStrike = null;
});
$('reloadShared').onclick = () => loadShared(true);
$('refreshHistory').onclick = () => loadHistory();
$('moreHistory').onclick = () => loadHistory(false);
$('restoreHistory').onclick = async () => {
  if (!selectedHistory) return;
  if (!editorKey) { message('Enter the shared editor key before restoring.'); return; }
  if (busy) { message('A change is still saving.'); return; }
  const sourceRevision = selectedHistory.revision;
  busy = true;
  try {
    const expected=selectedHistory.draft;
    const data=await saveSharedChange('/api/placement/restore',{baseRevision:revision,sourceRevision,editor:$('editorName').value.trim()||'Planner'},current=>expected&&JSON.stringify(current.draft)===JSON.stringify(expected));
    busy = false;
    await loadShared(true);
    message(`Restored revision ${sourceRevision} as new revision ${data.revision}.`);
  } catch (e) {
    message(e.message);
    if (e.message.startsWith('Another planner')) { busy = false; await loadShared(true); }
  }
  finally { busy = false; }
};
$('exportCurrent').onclick = () => download('state-798-staging.csv', csv(false));
$('exportSwap').onclick = () => download('state-798-post-swap.csv', csv(true));
$('copyList').onclick = async () => {
  const part = copyMessages[copyIndex], index = copyIndex, fingerprint = copyFingerprint, total = copyMessages.length;
  if (!part) return;
  $('copyList').disabled = true;
  try {
    await navigator.clipboard.writeText(part.text);
    if (fingerprint !== copyFingerprint) return;
    copiedParts.add(index); showCopyPart();
    $('copyStatus').textContent = `Copied part ${index + 1} of ${total}. Paste into game chat.${index + 1 < total ? ' Then choose Next part.' : ''}`;
  } catch {
    if (fingerprint !== copyFingerprint) return;
    $('copyPreview').open = true;
    $('placementText').focus();
    $('placementText').select();
    $('copyStatus').textContent = 'Select and copy the text below, then paste into game chat.';
  } finally {
    $('copyList').disabled = !copyMessages.length;
  }
};
$('copyPart').onchange = () => { copyIndex = Number($('copyPart').value); $('copyStatus').textContent = ''; showCopyPart(); };
$('nextCopyPart').onclick = () => {
  if (copyIndex + 1 < copyMessages.length) { copyIndex++; $('copyStatus').textContent = ''; showCopyPart(); }
};
$('copySize').onchange = renderCopyMessages;
$('connectEditor').onclick = async () => {
  const key = $('editorKey').value.trim();
  if (!key) { message('Enter the shared editor key.'); return; }
  try {
    const r = await fetch(`${apiUrl}/api/editor-check`, { method: 'POST',
      headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw Error('Editor key was rejected');
    editorKey = key; localStorage.setItem('state798.editorKey', key);
    sessionStorage.removeItem('state798.editorKey');
    localStorage.setItem('state798.editorName', $('editorName').value.trim());
    render();message('Editing enabled. Changes save to the shared database.');
  } catch (e) { message(e.message); }
};
$('forgetEditor').onclick = () => {
  editorKey = '';
  $('editorKey').value = '';
  localStorage.removeItem('state798.editorKey');
  sessionStorage.removeItem('state798.editorKey');
  render();message('Editor key removed from this device.');
};

Promise.all([fetch('placement-plan.json').then(r=>{if(!r.ok)throw Error('Plan could not be loaded');return r.json();}),
  globalThis.PLACEMENT_SHARED_SOURCE_BASE?LastZSharedState.load(globalThis.PLACEMENT_SHARED_SOURCE_BASE).catch(()=>{sharedSourceError=true;return null;}):Promise.resolve(null)]).then(([data,source]) => {
  sharedSource=source;
  usePlan(data); state = P.create(plan);
  $('editorName').value = localStorage.getItem('state798.editorName') || '';
  $('editorKey').value = localStorage.getItem('state798.editorKey') ||
    sessionStorage.getItem('state798.editorKey') || '';
  const query = new URLSearchParams(location.search);
  const requestedSection = query.get('alliance');
  if (plan.sections[requestedSection]) $('section').value = requestedSection;
  syncBoundary();
  const requestedPlayer = Number(query.get('player'));
  if (query.has('player') && state.players.has(requestedPlayer)) selectedId = requestedPlayer;
  render(); size(); loadShared(true);
  if (editMode) {
    if ($('editorKey').value) $('connectEditor').click();
    else $('accessPanel').open=true;
  }
  setInterval(() => { if (!document.hidden && !busy) loadShared(); }, 10000);
  if(globalThis.PLACEMENT_SHARED_SOURCE_BASE)setInterval(async()=>{
    if(document.hidden||busy||layoutPreview)return;
    try{const source=await LastZSharedState.load(globalThis.PLACEMENT_SHARED_SOURCE_BASE);if(source.fingerprint&&source.fingerprint===sharedSource?.fingerprint)return;sharedSource=source;sharedSourceError=false;LastZSharedState.enrichState(state,source);$('snapshotNote').textContent=`Power: States 792–815 workbook · observed ${new Date(source.power.source.observedAt).toLocaleString()}. Positions: shared Field Atlas map observations. Proposed coordinates are separate.`;render();}
    catch{$('snapshotNote').textContent='Shared refresh unavailable; retaining the last dated observation. '+$('snapshotNote').textContent.replace(/^Shared refresh unavailable; retaining the last dated observation\. /,'');}
  },60000);
}).catch(e => { $('summary').textContent = e.message; });
new ResizeObserver(size).observe(canvas);

fetch(`${apiUrl}/api/placement/alliance-roster`,{cache:'no-store',headers:globalThis.readHeaders?readHeaders():{}}).then(r=>{if(!r.ok)throw Error('Roster unavailable');return r.json();}).then(data=>{if(data.state!==798||!Array.isArray(data.alliances)||!Array.isArray(data.players))throw Error('Invalid roster');allianceRoster=data;if(state)render();}).catch(()=>{if(state)renderAllianceManager();});

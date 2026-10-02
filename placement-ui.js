const $ = id => document.getElementById(id);
const P = PlacementPlanner;
const canvas = $('map'), ctx = canvas.getContext('2d');
const apiUrl = globalThis.PLACEMENT_API_URL || '';
const palette = { mud: '#efb86b', grass: '#7ad7c0', outside: '#abb0f5',
  risk: '#ef6f77', absent: '#f3b65e', unknown: '#abb0f5', team: '#f9e37e' };
let plan, state, visible = [], selectedId = null, targetKey = null, pendingStrike = null;
let revision = 0, editorKey = '', busy = false, scale = 1, panX = 0, panY = 0, drag = null;
let historyEntries = [], selectedHistory = null;
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
}

function message(value) { $('status').textContent = value; }
function placementText() {
  const clean = value => String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  const section = $('section').value;
  const lines = [`${section || 'All alliances'} placements - v${revision}${$('swapPreview').checked ? ' - After swaps' : ''}`];
  if ($('zone').value) lines.push($('zone').selectedOptions[0].textContent);
  for (const [zone, label] of [['mud','Mud'], ['grass','Grass'], ['unassigned','Waiting for a spot']]) {
    const players = visible.filter(p => p.zone === zone);
    if (!players.length) continue;
    lines.push('', label);
    for (const p of players) {
      const alliance = !section || section === 'Other' ? `[${clean(p.tag) || 'No alliance'}] ` : '';
      const role = p.role ? ` (${p.role})` : '';
      lines.push(`${alliance}${clean(p.name)}${role}: ${zone === 'unassigned' ? 'Waiting' : `X${p.x} Y${p.y}`}`);
    }
  }
  return lines.join('\n');
}
function usePlan(data) {
  const previousSection = $('section').value;
  plan = data;
  $('section').replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = 'All alliances';
  $('section').append(all);
  for (const tag of Object.keys(data.sections)) {
    const option = document.createElement('option'); option.value = tag;
    option.textContent = `${tag} (${data.sections[tag].players})`; $('section').append(option);
  }
  if (data.sections[previousSection]) $('section').value = previousSection;
  $('snapshotNote').textContent = `Power ${data.meta.powerCaptured || data.meta.capturedDate || 'September 2026'} · Prior SvS ${data.meta.eventCaptured || '2026-09-26'}` + (data.meta.refreshProgress ? `. ${data.meta.refreshProgress}` : '');
  $('explain').textContent = `Roster/power: ${data.meta.powerCaptured || data.meta.capturedDate || 'September 2026'}. ` +
    `Shield/attendance: previous SvS (${data.meta.eventCaptured || '2026-09-26'}). ` +
    'Mud ranks total hero power, then total power, then HQ. Grass ranks HQ within the previous SvS priority groups. ' +
    'Alliance areas guide grouping. Prior no-shows and unshielded players use the farthest grass across all alliances. ' +
    'Lock manual edge placements before filling your area. Strike players stage in grass with paired mud reserves.';
}
function bounds() { return { start: Number($('wedgeStart').value), end: Number($('wedgeEnd').value) }; }
function project(p) {
  const r = canvas.getBoundingClientRect(), base = Math.min(r.width / 260, r.height / 250) * scale;
  return [r.width / 2 + panX + (p.x - 500) * base,
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
    areaLabels.push({tag:label,color,selected,point,center});
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
  for (const p of visible) {
    if (p.zone === 'unassigned') continue;
    const [x, y] = project(p);
    ctx.beginPath(); ctx.arc(x, y, p.id === selectedId ? 5 : Math.max(2, 2.5 * scale ** .3), 0, Math.PI * 2);
    ctx.fillStyle = p.role ? palette.team : p.highRisk ? palette.risk : p.attendanceProxy==='outside_capital_area' ? palette.absent : p.attendanceProxy==='unknown' ? palette.unknown : sectionColor(p.section);
    ctx.fill();
    if (p.locked) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  const highlights = [[targetKey, '#fff'],
    [selectedId != null && P.current(state,selectedId)?.zone !== 'unassigned' ? P.siteKey(P.current(state, selectedId)) : null, '#ffdf73']];
  for (const [key, color] of highlights) {
    const s = key && state.sites.get(key); if (!s) continue;
    const [x, y] = project(s);
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  }
  const labelBoxes=[];
  for (const {tag,color,selected,point,center} of areaLabels.sort((a,b)=>Number(b.selected)-Number(a.selected))) {
    ctx.font=`${selected?'bold 13':'11'}px system-ui`;
    const width=ctx.measureText(tag).width+10,height=20;
    let box;
    for (const radius of [102,86,70,54]) {
      const [x,y]=point(center,radius);
      box={x:Math.max(4,Math.min(r.width-width-4,x-width/2)),y:y-height/2,width,height};
      if (!labelBoxes.some(b=>box.x<b.x+b.width+3&&box.x+width+3>b.x&&box.y<b.y+b.height+3&&box.y+height+3>b.y)) break;
    }
    labelBoxes.push(box);
    ctx.fillStyle='#131e25';ctx.globalAlpha=.92;ctx.fillRect(box.x,box.y,width,height);ctx.globalAlpha=1;
    ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(tag,box.x+width/2,box.y+14);
  }
}
function render() {
  if (!state) return;
  const after = $('swapPreview').checked, q = $('search').value.toLocaleLowerCase();
  const section = $('section').value, zone = $('zone').value;
  visible = P.rows(state, after).filter(p =>
    (!q || `${p.name} ${p.tag} ${p.id}`.toLocaleLowerCase().includes(q)) &&
    (!section || p.section === section) && (!zone || (zone==='rear' ? P.rearReasons(p).length>0 : p.zone === zone)));
  const text = visible.length ? placementText() : '';
  if ($('placementText').value !== text) {
    $('placementText').value = text;
    $('copyStatus').textContent = '';
  }
  $('copyList').disabled = !visible.length;
  $('copyHint').textContent = `Copies all ${visible.length.toLocaleString()} players matching your filters as text for game chat.`;
  if (selectedId != null && !visible.some(p => p.id === selectedId)) selectedId = null;
  $('summary').textContent = `${visible.length.toLocaleString()} of ${state.players.size.toLocaleString()} players shown · ` +
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
    tr.onclick = () => { selectedId = p.id; render(); };
    body.append(tr);
  }
  $('listNote').textContent = visible.length > 500 ? 'Showing the first 500 players. Choose an alliance or search a name to narrow the list.' : '';
  $('waitingCount').textContent = P.rows(state).filter(p => p.zone === 'unassigned').length;
  const chosen = selectedId != null && P.current(state, selectedId);
  $('selectedPlayer').replaceChildren();
  if (chosen) {
    const lines = [['strong','',`${chosen.name} · HQ ${chosen.hq}`],
      ['span','coordinates',chosen.zone==='unassigned' ? 'Waiting for a spot' : `X ${chosen.x} · Y ${chosen.y}`],
      ['span','detail',`${chosen.tag || 'No alliance'} · ${chosen.zone === 'unassigned' ? 'Unassigned' : chosen.zone === 'mud' ? 'Mud front' : P.rearReasons(chosen).length && !chosen.locked ? 'Back grass' : 'Grass support'}${chosen.locked ? ' · Reserved' : ''}`],
      ['span','detail',`Hero power ${chosen.heroPower?.toLocaleString() || 'unknown'} · Total power ${chosen.totalPowerApproximate ? '≈ ' : ''}${chosen.totalPower?.toLocaleString() || 'unknown'}`]];
    if (chosen.totalPowerApproximate) lines.push(['span','detail','Total power is a rounded reading from the alliance roster.']);
    if (chosen.nameReadingStatus==='partial') lines.push(['span','detail','Name partly unreadable; check the saved roster card.']);
    if (P.rearReasons(chosen).length) lines.push(['span','detail rear-note',
      `${chosen.locked?'Prior SvS (manual reservation overrides automatic placement)':'Why back grass'}: ${P.rearReasons(chosen).join('; ')} · ${plan.meta.eventCaptured || '2026-09-26'}.`]);
    if (chosen.attendanceProxy==='unknown') lines.push(['span','detail unknown-note',
      'Prior SvS attendance unknown: no matched historical record. No back penalty for unknown attendance.']);
    for (const [tag,cl,text] of lines) { const el=document.createElement(tag);el.className=cl;el.textContent=text;$('selectedPlayer').append(el); }
    if (chosen.rosterPhoto) {
      const link=document.createElement('a');link.textContent='View roster card';
      link.href='https://samuelmm97.github.io/last-z-state-798-map/'+chosen.rosterPhoto;
      link.target='_blank';link.rel='noopener';$('selectedPlayer').append(link);
    }
  } else $('selectedPlayer').textContent = 'Choose a player to see their coordinates.';
  const target = targetKey && state.sites.get(targetKey), holder = target && P.playerAt(state, targetKey);
  $('targetInfo').textContent = target ? `Target: ${target.zone.toUpperCase()} X ${target.x}, Y ${target.y}` +
    `${target.spot ? ' · mud spot #' + target.spot : ''} · ${holder == null ? 'Open spot' : 'held by '+state.players.get(holder).name}` +
    `${state.locks.has(holder) ? ' (locked)' : ''}` : 'Click a map dot or enter a legal site’s X/Y.';
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
  draw(); renderCapacity();
}
function changeSummary(changes) {
  const parts = [['added', 'added to roster'], ['removed', 'removed from roster'],
    ['moved', 'moved'], ['locked', 'locked'], ['unlocked', 'unlocked'],
    ['paired', 'paired'], ['unpaired', 'unpaired'], ['boundaries', 'alliance areas changed']]
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
async function loadHistory(reset = true) {
  try {
    const before = reset || !historyEntries.length ? '' : `?before=${historyEntries.at(-1).revision}`;
    const r = await fetch(`${apiUrl}/api/placement/history${before}`, { cache: 'no-store' });
    if (!r.ok) throw Error(`History unavailable (${r.status})`);
    const data = await r.json();
    historyEntries = reset ? data.entries : historyEntries.concat(data.entries);
    $('moreHistory').dataset.hasMore = data.hasMore ? 'yes' : '';
    renderHistoryList();
  } catch (e) { $('historyDetail').textContent = e.message; }
}
async function showHistory(number) {
  try {
    const r = await fetch(`${apiUrl}/api/placement/history/${number}`, { cache: 'no-store' });
    if (!r.ok) throw Error(`Revision unavailable (${r.status})`);
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
    for (const id of entry.changes.locked) add(`${name(id)}: locked`);
    for (const id of entry.changes.unlocked) add(`${name(id)}: unlocked`);
    for (const pair of entry.changes.paired) add(`${name(pair.strike)} ⇄ ${name(pair.reserve)}: paired`);
    for (const pair of entry.changes.unpaired) add(`${name(pair.strike)} ⇄ ${name(pair.reserve)}: pair removed`);
    detail.append(list);
    $('restoreHistory').hidden = number === revision;
  } catch (e) { $('historyDetail').textContent = e.message; $('restoreHistory').hidden = true; }
}
async function loadShared(force = false) {
  if (!apiUrl) { message('Shared backend URL is not configured yet.'); return; }
  if (busy) { if (force) message('Wait for the current save to finish.'); return; }
  try {
    const r = await fetch(`${apiUrl}/api/placement`, { cache: 'no-store' });
    if (!r.ok) throw Error(`Shared plan unavailable (${r.status})`);
    const data = await r.json();
    if (busy) return;
    if (data.revision !== revision || force) {
      if (data.draft && data.draft.signature !== P.create(plan).signature) {
        const response = await fetch(`${apiUrl}/api/placement/plan?signature=${encodeURIComponent(data.draft.signature)}`, { cache: 'no-store' });
        if (!response.ok) throw Error('This revision’s roster could not be loaded.');
        usePlan((await response.json()).plan);
      }
      const next = P.create(plan);
      if (data.draft) P.importDraft(next, data.draft);
      state = next; revision = data.revision;
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
async function mutate(action) {
  if (!editMode) { message('Open Edit plan to make changes.'); return; }
  if (!editorKey) { message('Enter the shared editor key to make changes.'); return; }
  if (busy) { message('A change is still saving.'); return; }
  const before = P.exportDraft(state), baseRevision = revision;
  try {
    const detail = action();
    busy = true; render(); message('Saving to shared database…');
    const r = await fetch(`${apiUrl}/api/placement`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${editorKey}` },
      body: JSON.stringify({ baseRevision, draft: P.exportDraft(state),
        editor: $('editorName').value.trim() || 'Planner' }) });
    const data = await r.json();
    if (!r.ok) throw Error(r.status === 409 ? 'Another planner saved first; reloading their version. Retry your edit.'
      : data.error || `Save failed (${r.status})`);
    revision = data.revision; render();
    if (selectedHistory) $('restoreHistory').hidden = selectedHistory.revision === revision;
    loadHistory();
    message(`Saved version ${revision}${typeof detail === 'number' ? ` · ${detail} players updated` : typeof detail === 'string' ? ` · ${detail}` : ''}.`);
  } catch (e) {
    P.importDraft(state, before); render(); message(e.message);
    if (e.message.startsWith('Another planner')) { busy = false; await loadShared(true); }
  } finally { busy = false; }
}
function setTarget(key) {
  if (!state.sites.has(key)) throw Error('No legal plan site at those coordinates');
  targetKey = key;
  const s = state.sites.get(key); $('targetX').value = s.x; $('targetY').value = s.y;
  render();
}
function download(name, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function csv(after) {
  const columns = ['id', 'name', 'tag', 'hq', 'zone', 'x', 'y', 'ring', 'spot', 'role',
    'locked', 'shield', 'attendanceProxy', 'oldX', 'oldY'];
  const cell = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return '\ufeff' + columns.join(',') + '\r\n' +
    P.rows(state, after).map(p => columns.map(k => cell(p[k])).join(',')).join('\r\n');
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const r=canvas.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
  const handle=editMode && editorKey && !busy && boundaryHandles.find(h=>Math.hypot(h.x-x,h.y-y)<14);
  drag = { x:e.clientX,y:e.clientY,moved:false,handle:handle?.kind,original:bounds() };
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
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
  panX += dx; panY += dy; drag.x = e.clientX; drag.y = e.clientY; draw();
});
canvas.addEventListener('pointerup', e => {
  if (!drag) return;
  const moved=drag.moved,handle=drag.handle;drag=null;
  if(handle && moved){const b=bounds();mutate(()=>P.setSection(state,$('section').value,b.start,b.end));return;}
  if (moved) return;
  if ($('swapPreview').checked) { message('Switch to staging view to choose a site.'); return; }
  const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  let best = null, d = 12;
  for (const s of state.sites.values()) {
    const [px, py] = project(s), pd = Math.hypot(px - x, py - y);
    if (pd < d) { d = pd; best = s; }
  }
  if (best) {
    if(editMode)setTarget(P.siteKey(best));
    else { const holder=P.playerAt(state,P.siteKey(best));if(holder!=null){selectedId=holder;render();} }
  }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault(); scale = Math.max(.5, Math.min(10, scale * (e.deltaY < 0 ? 1.12 : .89))); draw();
}, { passive: false });
for (const id of ['search', 'section', 'zone', 'swapPreview'])
  $(id).addEventListener(id === 'search' ? 'input' : 'change', render);
for (const id of ['wedgeStart', 'wedgeEnd']) $(id).addEventListener('input',()=>{draw();renderCapacity();});
$('section').addEventListener('change',()=>{syncBoundary();render();});
$('resetView').onclick=()=>{scale=1;panX=panY=0;draw();};
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
$('saveBoundary').onclick=()=>mutate(()=>{const b=bounds();P.setSection(state,$('section').value,b.start,b.end);});
$('arrangeAlliance').onclick=()=>mutate(()=>{
  const b=bounds();P.setSection(state,$('section').value,b.start,b.end);
  const report=P.arrangeAlliance(state,$('section').value);
  return `${report.moved} players arranged${report.waiting ? ` · ${report.waiting} need a wider area` : ''}`;
});
$('clearMud').onclick=()=>mutate(()=>P.clear(state,{zone:'mud',includeLocked:!$('keepLocks').checked}));
$('clearArea').onclick=()=>mutate(()=>P.clear(state,{...bounds(),zone:'mud',includeLocked:!$('keepLocks').checked}));
$('unassignPlayer').onclick=()=>mutate(()=>{if(selectedId==null)throw Error('Choose a player first');P.unassign(state,selectedId);});
$('pushBack').onclick=()=>mutate(()=>`${P.pushBack(state,$('section').value)} placed in back grass · ${P.rows(state).filter(p=>p.zone==='unassigned').length} still waiting`);
$('findSite').onclick = () => {
  try { setTarget(`${Number($('targetX').value)},${Number($('targetY').value)}`); }
  catch (e) { message(e.message); }
};
$('lockPlayer').onclick = () => mutate(() => {
  if ($('swapPreview').checked) throw Error('Switch to staging view first');
  if (selectedId == null || !targetKey) throw Error('Choose both a player and a site');
  if (!P.inWedge(state.sites.get(targetKey), bounds().start, bounds().end))
    throw Error('Target site is outside the selected wedge');
  P.moveAndLock(state, selectedId, targetKey);
});
$('unlockPlayer').onclick = () => mutate(() => {
  if (selectedId == null) throw Error('Choose a player');
  if (state.pairs.some(p => p.strike === selectedId || p.reserve === selectedId))
    throw Error('Remove the swap pair before unlocking this player');
  state.locks.delete(selectedId);
});
$('fillWedge').onclick = () => mutate(() => P.fill(state, {
  ...bounds(), section: $('section').value, zone: $('zone').value, sections: plan.sections
}));
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
    const r = await fetch(`${apiUrl}/api/placement/restore`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${editorKey}` },
      body: JSON.stringify({ baseRevision: revision, sourceRevision,
        editor: $('editorName').value.trim() || 'Planner' }) });
    const data = await r.json();
    if (!r.ok) throw Error(r.status === 409 ? 'Another planner saved first; reload and try restoring again.'
      : data.error || `Restore failed (${r.status})`);
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
  const text = $('placementText').value, count = visible.length;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    $('copyStatus').textContent = `Copied ${count} players. Paste into game chat.`;
  } catch {
    $('copyPreview').open = true;
    $('placementText').focus();
    $('placementText').select();
    $('copyStatus').textContent = 'Select and copy the text below, then paste into game chat.';
  }
};
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
    message('Editing enabled. Changes save to the shared database.');
  } catch (e) { message(e.message); }
};
$('forgetEditor').onclick = () => {
  editorKey = '';
  $('editorKey').value = '';
  localStorage.removeItem('state798.editorKey');
  sessionStorage.removeItem('state798.editorKey');
  message('Editor key removed from this device.');
};

fetch('placement-plan.json').then(r => {
  if (!r.ok) throw Error('Plan could not be loaded'); return r.json();
}).then(data => {
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
}).catch(e => { $('summary').textContent = e.message; });
new ResizeObserver(size).observe(canvas);

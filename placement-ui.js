const $ = id => document.getElementById(id);
const P = PlacementPlanner;
const canvas = $('map'), ctx = canvas.getContext('2d');
const apiUrl = globalThis.PLACEMENT_API_URL || '';
const palette = { mud: '#efb86b', grass: '#7ad7c0', outside: '#abb0f5',
  risk: '#ef6f77', team: '#f9e37e' };
let plan, state, visible = [], selectedId = null, targetKey = null, pendingStrike = null;
let revision = 0, editorKey = '', busy = false, scale = 1, panX = 0, panY = 0, drag = null;

function message(value) { $('status').textContent = value; }
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
  const b = bounds();
  if (Number.isFinite(b.start) && Number.isFinite(b.end) && Math.abs(b.end - b.start) < 360) {
    const [cx, cy] = project({ x: 500, y: 500 });
    for (const deg of [b.start, b.end]) {
      const a = deg * Math.PI / 180;
      const [x, y] = project({ x: 500 + 120 * Math.sin(a), y: 500 - 120 * Math.cos(a) });
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = '#fff9'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  for (const p of visible) {
    const [x, y] = project(p);
    ctx.beginPath(); ctx.arc(x, y, p.id === selectedId ? 5 : Math.max(2, 2.5 * scale ** .3), 0, Math.PI * 2);
    ctx.fillStyle = p.role ? palette.team : p.highRisk ? palette.risk
      : p.attendanceProxy === 'outside_capital_area' ? palette.outside : palette[p.zone];
    ctx.fill();
    if (p.locked) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  const highlights = [[targetKey, '#fff'],
    [selectedId ? P.siteKey(P.current(state, selectedId)) : null, '#ffdf73']];
  for (const [key, color] of highlights) {
    const s = key && state.sites.get(key); if (!s) continue;
    const [x, y] = project(s);
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  }
}
function render() {
  if (!state) return;
  const after = $('swapPreview').checked, q = $('search').value.toLocaleLowerCase();
  const section = $('section').value, zone = $('zone').value;
  visible = P.rows(state, after).filter(p =>
    (!q || `${p.name} ${p.tag} ${p.id}`.toLocaleLowerCase().includes(q)) &&
    (!section || p.section === section) && (!zone || p.zone === zone));
  $('summary').textContent = `${visible.length.toLocaleString()} of ${state.players.size.toLocaleString()} players shown · ` +
    `${state.locks.size} locked · ${state.pairs.length} swap pairs · revision ${revision}` +
    (after ? ' · POST-SWAP PREVIEW' : '');
  const body = $('rows'); body.replaceChildren();
  for (const p of visible.slice(0, 500)) {
    const tr = document.createElement('tr');
    if (p.id === selectedId) tr.className = 'active';
    for (const value of [p.hq, `${p.locked ? '🔒 ' : ''}${p.name}${p.role ? ' · ' + p.role : ''}`,
      p.tag || '—', `${p.x}, ${p.y}`]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    tr.onclick = () => { selectedId = p.id; render(); };
    body.append(tr);
  }
  const chosen = selectedId && P.current(state, selectedId);
  $('selectedPlayer').textContent = chosen ? `${chosen.name} · HQ ${chosen.hq} · ${chosen.tag || 'No tag'} · ` +
    `${chosen.zone.toUpperCase()} X ${chosen.x}, Y ${chosen.y}${chosen.locked ? ' · locked' : ''}`
    : 'Select a player from the list.';
  const target = targetKey && state.sites.get(targetKey), holder = target && P.playerAt(state, targetKey);
  $('targetInfo').textContent = target ? `Target: ${target.zone.toUpperCase()} X ${target.x}, Y ${target.y}` +
    `${target.spot ? ' · mud spot #' + target.spot : ''} · held by ${state.players.get(holder).name}` +
    `${state.locks.has(holder) ? ' (locked)' : ''}` : 'Click a map dot or enter a legal site’s X/Y.';
  $('pendingStrike').textContent = pendingStrike ? `Pending strike: ${state.players.get(pendingStrike).name}` : '';
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
  draw();
}
async function loadShared(force = false) {
  if (!apiUrl) { message('Shared backend URL is not configured yet.'); return; }
  if (busy && !force) return;
  try {
    const r = await fetch(`${apiUrl}/api/placement`, { cache: 'no-store' });
    if (!r.ok) throw Error(`Shared plan unavailable (${r.status})`);
    const data = await r.json();
    if (data.revision !== revision || force) {
      const next = P.create(plan);
      if (data.draft) P.importDraft(next, data.draft);
      state = next; revision = data.revision; render();
      message(data.revision ? `Shared revision ${revision} by ${data.updatedBy} loaded.`
        : 'Shared plan is ready. No edits yet.');
    }
  } catch (e) { message(e.message); }
}
async function mutate(action) {
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
    message(`Saved revision ${revision}${typeof detail === 'number' ? ` · ${detail} positions updated` : ''}.`);
  } catch (e) {
    P.importDraft(state, before); render(); message(e.message);
    if (e.message.startsWith('Another planner')) await loadShared(true);
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
  canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: false };
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  panX += dx; panY += dy; drag.x = e.clientX; drag.y = e.clientY; draw();
});
canvas.addEventListener('pointerup', e => {
  if (!drag) return;
  const moved = drag.moved; drag = null; if (moved) return;
  if ($('swapPreview').checked) { message('Switch to staging view to choose a site.'); return; }
  const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  let best = null, d = 12;
  for (const s of state.sites.values()) {
    const [px, py] = project(s), pd = Math.hypot(px - x, py - y);
    if (pd < d) { d = pd; best = s; }
  }
  if (best) setTarget(P.siteKey(best));
});
canvas.addEventListener('wheel', e => {
  e.preventDefault(); scale = Math.max(.5, Math.min(10, scale * (e.deltaY < 0 ? 1.12 : .89))); draw();
}, { passive: false });
for (const id of ['search', 'section', 'zone', 'swapPreview'])
  $(id).addEventListener(id === 'search' ? 'input' : 'change', render);
for (const id of ['wedgeStart', 'wedgeEnd']) $(id).addEventListener('input', draw);
$('findSite').onclick = () => {
  try { setTarget(`${Number($('targetX').value)},${Number($('targetY').value)}`); }
  catch (e) { message(e.message); }
};
$('lockPlayer').onclick = () => mutate(() => {
  if ($('swapPreview').checked) throw Error('Switch to staging view first');
  if (!selectedId || !targetKey) throw Error('Choose both a player and a site');
  if (!P.inWedge(state.sites.get(targetKey), bounds().start, bounds().end))
    throw Error('Target site is outside the selected wedge');
  P.moveAndLock(state, selectedId, targetKey);
});
$('unlockPlayer').onclick = () => mutate(() => {
  if (!selectedId) throw Error('Choose a player');
  if (state.pairs.some(p => p.strike === selectedId || p.reserve === selectedId))
    throw Error('Remove the swap pair before unlocking this player');
  state.locks.delete(selectedId);
});
$('fillWedge').onclick = () => mutate(() => P.fill(state, {
  ...bounds(), section: $('section').value, zone: $('zone').value, sections: plan.sections
}));
$('markStrike').onclick = () => {
  const p = selectedId && P.current(state, selectedId);
  if (!p || p.zone !== 'grass') { message('Choose a grass player first.'); return; }
  pendingStrike = selectedId; render();
};
$('pairReserve').onclick = () => mutate(() => {
  if (!pendingStrike || !selectedId) throw Error('Mark a strike player, then choose a mud reserve');
  P.addPair(state, pendingStrike, selectedId); pendingStrike = null;
});
$('reloadShared').onclick = () => loadShared(true);
$('exportCurrent').onclick = () => download('state-798-staging.csv', csv(false));
$('exportSwap').onclick = () => download('state-798-post-swap.csv', csv(true));
$('connectEditor').onclick = async () => {
  const key = $('editorKey').value.trim();
  if (!key) { message('Enter the shared editor key.'); return; }
  try {
    const r = await fetch(`${apiUrl}/api/editor-check`, { method: 'POST',
      headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw Error('Editor key was rejected');
    editorKey = key; sessionStorage.setItem('state798.editorKey', key);
    localStorage.setItem('state798.editorName', $('editorName').value.trim());
    message('Editing enabled. Changes save to the shared database.');
  } catch (e) { message(e.message); }
};

fetch('placement-plan.json').then(r => {
  if (!r.ok) throw Error('Plan could not be loaded'); return r.json();
}).then(data => {
  plan = data; state = P.create(plan);
  for (const tag of Object.keys(data.sections)) {
    const option = document.createElement('option'); option.value = tag;
    option.textContent = `${tag} (${data.sections[tag].players})`; $('section').append(option);
  }
  $('editorName').value = localStorage.getItem('state798.editorName') || '';
  $('editorKey').value = sessionStorage.getItem('state798.editorKey') || '';
  $('explain').textContent = 'Shared plan: lock manual edge placements, then refill unlocked sites in your wedge. ' +
    'Strike players stage in grass; paired reserves hold mud spots until the planned swap.';
  render(); size(); loadShared(true);
  if ($('editorKey').value) $('connectEditor').click();
  setInterval(() => { if (!document.hidden && !busy) loadShared(); }, 10000);
}).catch(e => { $('summary').textContent = e.message; });
new ResizeObserver(size).observe(canvas);

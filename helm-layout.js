const H = id => document.getElementById(id);
const format = value => value == null ? '—' : value.toLocaleString();
const combatOrder = (a, b) => (b.heroPower ?? -1) - (a.heroPower ?? -1) ||
  (b.totalPower ?? -1) - (a.totalPower ?? -1) || b.hq - a.hq || a.id - b.id;
const svgElement = (tag, attrs = {}, content) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (content != null) element.textContent = content;
  return element;
};

function drawLayout(rows, terrain) {
  const svg = svgElement('svg', { viewBox: '0 0 800 760', role: 'img',
    'aria-label': `Helm ${terrain} map; markers match the coordinate table` });
  const xs = rows.map(p => p.x).concat(500), ys = rows.map(p => p.y).concat(500);
  let minX = Math.min(...xs) - 8, maxX = Math.max(...xs) + 8;
  let minY = Math.min(...ys) - 8, maxY = Math.max(...ys) + 8;
  const scale = Math.min(710 / (maxX - minX), 650 / ((maxY - minY) * .8));
  const project = p => [45 + (p.x - minX) * scale, 50 + (p.y - minY) * scale * .8];
  for (const [radius, fill] of [[120, '#284e3a'], [35, '#66503c'], [18, '#412f2c']]) {
    const vertices = [[1, 0], [.5, 1], [-.5, 1], [-1, 0], [-.5, -1], [.5, -1]];
    const points = vertices.map(([x, y]) => project({ x: 500 + radius * x, y: 500 + radius * y }).join(',')).join(' ');
    svg.append(svgElement('polygon', { points, fill, stroke: '#8e9e91', 'stroke-width': 1 }));
  }
  const [cx, cy] = project({ x: 500, y: 500 });
  svg.append(svgElement('text', { x: cx, y: cy, fill: '#e2d0ae', 'font-size': 16, 'text-anchor': 'middle' }, 'CAPITAL'));
  svg.append(svgElement('text', { x: 25, y: 26, fill: '#dbedf2', 'font-size': 14 }, 'N ↑ · West ←'));
  const points = rows.map(project);
  let spacing = Infinity;
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++)
    spacing = Math.min(spacing, Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]));
  const markerRadius = Math.max(5, Math.min(12, spacing / 2 - 1));
  for (const row of rows) {
    const [x, y] = project(row);
    const group = svgElement('g', { tabindex: 0, role: 'button', 'aria-label': `${row.marker}, ${row.name}, HQ${row.hq}, X${row.x} Y${row.y}` });
    group.append(svgElement('title', {}, `${row.marker} ${row.name} · HQ${row.hq} · ${row.x},${row.y}${PlacementPlanner.rearReasons(row).length ? ' · Back priority: '+PlacementPlanner.rearReasons(row).join('; ') : ''}`));
    group.append(svgElement('circle', { cx: x, cy: y, r: markerRadius,
      fill: row.highRisk ? '#ef8d94' : row.attendanceProxy==='outside_capital_area' ? '#f3b65e' : terrain === 'mud' ? '#f4c884' : '#8fe4d5', stroke: '#182321', 'stroke-width': 2 }));
    group.append(svgElement('text', { x, y: y + 4, 'text-anchor': 'middle', fill: '#152320',
      'font-size': Math.min(10, markerRadius * 1.1), 'font-weight': 800 }, row.marker.slice(1)));
    const select = () => {
      document.querySelectorAll('.picked').forEach(el => el.classList.remove('picked'));
      const tableRow = H(`helm-row-${row.id}`); tableRow.classList.add('picked');
      tableRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    group.onclick = select;
    group.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } };
    svg.append(group);
  }
  H(`${terrain}Map`).replaceChildren(svg);
}

function table(rows, terrain) {
  const table = document.createElement('table'), head = table.createTHead().insertRow();
  for (const name of ['Mark', 'HQ / player', 'Total hero power', 'Total power', 'X, Y']) {
    const th = document.createElement('th'); th.textContent = name; head.append(th);
  }
  const body = table.createTBody();
  for (const p of rows) {
    const tr = body.insertRow(); tr.id = `helm-row-${p.id}`;
    const mark = tr.insertCell(); mark.className = 'key'; mark.textContent = p.marker;
    const name = tr.insertCell();
    const link = document.createElement('a'); link.href = `placement.html?alliance=Helm&player=${p.id}`;
    link.textContent = `HQ${p.hq} · ${p.name}${p.role ? ` · ${p.role}` : ''}`; name.append(link);
    if (p.highRisk || p.attendanceProxy !== 'inside_capital_area') {
      const note = document.createElement('div'); note.className = p.highRisk ? 'note risk' : 'note';
      note.textContent = PlacementPlanner.rearReasons(p).length ?
        'Back priority: '+PlacementPlanner.rearReasons(p).join('; ') : 'Attendance unknown · no matched historical record';
      name.append(note);
    }
    tr.insertCell().textContent = format(p.heroPower);
    tr.insertCell().textContent = format(p.totalPower);
    const coordinate = tr.insertCell(); coordinate.className = 'coordinate'; coordinate.textContent = `${p.x}, ${p.y}`;
  }
  H(`${terrain}Table`).replaceChildren(table);
}

async function loadLayout() {
  try {
    let plan = await fetch('placement-plan.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw Error('Base plan unavailable'); return r.json(); });
    const shared = await fetch(`${PLACEMENT_API_URL}/api/placement`, { cache: 'no-store' }).then(r => { if (!r.ok) throw Error('Shared plan unavailable'); return r.json(); });
    if (shared.draft && shared.draft.signature !== PlacementPlanner.create(plan).signature) {
      const response = await fetch(`${PLACEMENT_API_URL}/api/placement/plan?signature=${encodeURIComponent(shared.draft.signature)}`, { cache: 'no-store' });
      if (!response.ok) throw Error('Roster snapshot unavailable'); plan = (await response.json()).plan;
    }
    const state = PlacementPlanner.create(plan);
    if (shared.draft) PlacementPlanner.importDraft(state, shared.draft);
    const helm = PlacementPlanner.rows(state).filter(p => p.tag === 'Helm');
    if (plan.meta.leadershipMudBoundaries) H('layoutNote').textContent = 'Helm holds the west-to-northwest mud area assigned by leadership (270°–308°). Mud positions are compact and ranked by hero power, total power, then HQ; remaining members support from nearby grass. Confirmed prior absences and unshielded players stage in back grass. Unknown attendance has no back penalty. Match each marker to its row for coordinates.';
    else if (plan.meta.helmCenterDegrees === 315) H('layoutNote').textContent = 'Helm groups near 315° around Turret 2. Confirmed prior absences and unshielded players stage in back grass; their rows explain why. Unknown attendance is labeled and receives no back penalty. Match each marker to its row for coordinates. Mud uses total hero power, total power, then HQ. Grass uses HQ within the previous SvS priority groups. Manual strike and reserve assignments remain in place.';
    const mud = helm.filter(p => p.zone === 'mud').sort(combatOrder);
    const grass = helm.filter(p => p.zone === 'grass').sort((a, b) => a.priority - b.priority || b.hq - a.hq || a.id - b.id);
    for (const [terrain, rows, prefix] of [['mud', mud, 'M'], ['grass', grass, 'G']]) {
      rows.forEach((p, index) => p.marker = prefix + String(index + 1).padStart(2, '0'));
      H(`${terrain}Title`).textContent = `${terrain === 'mud' ? 'Mud front' : 'Grass support'} · ${rows.length} HQs`;
      table(rows, terrain); drawLayout(rows, terrain);
    }
    const waiting=helm.filter(p=>p.zone==='unassigned').length;
    H('snapshot').textContent = `Shared version ${shared.revision} · Roster/power ${plan.meta.powerCaptured || plan.meta.capturedDate || 'September 2026'} · Shield/attendance ${plan.meta.eventCaptured || '2026-09-26'}${waiting ? ` · ${waiting} Helm players waiting for a spot` : ''}`;
  } catch (error) { H('snapshot').textContent = error.message; }
}
loadLayout();

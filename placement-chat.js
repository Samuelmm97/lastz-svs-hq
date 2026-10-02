/* Plain text messages sized for game chat; each player stays on one line. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PlacementChat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const clean = value => String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  const bytes = text => new TextEncoder().encode(text).length;
  function messages(rows, { section = '', revision = 0, afterSwap = false, limit = 900 } = {}) {
    if (!rows.length) return [];
    const heading = `${clean(section) || 'All alliances'}`;
    const header = (part, total, label) => `${heading} ${part}/${total} - v${revision}${afterSwap ? ' - After swaps' : ''}\n${label}\n`;
    const parts = [];
    for (const [zone, label] of [['mud', 'Mud'], ['grass', 'Grass'], ['unassigned', 'Waiting for a spot']]) {
      // At most one message per player. Reserve room for the largest possible part number.
      const capacity = limit - bytes(header(rows.length, rows.length, label));
      let lines = [];
      const flush = () => {
        if (lines.length) parts.push({ zone, label, lines, players: lines.length });
        lines = [];
      };
      for (const p of rows.filter(p => p.zone === zone)) {
        const alliance = !section || section === 'Other' ? `[${clean(p.tag) || 'No alliance'}] ` : '';
        const role = p.role ? ` (${p.role})` : '';
        const line = `${alliance}${clean(p.name)}${role}: ${zone === 'unassigned' ? 'Waiting' : `X${p.x} Y${p.y}`}`;
        if (bytes(line) > capacity) throw Error('A player name is too long for this message size. Choose Standard size or narrow the list.');
        if (bytes([...lines, line].join('\n')) > capacity) flush();
        lines.push(line);
      }
      flush();
    }
    return parts.map((part, i) => ({ zone: part.zone, label: part.label, players: part.players,
      text: header(i + 1, parts.length, part.label) + part.lines.join('\n') }));
  }
  return { messages };
});

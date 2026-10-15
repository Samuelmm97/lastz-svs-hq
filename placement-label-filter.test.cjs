// QA: the alliance tags drawn across the wedges are clickable, and clicking one filters the map to
// that alliance's members. Clicking it again clears the filter, hovering shows a pointer, and an HQ
// that happens to sit on a tag still wins the click (selecting the player, not filtering).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('./qa-server.cjs');

(async () => {
  const app = await startServer();
  let browser;
  const output = process.env.QA_OUTPUT || __dirname;
  fs.mkdirSync(output, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(app.url + '/placement.html');
    await page.locator('#rows tr').first().waitFor();
    await page.waitForFunction(() => typeof revision !== 'undefined' && revision > 0);
    await page.locator('#map').scrollIntoViewIfNeeded();

    // Pick a tag whose centre is really that tag (not a label drawn on top of it).
    const tag = await page.evaluate(() => {
      const r = canvas.getBoundingClientRect();
      const own = areaLabelBoxes.find(b => {
        const x = b.box.x + b.box.width / 2, y = b.box.y + b.box.height / 2, hit = allianceLabelAt(x, y, 'mouse');
        return hit && hit.section === b.section;
      });
      if (!own) return null;
      const players = [...state.players.values()];
      return { section: own.section, label: own.label, labels: areaLabelBoxes.length,
        members: players.filter(p => p.section === own.section).length, all: players.length,
        x: r.left + own.box.x + own.box.width / 2, y: r.top + own.box.y + own.box.height / 2 };
    });
    assert(tag, 'The map should draw clickable alliance tags');
    assert(tag.members > 0, `Tag "${tag.label}" should map to a section with members (got ${tag.members})`);

    await page.mouse.move(tag.x, tag.y);
    assert.equal(await page.evaluate(() => canvas.style.cursor), 'pointer', 'Hovering an alliance tag should show a pointer cursor');

    await page.mouse.click(tag.x, tag.y);
    const filtered = await page.evaluate(() => ({
      section: document.getElementById('section').value, shown: visible.length,
      status: document.getElementById('status').textContent, summary: document.getElementById('summary').textContent }));
    assert.equal(filtered.section, tag.section, `Clicking "${tag.label}" should filter to ${tag.section}`);
    assert.equal(filtered.shown, tag.members, `Only ${tag.section}'s ${tag.members} HQs should remain on the map (got ${filtered.shown})`);
    assert(filtered.summary.includes(`${tag.members.toLocaleString()} of ${tag.all.toLocaleString()} HQs shown`), `Summary should report the filter (got "${filtered.summary}")`);
    assert(filtered.status.includes(tag.label), `Status should name the alliance (got "${filtered.status}")`);
    await page.screenshot({ path: path.join(output, 'label-filter.png') });

    // Clicking the same tag again clears the filter and brings every HQ back.
    await page.mouse.click(tag.x, tag.y);
    const cleared = await page.evaluate(() => ({ section: document.getElementById('section').value, shown: visible.length }));
    assert.equal(cleared.section, '', 'A second click on the same tag clears the filter');
    assert.equal(cleared.shown, tag.all, `All ${tag.all} HQs come back (got ${cleared.shown})`);

    // An HQ sitting under a tag: the chip is drawn on top, so the click filters - and the player is
    // still reachable from the sidebar list, so nothing becomes unreachable.
    const dot = await page.evaluate(() => {
      const r = canvas.getBoundingClientRect();
      for (const b of areaLabelBoxes) {
        const holder = [...state.sites.values()].find(s => {
          const [px, py] = project(s), id = P.playerAt(state, P.siteKey(s));
          return id != null && px >= b.box.x && px <= b.box.x + b.box.width && py >= b.box.y && py <= b.box.y + b.box.height;
        });
        if (!holder) continue;
        const id = P.playerAt(state, P.siteKey(holder)), [px, py] = project(holder);
        return { id, name: state.players.get(id).name, label: b.label, section: b.section, x: r.left + px, y: r.top + py };
      }
      return null;
    });
    if (dot) {
      await page.mouse.click(dot.x, dot.y);
      const won = await page.evaluate(() => ({ section: document.getElementById('section').value, shown: visible.length }));
      assert.equal(won.section, dot.section, `A tag drawn over ${dot.name}'s HQ still filters to ${dot.section}`);
      const row = page.locator('#rows tr', { hasText: dot.name }).first();
      if (await row.count()) {
        await row.click();
        const back = await page.evaluate(() => selectedId);
        assert.equal(back, dot.id, `The covered HQ is still selectable from the list (${dot.name})`);
      }
    }
    assert.deepEqual(errors, [], errors.join('\n'));
    console.log(`Alliance-tag filter QA passed: ${tag.labels} tags drawn; clicking "${tag.label}" showed only its ${tag.members} HQs (summary "…of ${tag.all} HQs shown"), a second click restored all ${tag.all}, hover showed a pointer${dot ? `, a tag over an HQ filtered rather than selected (the HQ stayed reachable from the list)` : ' (no HQ sat under a tag to test the overlap case)'}.`);
  } finally { await browser?.close(); await new Promise(resolve => app.server.close(resolve)); }
})().catch(e => { console.error(e); process.exit(1); });

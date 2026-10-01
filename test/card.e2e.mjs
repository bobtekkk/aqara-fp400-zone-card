// Drives the FP400 zone card in test/preview.html with real mouse and keyboard input.
// Run: npm run e2e   (ONLY=A,C to pick scenarios). Needs Playwright's Chromium in ~/.cache/ms-playwright
// (npx playwright-core install chromium-headless-shell). Nothing here talks to Home Assistant.
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
    const file = join(root, new URL(req.url, 'http://local').pathname);
    try {
        if (!file.startsWith(root)) throw new Error('outside');
        const body = await readFile(file);
        res.writeHead(200, {'content-type': extname(file) === '.html' ? 'text/html' : 'text/javascript'}).end(body);
    } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const BASE = process.env.BASE ?? `http://127.0.0.1:${server.address().port}/test/preview.html`;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
let failures = 0, passes = 0;
function check(name, ok, detail) {
    ok ? passes++ : failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      → ' + JSON.stringify(detail)}`);
}

const browser = await chromium.launch();
async function open(query = '', options = {}) {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, ...options});
    page.errors = [];
    page.on('pageerror', e => page.errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
    await page.goto(BASE + query);
    await page.waitForFunction(() => document.querySelector('fp400-zone-card')?.loaded?.size === 8);
    // A fixed view so world coordinates below are always on screen.
    await page.evaluate(() => { const c = document.querySelector('fp400-zone-card'); c.view = {x: -400, y: -50, width: 800, height: 900}; c.render(); });
    return page;
}
const btn = (page, action) => page.locator(`fp400-zone-card [data-action="${action}"]`);
async function screen(page, x, y) {
    return page.evaluate(([x, y]) => {
        const svg = document.querySelector('fp400-zone-card').shadowRoot.querySelector('svg');
        const p = svg.createSVGPoint(); p.x = x; p.y = -y;
        const s = p.matrixTransform(svg.getScreenCTM()), r = svg.getBoundingClientRect();
        if (s.x < r.left || s.x > r.right || s.y < r.top || s.y > r.bottom) throw new Error(`world ${x},${y} is off screen`);
        return {x: s.x, y: s.y};
    }, [x, y]);
}
async function drag(page, from, to, opts = {}) {
    const a = await screen(page, ...from), b = await screen(page, ...to);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, {steps: 10});
    if (opts.back) await page.mouse.move(a.x + 2, a.y + 1, {steps: 10});
    if (opts.escapeBeforeUp) await page.keyboard.press('Escape');
    await page.mouse.up();
}
async function clickAt(page, x, y) { const p = await screen(page, x, y); await page.mouse.click(p.x, p.y); }
// A human-length press: 120 ms between mouse down and up.
async function slowClick(locator, page) {
    let box = null;
    for (let i = 0; i < 50 && !box; i++) box = await locator.boundingBox({timeout: 1000}).catch(() => null);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
}
const st = page => page.evaluate(() => {
    const c = document.querySelector('fp400-zone-card'), r = c.shadowRoot, q = s => r.querySelector(s);
    return {
        mode: c.mode, selected: c.selected, saving: c.saving, target: c.target, panel: c.panel, areaType: c.areaType, areaTool: c.areaTool,
        pending: (c.pendingAreas ?? []).map(o => [o.rect.x_min, o.rect.x_max, o.rect.y_min, o.rect.y_max]),
        ops: (c.pendingAreas ?? []).map(o => `${o.type}:${o.op}`),
        pendingClear: c.pendingClears.size > 0,
        dashed: r.querySelectorAll('#pending-areas rect.area-pending').length,
        cells: r.querySelectorAll('#areas rect.area-cell:not(.gone)').length,
        gone: r.querySelectorAll('#areas rect.area-cell.gone').length,
        areasLabel: q('[data-action="areas"]').textContent.trim(),
        areasActive: q('[data-action="areas"]').classList.contains('active'),
        areasDisabled: q('[data-action="areas"]').disabled,
        drawLabel: q('[data-action="draw"]').textContent.trim(),
        saveLabel: q('[data-action="save"]').textContent.trim(),
        saveDisabled: q('[data-action="save"]').disabled,
        discardDisabled: q('[data-action="discard"]').disabled,
        message: q('#message').textContent.trim(),
        inspector: q('#inspector').textContent.replace(/\s+/g, ' ').trim(),
        view: {...c.view},
    };
});
const AREA_KEY = /_(interference|entry_exit|edge)_(zone_add|zone_remove|clear)$/;
const sim = page => page.evaluate(key => {
    const c = document.querySelector('fp400-zone-card'), mask = t => c._hass.states[`sensor.0x54ef440000000001_${t}_mask_hex`]?.state;
    return {
        calls: window.__sim.calls.filter(x => new RegExp(key).test(x.entity_id)).map(x => `${x.entity_id.match(new RegExp(key)).slice(1).join('_')}=${x.value}`),
        mask: mask('interference'), entry: mask('entry_exit'), edge: mask('edge'),
    };
}, AREA_KEY.source);
const calls = page => page.evaluate(() => window.__sim.calls.filter(c => !/_(interference|entry_exit|edge)_/.test(c.entity_id)).map(c => ({...c, entity_id: c.entity_id.replace('0x54ef440000000001_', '')})));
const waitIdle = (page, ms = 25000) => page.waitForFunction(() => !document.querySelector('fp400-zone-card').saving, null, {timeout: ms});
const waitMessage = (page, re, ms = 10000) => page.waitForFunction(src => new RegExp(src).test(document.querySelector('fp400-zone-card').shadowRoot.querySelector('#message').textContent), re.source, {timeout: ms});
function bitsOf(rects) {
    const set = new Set();
    for (const [x0, x1, y0, y1] of rects) {
        for (let row = Math.max(0, Math.floor(y0 / 50)); row <= Math.min(19, Math.ceil(y1 / 50) - 1); row++)
            for (let col = Math.max(0, 8 - Math.ceil(x1 / 50)); col <= Math.min(15, 7 - Math.floor(x0 / 50)); col++) set.add(row * 16 + col);
    }
    return set;
}
function maskSet(hex) {
    const set = new Set();
    for (let bit = 0; bit < 320; bit++) if (parseInt(hex.substr((bit >> 3) * 2, 2), 16) & (0x80 >> (bit % 8))) set.add(bit);
    return set;
}
const sameBits = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const noErrors = (tag, page) => check(`${tag} no page errors`, page.errors.length === 0, page.errors);
const typeBtn = (page, type) => page.locator(`fp400-zone-card .area-type[data-type="${type}"]`);
const toolBtn = (page, tool) => page.locator(`fp400-zone-card [data-action="area-tool"][data-tool="${tool}"]`);
const setting = (page, key) => page.locator(`fp400-zone-card [data-setting$="_${key}"]`);
// The box (x_min, x_max, y_min, y_max) covered by the drawn cells of one area type.
const cellBox = (page, type) => page.evaluate(type => {
    const cs = [...document.querySelector('fp400-zone-card').shadowRoot.querySelectorAll(`#areas rect.area-cell[data-type="${type}"]:not(.gone)`)].map(r => ({x: +r.getAttribute('x'), y: -r.getAttribute('y') - 50}));
    return cs.length ? [Math.min(...cs.map(c => c.x)), Math.max(...cs.map(c => c.x + 50)), Math.min(...cs.map(c => c.y)), Math.max(...cs.map(c => c.y + 50))] : null;
}, type);

const scenarios = {
    async A() { // drawn and then cancelled: nothing stays behind
        const page = await open();
        await btn(page, 'areas').click();
        let s = await st(page);
        check('A1 Areas opens the area tool on Ignore spot', s.mode === 'areas' && s.areasActive && s.areaType === 'interference', s);
        await drag(page, [-300, 250], [-150, 400]);
        s = await st(page);
        check('A2 the drawn area shows as pending', s.dashed === 1 && s.cells === 9, s);
        await btn(page, 'areas').click();
        s = await st(page);
        check('A3 Cancel removes the drawn area from the map', s.dashed === 0 && s.pending.length === 0 && s.cells === 0, s);
        check('A4 Cancel closes the tool and resets the button', s.mode === 'select' && !s.areasActive && /Areas/.test(s.areasLabel) && !/Cancel/.test(s.areasLabel), s);
        check('A5 nothing left to save or discard', s.saveDisabled && s.discardDisabled, s);
        check('A6 nothing was sent to the sensor', (await sim(page)).calls.length === 0, await sim(page));
        noErrors('A7', page); await page.close();
    },
    async B() { // Escape
        const page = await open();
        await btn(page, 'areas').click();
        await drag(page, [-300, 250], [-150, 400]);
        await page.keyboard.press('Escape');
        let s = await st(page);
        check('B1 Esc after drawing cancels like the button', s.dashed === 0 && s.mode === 'select', s);
        await btn(page, 'areas').click();
        await drag(page, [-300, 250], [-150, 400], {escapeBeforeUp: true});
        s = await st(page);
        check('B2 Esc during a drag drops only that drag', s.dashed === 0 && s.mode === 'areas', s);
        await page.keyboard.press('Escape');
        s = await st(page);
        check('B3 a second Esc closes the area tool', s.mode === 'select' && !s.areasActive, s);
        noErrors('B4', page); await page.close();
    },
    async C() { // click to remove one area, then save exactly the rest
        const page = await open('?latency=150');
        await btn(page, 'areas').click();
        await drag(page, [-350, 100], [-250, 200]);
        await drag(page, [200, 500], [300, 650]);
        let s = await st(page);
        check('C1 two areas pending', s.dashed === 2, s);
        await clickAt(page, -300, 150);
        s = await st(page);
        check('C2 clicking a dashed area removes only that area', s.pending.length === 1 && JSON.stringify(s.pending[0]) === '[200,300,500,650]' && s.mode === 'areas', s);
        await btn(page, 'save').click(); await waitIdle(page);
        s = await st(page);
        const x = await sim(page);
        check('C3 the sensor gets exactly the remaining area', sameBits(maskSet(x.mask), bitsOf([[200, 300, 500, 650]])), x);
        check('C4 after Save the tool closes and buttons reset', s.mode === 'select' && !s.areasActive && /Areas/.test(s.areasLabel) && s.saveDisabled && s.dashed === 0, s);
        check('C5 red cells are drawn on the saved spot (6 cells)', s.cells === 6, s);
        const box = await cellBox(page, 'interference');
        check('C6 red cells sit exactly where the area was drawn', JSON.stringify(box) === '[200,300,500,650]', box);
        noErrors('C7', page); await page.close();
    },
    async D() { // drag out and back to the start
        const page = await open();
        await btn(page, 'areas').click();
        await drag(page, [-200, 300], [0, 500], {back: true});
        const s = await st(page);
        check('D1 dragging back to the start draws nothing', s.dashed === 0 && s.pending.length === 0 && s.mode === 'areas', s);
        noErrors('D2', page); await page.close();
    },
    async E() { // an area reaching behind the sensor is trimmed to the grid
        const page = await open('?latency=100');
        await btn(page, 'areas').click();
        await drag(page, [100, -40], [250, 150]);
        let s = await st(page);
        check('E1 the area is trimmed to the sensor grid (y ≥ 0)', s.pending.length === 1 && s.pending[0][2] === 0, s);
        await btn(page, 'save').click(); await waitIdle(page);
        const x = await sim(page);
        check('E2 saved cells match the trimmed area', sameBits(maskSet(x.mask), bitsOf([[100, 250, 0, 150]])), x);
        noErrors('E3', page); await page.close();
    },
    async F() { // Clear all waits for Save and can be undone
        const page = await open('?latency=100');
        await btn(page, 'areas').click(); await drag(page, [-350, 300], [-200, 450]);
        await btn(page, 'save').click(); await waitIdle(page);
        let s = await st(page);
        check('F0 seeded cells present', s.cells === 9, s);
        await page.evaluate(() => { window.__sim.calls.length = 0; });
        await btn(page, 'areas').click();
        await btn(page, 'clear-area').click();
        s = await st(page); let x = await sim(page);
        check('F1 Clear all does not touch the sensor before Save, and fades the cells', x.calls.length === 0 && s.pendingClear && !s.saveDisabled && s.gone === 9 && s.cells === 0, {s, x});
        await btn(page, 'clear-area').click();
        s = await st(page);
        check('F2 Undo clear returns to the saved state', !s.pendingClear && s.saveDisabled && s.cells === 9, s);
        await btn(page, 'clear-area').click();
        await btn(page, 'save').click(); await waitIdle(page);
        s = await st(page); x = await sim(page);
        check('F3 Save clears every cell', /^0+$/.test(x.mask) && s.cells === 0 && s.gone === 0 && !s.pendingClear, {s, x});
        noErrors('F4', page); await page.close();
    },
    async G() { // Discard
        const page = await open();
        await btn(page, 'areas').click(); await drag(page, [-300, 250], [-150, 400]);
        await btn(page, 'discard').click();
        const s = await st(page);
        check('G1 Discard drops pending areas and closes the tool', s.dashed === 0 && s.cells === 0 && s.mode === 'select' && !s.areasActive, s);
        noErrors('G2', page); await page.close();
    },
    async H() { // plain click while drawing a zone
        const page = await open();
        await btn(page, 'draw').click();
        await clickAt(page, 250, 600);
        let s = await st(page);
        check('H1 a plain click in draw mode keeps draw mode', s.mode === 'draw' && /Cancel draw/.test(s.drawLabel), s);
        await btn(page, 'draw').click();
        s = await st(page);
        check('H2 Cancel draw returns to select with nothing added', s.mode === 'select' && s.saveDisabled, s);
        noErrors('H3', page); await page.close();
    },
    async I() { // zone list clicks while live data streams in
        const page = await open('?tick=30');
        let ok = 0; const N = 12;
        for (let i = 0; i < N; i++) {
            const want = i % 2 ? 1 : 2;
            await slowClick(page.locator(`fp400-zone-card .zone-row[data-zone="${want}"]`), page);
            if (await page.evaluate(() => document.querySelector('fp400-zone-card').selected) === want) ok++;
        }
        check(`I1 zone list clicks register while live data streams (${ok}/${N})`, ok === N, ok);
        noErrors('I2', page); await page.close();
    },
    async J() { // two areas in one save, then an area already covered
        const page = await open('?latency=300');
        await btn(page, 'areas').click();
        await drag(page, [-350, 100], [-200, 300]);
        await drag(page, [200, 600], [350, 750]);
        await btn(page, 'save').click(); await waitIdle(page, 30000);
        let x = await sim(page);
        check('J1 both areas land when saved together (no lost write)', sameBits(maskSet(x.mask), bitsOf([[-350, -200, 100, 300], [200, 350, 600, 750]])), x);
        await page.evaluate(() => { window.__sim.calls.length = 0; });
        await btn(page, 'areas').click();
        await drag(page, [-300, 150], [-250, 250]);
        await btn(page, 'save').click(); await waitIdle(page);
        x = await sim(page); const s = await st(page);
        check('J2 an area that is already covered is not re-sent', x.calls.length === 0 && s.mode === 'select' && s.pending.length === 0, {x, s});
        noErrors('J3', page); await page.close();
    },
    async K() { // sensor never confirms
        const page = await open('?latency=100');
        await page.evaluate(() => { window.__sim.fail = true; });
        await btn(page, 'areas').click(); await drag(page, [-300, 250], [-150, 400]);
        await btn(page, 'save').click(); await waitIdle(page, 30000);
        let s = await st(page);
        check('K1 an unconfirmed area is reported, kept, and not called saved', /not confirmed/i.test(s.message) && s.pending.length === 1 && !s.saveDisabled && !/^Saved/.test(s.message), s);
        await page.evaluate(() => { window.__sim.fail = false; });
        await btn(page, 'save').click(); await waitIdle(page, 30000);
        s = await st(page);
        check('K2 Save again succeeds', s.pending.length === 0 && /^Saved/.test(s.message), s);
        noErrors('K3', page); await page.close();
    },
    async L() { // converter without any area controls
        const page = await open('?noblocks=1');
        const s = await st(page);
        check('L1 Areas is disabled without area controls', s.areasDisabled, s);
        noErrors('L2', page); await page.close();
    },
    async M() { // switching tools keeps unsaved areas
        const page = await open();
        await btn(page, 'areas').click(); await drag(page, [-300, 250], [-150, 400]);
        await btn(page, 'draw').click();
        let s = await st(page);
        check('M1 switching to Draw zone keeps the unsaved area', s.mode === 'draw' && s.dashed === 1 && !s.areasActive, s);
        await btn(page, 'draw').click();
        s = await st(page);
        check('M2 Save offers to save the area', /Save areas/.test(s.saveLabel) && !s.saveDisabled, s);
        noErrors('M3', page); await page.close();
    },
    async O() { // ruler numbers sit on the grid lines, even when the map is letterboxed
        const page = await open();
        for (const view of [{x: -400, y: -50, width: 800, height: 900}, {x: -200, y: -50, width: 400, height: 500}]) {
            const r = await page.evaluate(v => {
                const c = document.querySelector('fp400-zone-card'); c.view = v; c.render();
                const svg = c.shadowRoot.querySelector('svg'), m = svg.getScreenCTM();
                const tick = (sel, text, axis) => { const t = [...c.shadowRoot.querySelectorAll(`${sel} .tick`)].find(el => el.textContent === text).getBoundingClientRect(); return axis === 'x' ? t.left + t.width / 2 : t.top + t.height / 2; };
                return {x1: tick('#ruler-x', '1', 'x') - (m.a * 100 + m.e), y2: tick('#ruler-y', '2', 'y') - (m.f - m.d * 200)};
            }, view);
            check(`O1 rulers match the grid for view ${view.width}×${view.height} (off by ${r.x1.toFixed(1)} px, ${r.y2.toFixed(1)} px)`, Math.abs(r.x1) <= 1 && Math.abs(r.y2) <= 1, r);
        }
        noErrors('O2', page); await page.close();
    },
    async P() { // the grabbed spot stays under the cursor while panning
        const page = await open();
        await page.evaluate(() => { const c = document.querySelector('fp400-zone-card'); c.view = {x: -200, y: -50, width: 400, height: 500}; c.render(); });
        const a = await screen(page, 150, 400);
        await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x - 150, a.y + 60, {steps: 8}); await page.mouse.up();
        const b = await screen(page, 150, 400);
        check(`P1 panning keeps the grabbed spot under the cursor (off by ${(b.x - a.x + 150).toFixed(1)}, ${(b.y - a.y - 60).toFixed(1)} px)`, Math.abs(b.x - (a.x - 150)) <= 2 && Math.abs(b.y - (a.y + 60)) <= 2, {a, b});
        noErrors('P2', page); await page.close();
    },
    async Q() { // a half-typed edit belongs to the zone it was typed for
        const page = await open();
        await page.locator('fp400-zone-card .zone-row[data-zone="1"]').click();
        await page.locator('fp400-zone-card input[data-field="width"]').fill('3');
        await clickAt(page, 85, 265); // inside Bed, while the width field still has focus
        const z = await page.evaluate(() => { const c = document.querySelector('fp400-zone-card'); return {desk: c.drafts[1], bed: c.drafts[2], selected: c.selected}; });
        check('Q1 typed width goes to Desk, not to the zone clicked next', z.desk.x_max - z.desk.x_min === 300 && z.bed.x_min === -10 && z.bed.x_max === 180 && z.selected === 2, z);
        noErrors('Q2', page); await page.close();
    },
    async R() { // a second finger (palm) during an area drag does not hijack it
        const page = await open('', {hasTouch: true});
        await btn(page, 'areas').click();
        const cdp = await page.context().newCDPSession(page);
        const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints});
        const a = await screen(page, -300, 250), mid = await screen(page, -225, 325), a2 = await screen(page, -150, 400), palm = await screen(page, 250, 650);
        await touch('touchStart', [{x: a.x, y: a.y, id: 1}]);
        await touch('touchMove', [{x: mid.x, y: mid.y, id: 1}]);
        await touch('touchStart', [{x: mid.x, y: mid.y, id: 1}, {x: palm.x, y: palm.y, id: 2}]);
        await touch('touchMove', [{x: a2.x, y: a2.y, id: 1}, {x: palm.x + 6, y: palm.y + 6, id: 2}]);
        await touch('touchMove', [{x: palm.x + 6, y: palm.y + 6, id: 2}]); // finger 1 lifts, palm still down
        await touch('touchEnd', []);
        const s = await st(page);
        check('R1 the intended area is kept and the palm adds nothing', s.pending.length === 1 && JSON.stringify(s.pending[0]) === '[-300,-150,250,400]', s);
        noErrors('R2', page); await page.close();
    },
    async S() { // a renamed sensor is found without any device setting
        const page = await open('?prefix=living_room_fp400&auto=1');
        const r = await page.evaluate(() => { const c = document.querySelector('fp400-zone-card'); return {device: c.device, desk: c.drafts[1]?.name}; });
        check('S1 the card finds a renamed FP400 on its own', r.device === 'living_room_fp400' && r.desk === 'Desk', r);
        noErrors('S2', page); await page.close();
    },
    async N() { // pan and zoom still work
        const page = await open();
        const v0 = (await st(page)).view;
        await drag(page, [300, 300], [300, 200]);
        const s = await st(page);
        check('N1 dragging empty space pans the map', s.view.y !== v0.y, {v0, v: s.view});
        const c = await screen(page, 0, 300);
        await page.mouse.move(c.x, c.y); await page.mouse.wheel(0, -300); await page.waitForTimeout(100);
        const s2 = await st(page);
        check('N2 mouse wheel zooms', s2.view.width < s.view.width, {before: s.view, after: s2.view});
        noErrors('N3', page); await page.close();
    },
    async T() { // doorways and outside-room cells go to their own masks
        const page = await open('?latency=100');
        await btn(page, 'areas').click();
        await typeBtn(page, 'entry_exit').click();
        await drag(page, [250, 0], [350, 100]);
        await typeBtn(page, 'edge').click();
        await drag(page, [-400, 650], [400, 800]);
        let s = await st(page);
        check('T1 each drawn area keeps its own type', JSON.stringify(s.ops) === '["entry_exit:add","edge:add"]' && s.areaType === 'edge', s);
        await btn(page, 'save').click(); await waitIdle(page);
        const x = await sim(page);
        check('T2 the doorway lands in the entry/exit mask only', sameBits(maskSet(x.entry), bitsOf([[250, 350, 0, 100]])) && /^0+$/.test(x.mask), x);
        check('T3 the outside-room cells land in the edge mask only', sameBits(maskSet(x.edge), bitsOf([[-400, 400, 650, 800]])), x);
        check('T4 one confirmed call per area, in order', JSON.stringify(x.calls) === JSON.stringify(['entry_exit_zone_add={"x_min":250,"x_max":350,"y_min":0,"y_max":100}', 'edge_zone_add={"x_min":-400,"x_max":400,"y_min":650,"y_max":800}']), x.calls);
        check('T5 doorway and outside-room cells are drawn where they were painted', JSON.stringify(await cellBox(page, 'entry_exit')) === '[250,350,0,100]' && JSON.stringify(await cellBox(page, 'edge')) === '[-400,400,650,800]');
        noErrors('T6', page); await page.close();
    },
    async U() { // erase part of a saved area
        const page = await open('?latency=100');
        await btn(page, 'areas').click(); await drag(page, [-300, 200], [-100, 400]);
        await btn(page, 'save').click(); await waitIdle(page);
        await btn(page, 'areas').click(); await toolBtn(page, 'remove').click();
        await drag(page, [-300, 200], [-200, 400]);
        let s = await st(page);
        check('U1 erased cells fade before Save', s.gone === 8 && s.cells === 8 && JSON.stringify(s.ops) === '["interference:remove"]', s);
        await btn(page, 'save').click(); await waitIdle(page);
        const x = await sim(page); s = await st(page);
        check('U2 the sensor keeps only the cells that were not erased', sameBits(maskSet(x.mask), bitsOf([[-200, -100, 200, 400]])) && x.calls.at(-1).startsWith('interference_zone_remove='), x);
        check('U3 the map shows the same', s.cells === 8 && s.gone === 0 && JSON.stringify(await cellBox(page, 'interference')) === '[-200,-100,200,400]', s);
        noErrors('U4', page); await page.close();
    },
    async V() { // Clear all only clears the chosen type
        const page = await open('?latency=100');
        await btn(page, 'areas').click(); await drag(page, [-300, 200], [-200, 300]);
        await typeBtn(page, 'entry_exit').click(); await drag(page, [200, 0], [300, 100]);
        await btn(page, 'save').click(); await waitIdle(page);
        await btn(page, 'areas').click(); await typeBtn(page, 'entry_exit').click(); await btn(page, 'clear-area').click();
        await btn(page, 'save').click(); await waitIdle(page);
        const x = await sim(page);
        check('V1 doorways are cleared and ignore spots stay', /^0+$/.test(x.entry) && sameBits(maskSet(x.mask), bitsOf([[-300, -200, 200, 300]])) && x.calls.includes('entry_exit_clear=confirm') && !x.calls.includes('interference_clear=confirm'), x);
        noErrors('V2', page); await page.close();
    },
    async W() { // the 0.1.0 converter: ignore spots only
        const page = await open('?oldconv=1&latency=100');
        await btn(page, 'areas').click();
        const disabled = await page.evaluate(() => [...document.querySelector('fp400-zone-card').shadowRoot.querySelectorAll('.area-type')].map(b => `${b.dataset.type}:${b.disabled}:${b.querySelector('small').textContent}`));
        check('W1 doorway and outside room ask for the newer converter', JSON.stringify(disabled) === JSON.stringify(['interference:false:0 cells', 'entry_exit:true:Needs the newer converter', 'edge:true:Needs the newer converter']), disabled);
        await drag(page, [-300, 250], [-150, 400]);
        await btn(page, 'save').click(); await waitIdle(page);
        const x = await sim(page);
        check('W2 ignore spots still save', sameBits(maskSet(x.mask), bitsOf([[-300, -150, 250, 400]])), x);
        const row = await page.locator('fp400-zone-card .zone-row[data-zone="1"] small').textContent();
        check('W3 zone rows work without people counts', row === 'Occupied', row);
        noErrors('W4', page); await page.close();
    },
    async X() { // sensor settings apply right away and wait for the sensor
        const page = await open('?latency=150');
        await btn(page, 'settings').first().click();
        let shown = await page.evaluate(() => { const r = document.querySelector('fp400-zone-card').shadowRoot; return {settings: getComputedStyle(r.querySelector('#settings')).display, zones: getComputedStyle(r.querySelector('#zone-list').parentElement).display}; });
        check('X1 Settings replaces the zone list in the sidebar', shown.settings !== 'none' && shown.zones === 'none', shown);
        await setting(page, 'presence_sensitivity').selectOption('high');
        await waitMessage(page, /Saved: Sensitivity/);
        let c = await calls(page);
        check('X2 sensitivity is sent as one select_option and confirmed', c.length === 1 && c[0].domain === 'select' && c[0].service === 'select_option' && c[0].entity_id === 'select.presence_sensitivity' && c[0].option === 'high', c);
        await setting(page, 'ai_high_precision').click();
        await waitMessage(page, /Saved: Better person recognition/);
        await setting(page, 'absence_timeout').fill('30'); await setting(page, 'absence_timeout').press('Enter');
        await waitMessage(page, /Saved: Empty after/);
        await setting(page, 'installation_height').fill('245'); await setting(page, 'installation_height').press('Enter');
        await waitMessage(page, /Saved: Height/);
        c = await calls(page);
        check('X3 switches and numbers use the right services (height in mm)', JSON.stringify(c.slice(1).map(x => [x.service, x.entity_id, x.value ?? null])) === JSON.stringify([['turn_on', 'switch.ai_high_precision', null], ['set_value', 'number.absence_timeout', 30], ['set_value', 'number.installation_height', 2450]]), c);
        await setting(page, 'absence_timeout').fill('5'); await setting(page, 'absence_timeout').press('Enter');
        const s = await st(page);
        check('X4 an out-of-range number is refused without calling the sensor', /from 10 to 300/.test(s.message) && (await calls(page)).length === 4, s.message);
        const options = await setting(page, 'installation_mode').evaluate(el => [...el.options].map(o => o.value));
        check('X5 the read-only "unknown" mounting value is not offered', JSON.stringify(options) === '["wall","ceiling"]', options);
        await btn(page, 'learn').click();
        check('X6 Learn asks first and sends nothing', (await calls(page)).length === 4, await calls(page));
        await btn(page, 'learn').click();
        await waitMessage(page, /Room learning finished/, 8000);
        check('X7 the second press starts learning and the card reports the result', (await calls(page)).at(-1).service === 'press', await calls(page));
        await page.locator('fp400-zone-card #settings [data-action="settings"]').click();
        shown = await page.evaluate(() => getComputedStyle(document.querySelector('fp400-zone-card').shadowRoot.querySelector('#zone-list').parentElement).display);
        check('X8 closing settings brings the zone list back', shown !== 'none', shown);
        noErrors('X9', page); await page.close();
    },
    async Y() { // forget a ghost, then ignore its spot
        const page = await open('?latency=150');
        await clickAt(page, -160, 260);
        let s = await st(page);
        check('Y1 clicking a dot shows that target', s.target === 4 && /TARGET 5/.test(s.inspector), s);
        await btn(page, 'forget-target').click();
        await waitMessage(page, /Target 5 is gone/);
        const c = await calls(page);
        check('Y2 Forget sends the raw target id to remove_target', c.length === 1 && c[0].entity_id === 'text.remove_target' && c[0].value === '4', c);
        await btn(page, 'ignore-target').click();
        s = await st(page);
        check('Y3 Ignore this spot adds an unsaved 1 × 1 m ignore spot where the target was', s.mode === 'areas' && JSON.stringify(s.pending) === '[[-200,-100,200,300]]' && JSON.stringify(s.ops) === '["interference:add"]', s);
        await btn(page, 'save').click(); await waitIdle(page);
        const x = await sim(page);
        check('Y4 Save writes that spot to the sensor', sameBits(maskSet(x.mask), bitsOf([[-200, -100, 200, 300]])), x);
        noErrors('Y5', page); await page.close();
    },
    async Z() { // zone rows show how many people and whether they move
        const page = await open();
        const row = await page.locator('fp400-zone-card .zone-row[data-zone="1"] small').textContent();
        check('Z1 the Desk row says one person, still', row === 'Occupied · 1 person, still', row);
        noErrors('Z2', page); await page.close();
    },
};

for (const [name, run] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.includes(name)) continue;
    try { await run(); } catch (error) { check(`${name} crashed`, false, String(error).slice(0, 300)); }
}
await browser.close();
server.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

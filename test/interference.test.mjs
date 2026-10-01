import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition, {worldToGrid, fp400Poll} from '../z2m/aqara-fp400.mjs';
import {rectBits, clampBlock} from '../dist/fp400-zone-card.js';

const gridBits = g => {const bits = []; for (let r = g.row_start; r <= g.row_end; r++) for (let c = g.column_start; c <= g.column_end; c++) bits.push(r * 16 + c); return bits;};
const control = key => definition.toZigbee.find(c => c.key.includes(key));
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('card and converter map rectangles to the same sensor cells', () => {
    for (const r of [{x_min:-400,x_max:400,y_min:0,y_max:1000}, {x_min:-237,x_max:-101,y_min:12,y_max:349},
        {x_min:350,x_max:400,y_min:950,y_max:1000}, {x_min:-50,x_max:50,y_min:-100,y_max:60}, {x_min:-1000,x_max:-350,y_min:400,y_max:420}]) {
        assert.deepEqual(rectBits(r), gridBits(worldToGrid(r)), JSON.stringify(r));
    }
});
test('columns run right to left like the device: column 0 at x = +4 m, x = 0 between columns 7 and 8', () => {
    const cell = (x_min, x_max) => worldToGrid({x_min, x_max, y_min: 0, y_max: 50});
    assert.deepEqual(cell(350, 400), {row_start: 0, row_end: 0, column_start: 0, column_end: 0});
    assert.deepEqual(cell(0, 50), {row_start: 0, row_end: 0, column_start: 7, column_end: 7});
    assert.deepEqual(cell(-50, 0), {row_start: 0, row_end: 0, column_start: 8, column_end: 8});
    assert.deepEqual(rectBits({x_min: -400, x_max: -350, y_min: 950, y_max: 1000}), [19 * 16 + 15]);
});
test('rectangles outside the sensor grid are rejected, not squashed onto the edge', () => {
    for (const r of [{x_min:-100,x_max:100,y_min:-200,y_max:-100}, {x_min:-100,x_max:100,y_min:-50,y_max:0},
        {x_min:450,x_max:600,y_min:100,y_max:200}, {x_min:-100,x_max:100,y_min:1000,y_max:1100}]) {
        assert.throws(() => worldToGrid(r), /outside the sensor grid/, JSON.stringify(r));
    }
});
test('drawn blocks are trimmed to the grid; slivers are dropped', () => {
    assert.deepEqual(clampBlock({x_min:100,x_max:250,y_min:-50,y_max:150}), {x_min:100,x_max:250,y_min:0,y_max:150});
    assert.equal(clampBlock({x_min:0,x_max:100,y_min:-50,y_max:30}), null);
});
test('two interference adds sent at once both land', async () => {
    let mask = Buffer.alloc(40);
    const endpoint = {
        read: async () => {await sleep(5); return {19: Buffer.from(mask)};},
        write: async (cluster, payload) => {await sleep(15); mask = Buffer.from(payload[19].value);},
    };
    const meta = {device: {ieeeAddr: 'lock-test', getEndpoint: () => endpoint}};
    const a = {x_min:-400,x_max:-300,y_min:0,y_max:100}, b = {x_min:300,x_max:400,y_min:900,y_max:1000};
    await Promise.all([a, b].map(r => control('interference_zone_add').convertSet(null, 'interference_zone_add', JSON.stringify(r), meta)));
    for (const bit of [...rectBits(a), ...rectBits(b)]) assert.ok(mask[bit >> 3] & (0x80 >> (bit % 8)), `cell ${bit} lost`);
});
test('region reports decode cell counts and the interference mask', () => {
    const mask = Buffer.alloc(40); mask[0] = 0b10100000; mask[39] = 0xff;
    const msg = {endpoint: {ID: 1}, data: {18: mask, 19: mask, 20: mask}};
    const state = Object.assign({}, ...definition.fromZigbee.filter(c => c.cluster === 'aqaraFp400Config' && c.type.includes('readResponse')).map(c => c.convert({}, msg) ?? {}));
    assert.equal(state.interference_region, '10 cells selected');
    assert.equal(state.entry_exit_region, '10 cells selected');
    assert.equal(state.monitoring_region, '310 cells selected');
    assert.equal(state.interference_mask_hex, mask.toString('hex'));
});
test('entry/exit and outside-room areas edit their own masks', async () => {
    const masks = {18: Buffer.alloc(40), 19: Buffer.alloc(40), 20: Buffer.alloc(40)};
    const endpoint = {read: async (cluster, [id]) => ({[id]: Buffer.from(masks[id])}), write: async (cluster, payload) => {const [id] = Object.keys(payload); masks[id] = Buffer.from(payload[id].value);}};
    const meta = {device: {ieeeAddr: 'area-test', getEndpoint: () => endpoint}};
    const rect = {x_min: 300, x_max: 400, y_min: 0, y_max: 50};
    const entry = await control('entry_exit_zone_add').convertSet(null, 'entry_exit_zone_add', JSON.stringify(rect), meta);
    assert.equal(masks[18][0], 0xc0); assert.equal(masks[19][0], 0); assert.equal(entry.state.entry_exit_mask_hex.slice(0, 2), 'c0');
    const edge = await control('edge_zone_add').convertSet(null, 'edge_zone_add', rect, meta);
    assert.equal(masks[20][0], 0xc0); assert.equal(edge.state.edge_mask_hex.slice(0, 2), 'c0'); assert.equal(edge.state.monitoring_region, '318 cells selected');
    await control('edge_zone_remove').convertSet(null, 'edge_zone_remove', rect, meta); assert.equal(masks[20][0], 0);
    await control('entry_exit_clear').convertSet(null, 'entry_exit_clear', 'confirm', meta); assert.ok(masks[18].every(b => b === 0));
    await assert.rejects(() => control('edge_clear').convertSet(null, 'edge_clear', 'yes', meta), /confirm/);
});
test('clear accepts a sensor that reports an empty mask as zero-length', async () => {
    const endpoint = {write: async () => {}, read: async () => ({19: Buffer.alloc(0)})};
    const result = await control('interference_clear').convertSet(null, 'interference_clear', 'confirm', {device: {ieeeAddr: 'clear-test', getEndpoint: () => endpoint}});
    assert.equal(result.state.interference_mask_hex, '0'.repeat(80));
});
test('area masks are read at start and then every 5 minutes, not on every poll', async () => {
    const reads = [], commands = [];
    const device = {ieeeAddr: 'poll-test', meta: {}, getEndpoint: () => ({read: async (cluster, [id]) => {reads.push(id); return {};}, command: async (...args) => {commands.push(args[1]); return {statusCode: 0};}})};
    await fp400Poll(device); await fp400Poll(device);
    assert.deepEqual(reads, [18, 19, 20]); assert.deepEqual(commands, [], 'no zones, no tracking subscription');
    device.meta.fp400SoftwareZones = {1: {name: 'Desk'}};
    await fp400Poll(device);
    assert.deepEqual(commands, ['subscribeLocationData']); assert.equal(reads.length, 3);
});

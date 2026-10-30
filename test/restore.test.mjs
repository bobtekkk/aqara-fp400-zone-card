import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition, {fp400Poll} from '../z2m/aqara-fp400.mjs';

const control = key => definition.toZigbee.find(c => c.key.includes(key));
const set = (key, value, device) => control(key).convertSet(null, key, value, {device});
const announce = device => definition.onEvent({type: 'deviceAnnounce', data: {device}});
// Config attributes the converter registers by name come back named, like zigbee-herdsman returns them.
const named = {'aqaraFp400Config/0': 'installation_mode', 'aqaraFp400Config/2': 'side_installation', 'aqaraFp400Config/44': 'ai_interference_recognition'};

// A fake FP400 that forgets its areas and mounting when it loses power, like the real one does.
function fakeSensor(ieeeAddr) {
    const factory = () => new Map([['1/aqaraFp400Config/0', 0], ['1/aqaraFp400Config/2', 0], ['1/aqaraFp400Config/4', 0],
        ['1/aqaraFp400Config/5', 0], ['1/aqaraFp400Config/6', 0], ['1/aqaraFp400Config/44', 0], ['1/128/0', 1], ['1/msOccupancySensing/3', 10],
        ['1/aqaraFp400Config/18', Buffer.alloc(40)], ['1/aqaraFp400Config/19', Buffer.alloc(40)], ['1/aqaraFp400Config/20', Buffer.alloc(40)]]);
    let attributes = factory();
    const writes = [];
    const device = {
        ieeeAddr, meta: {}, saves: 0, offline: false, writes,
        save() {this.saves++;},
        powerCut() {attributes = factory();},
        attr: (endpoint, cluster, id) => attributes.get(`${endpoint}/${cluster}/${id}`),
        setAttr: (endpoint, cluster, id, value) => attributes.set(`${endpoint}/${cluster}/${id}`, value),
        getEndpoint: endpoint => ({
            ID: endpoint,
            read: async (cluster, ids) => {
                if (device.offline) throw new Error('Timeout');
                if (cluster === 'aqaraFp400Radar' && ids[0] === 0) return {0: [...attributes.keys()].filter(key => key.endsWith('/aqaraFp400Radar/1')).map(key => Number(key.split('/')[0]))};
                const data = {};
                for (const id of ids) {
                    const value = attributes.get(`${endpoint}/${cluster}/${id}`);
                    if (value !== undefined) data[named[`${cluster}/${id}`] ?? id] = Buffer.isBuffer(value) ? Buffer.from(value) : value;
                }
                return data;
            },
            write: async (cluster, payload) => {
                if (device.offline) throw new Error('Timeout');
                for (const [id, {value}] of Object.entries(payload)) {
                    writes.push(`${endpoint}/${cluster}/${id}`);
                    attributes.set(`${endpoint}/${cluster}/${id}`, Buffer.isBuffer(value) ? Buffer.from(value) : value);
                }
            },
            command: async () => ({statusCode: 0}),
        }),
    };
    return device;
}
const doorway = {x_min: 300, x_max: 400, y_min: 0, y_max: 50}, ghost = {x_min: -250, x_max: -150, y_min: 100, y_max: 200};

test('areas, mounting and settings come back after a power cut', async () => {
    const device = fakeSensor('restore-power-cut');
    await fp400Poll(device);
    await set('installation_mode', 'wall', device);
    await set('side_installation', 'left_corner', device);
    await set('installation_height', 1700, device);
    await set('interference_zone_add', JSON.stringify(ghost), device);
    await set('entry_exit_zone_add', JSON.stringify(doorway), device);
    await set('presence_sensitivity', 'high', device);
    await set('absence_timeout', 0, device);
    const before = ['0', '2', '4', '18', '19'].map(id => device.attr(1, 'aqaraFp400Config', id));
    assert.ok(device.saves > 0, 'kept with the device');

    device.powerCut();
    assert.equal(device.attr(1, 'aqaraFp400Config', 0), 0);
    await announce(device);
    await fp400Poll(device);
    assert.deepEqual(['0', '2', '4', '18', '19'].map(id => device.attr(1, 'aqaraFp400Config', id)), before);
    assert.equal(device.attr(1, 128, 0), 2, 'sensitivity high');
    assert.equal(device.attr(1, 'msOccupancySensing', 3), 0, 'empty after 0 s');

    const writes = device.writes.length;
    await fp400Poll(device);
    await announce(device); await fp400Poll(device);
    assert.equal(device.writes.length, writes, 'nothing is written while the sensor still has everything');
});

test('an area the sensor changed itself is left alone; only an empty one is filled', async () => {
    const device = fakeSensor('restore-ai-area');
    await fp400Poll(device);
    await set('interference_zone_add', JSON.stringify(ghost), device);
    const recognised = Buffer.alloc(40); recognised[10] = 0xf0;
    device.setAttr(1, 'aqaraFp400Config', 19, recognised);
    const writes = device.writes.length;
    await announce(device); await fp400Poll(device);
    assert.deepEqual(device.attr(1, 'aqaraFp400Config', 19), recognised);
    assert.equal(device.writes.length, writes);
});

test('mounting is put back before the areas, whatever order they were set in', async () => {
    const device = fakeSensor('restore-order');
    await fp400Poll(device);
    await set('interference_zone_add', JSON.stringify(ghost), device);
    await set('installation_mode', 'wall', device);
    device.powerCut(); device.writes.length = 0;
    await announce(device); await fp400Poll(device);
    assert.deepEqual(device.writes, ['1/aqaraFp400Config/0', '1/aqaraFp400Config/19']);
});

test('a cleared area stays cleared after a power cut', async () => {
    const device = fakeSensor('restore-cleared');
    await fp400Poll(device);
    await set('interference_zone_add', JSON.stringify(ghost), device);
    await set('interference_clear', 'confirm', device);
    device.powerCut();
    const writes = device.writes.length;
    await announce(device); await fp400Poll(device);
    assert.equal(device.writes.length, writes);
});

test('settings made before this update are taken over from the sensor and survive the next power cut', async () => {
    const device = fakeSensor('restore-adopt');
    const mask = Buffer.alloc(40); mask[9] = 0x30;
    device.setAttr(1, 'aqaraFp400Config', 19, mask);
    device.setAttr(1, 'aqaraFp400Config', 0, 1);
    device.setAttr(1, 'aqaraFp400Config', 4, 2200);
    device.setAttr(1, 'aqaraFp400Config', 44, 1);
    await fp400Poll(device);
    assert.equal(device.writes.length, 0, 'taking over writes nothing');
    assert.ok(device.meta.fp400Saved['1/aqaraFp400Config/19']);
    assert.equal(device.meta.fp400Saved['1/aqaraFp400Config/2'], undefined, 'a mounting the sensor does not know is not kept');
    device.powerCut();
    await announce(device); await fp400Poll(device);
    assert.deepEqual(device.attr(1, 'aqaraFp400Config', 19), mask);
    assert.equal(device.attr(1, 'aqaraFp400Config', 0), 1);
    assert.equal(device.attr(1, 'aqaraFp400Config', 4), 2200);
    assert.equal(device.attr(1, 'aqaraFp400Config', 44), 1);
});

test('a wiped area found by the 5-minute read is put back without an announcement', async (t) => {
    const device = fakeSensor('restore-missed-announce');
    await fp400Poll(device);
    await set('interference_zone_add', JSON.stringify(ghost), device);
    const kept = device.attr(1, 'aqaraFp400Config', 19);
    device.powerCut();
    const now = Date.now();
    t.mock.method(Date, 'now', () => now + 301000);
    await fp400Poll(device);
    assert.ok(device.attr(1, 'aqaraFp400Config', 19).every(b => b === 0), 'found wiped, not yet put back');
    await fp400Poll(device);
    assert.deepEqual(device.attr(1, 'aqaraFp400Config', 19), kept);
});

test('a sensor that does not answer is checked again on the next poll', async () => {
    const device = fakeSensor('restore-offline');
    await fp400Poll(device);
    await set('installation_mode', 'ceiling', device);
    device.powerCut(); device.offline = true;
    await announce(device);
    await fp400Poll(device);
    device.offline = false;
    await fp400Poll(device);
    assert.equal(device.attr(1, 'aqaraFp400Config', 0), 2);
});

test('zone slot settings are kept too', async () => {
    const device = fakeSensor('restore-zone-slot');
    device.setAttr(3, 'aqaraFp400Radar', 1, 1);
    device.setAttr(3, 128, 0, 1);
    await fp400Poll(device);
    await set('zone_1_sensitivity', 'low', device);
    device.setAttr(3, 128, 0, 1);
    await announce(device); await fp400Poll(device);
    assert.equal(device.attr(3, 128, 0), 0);
});

test('legacy settings do not follow a reused endpoint into another native zone', async () => {
    const device = fakeSensor('restore-zone-reassigned');
    device.setAttr(3, 'aqaraFp400Radar', 1, 1);
    device.setAttr(3, 128, 0, 1);
    await fp400Poll(device);
    await set('zone_1_sensitivity', 'low', device);
    device.setAttr(3, 'aqaraFp400Radar', 1, 2);
    device.setAttr(3, 128, 0, 1);
    await announce(device); await fp400Poll(device);
    assert.equal(device.attr(3, 128, 0), 1, 'zone 2 keeps its own sensitivity');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition, {fp400Poll, parseSoftwareZone} from '../z2m/aqara-fp400.mjs';
import {fp400Sensor} from './helpers/fp400-sensor.mjs';

const desk = parseSoftwareZone({name: 'Desk', x_min: -140, x_max: 60, y_min: 8, y_max: 158, absence_timeout: 3});
const frames = definition.fromZigbee.find(c => c.cluster === 'aqaraFp400Location' && c.type.includes('raw'));
// A firmware 0060+ record: id, x, y, points that move, points that only breathe, tracker diagnostic, type, posture, zone.
function record({id, x, y, moving = 0, type = 0, state = 4000}) {
    const r = Buffer.from('0900200029000029000029000029000021000030003000200000'.slice(0, 50), 'hex');
    r[3] = id; r.writeInt16LE(x, 5); r.writeInt16LE(y, 8); r.writeInt16LE(moving, 11); r.writeInt16LE(40, 14); r.writeUInt16LE(state, 17); r[20] = type; r[22] = 0xfe;
    return r;
}
const frame = targets => Buffer.concat([Buffer.from([0x1c, 0x5f, 0x11, 0x01, 0x8b, 0x00, 0x00, 0x4c, targets.length, 0]), ...targets.map(record)]);
const convert = (device, targets) => frames.convert({}, {endpoint: {ID: 1}, data: frame(targets), device}, () => {});

test('on firmware 0060 and later a zone is moving while its person has moving points, and still without them', () => {
    const device = {ieeeAddr: 'fw63-moving', applicationVersion: 63, meta: {fp400SoftwareZones: {1: desk}}};
    // A diagnostic of 1 could be an old fall flag, so only the firmware version says how to read these.
    let out = convert(device, [{id: 3, x: 0, y: 80, moving: 0, state: 1}]);
    assert.equal(out.software_zone_1_activity, 'still');
    assert.deepEqual(out.tracking_targets, [{id: 3, x: 0, y: 80, moving_points: 0, micro_points: 40, moving: false, tracking_state: 1, type: 'person', zone: 0}]);
    out = convert(device, [{id: 3, x: 0, y: 80, moving: 12, state: 1}]);
    assert.equal(out.software_zone_1_activity, 'moving');
    assert.equal(out.targets_xy, '3:0:80', 'the dots older cards read are unchanged');
});

test('people_only is kept in Zigbee2MQTT, published, and leaves pets out of the zones', async () => {
    const device = {ieeeAddr: 'fw63-people', applicationVersion: 63, meta: {fp400SoftwareZones: {1: desk}}, save: async () => {}};
    const control = definition.toZigbee.find(c => c.key.includes('people_only')), published = [];
    const meta = {device, publish: state => published.push(state)};
    const targets = [{id: 1, x: 0, y: 80, moving: 5, type: 3}, {id: 2, x: -20, y: 90, type: 0}];
    assert.equal(convert(device, targets).software_zone_1_count, 2, 'off by default: the pet counts');
    assert.deepEqual(await control.convertSet(null, 'people_only', 'ON', meta), {state: {people_only: 'ON'}});
    assert.equal(device.meta.fp400PeopleOnly, true);
    const out = convert(device, targets);
    assert.deepEqual([out.software_zone_1_count, out.software_zone_1_activity], [1, 'still'], 'only the still person is left');
    assert.deepEqual(out.tracking_targets.map(t => [t.type, t.ignored]), [['pet', true], ['person', undefined]]);
    await control.convertGet(null, 'people_only', meta);
    assert.deepEqual(published.at(-1), {people_only: 'ON'});
    await assert.rejects(control.convertSet(null, 'people_only', 'maybe', meta), /ON or OFF/);
    const heartbeat = definition.fromZigbee.find(c => c.cluster === 'aqaraFp400Radar' && c.type.includes('attributeReport') && c.convert.toString().includes('people_only'));
    assert.equal(heartbeat.convert({}, {endpoint: {ID: 1}, device, data: {}}, () => {}, {}).people_only, 'ON');
    await control.convertSet(null, 'people_only', 'OFF', meta);
    assert.equal(convert(device, targets).software_zone_1_count, 2);
});

test('the firmware version is read once, and again after the sensor restarts (an update ends with one)', async () => {
    const d = fp400Sensor('fw-version');
    d.put(1, 'genBasic', 'appVersion', 51);
    await fp400Poll(d);await fp400Poll(d);
    assert.equal(d.calls.filter(c => c === 'read/1/genBasic/appVersion').length, 1);
    d.meta.fp400SoftwareZones = {1: desk};
    const old = Buffer.from('1c5f113b8b00004c01000900200029e9ff290e012908052902002100003000307f2000', 'hex');
    assert.equal(frames.convert({}, {endpoint: {ID: 1}, data: old, device: d}, () => {}).tracking_targets[0].cell, 0x0508, 'firmware 51: the old layout');
    d.put(1, 'genBasic', 'appVersion', 63);
    await definition.onEvent({type: 'deviceAnnounce', data: {device: d}});
    await fp400Poll(d);
    assert.equal(d.calls.filter(c => c === 'read/1/genBasic/appVersion').length, 2);
    assert.equal(frames.convert({}, {endpoint: {ID: 1}, data: old, device: d}, () => {}).tracking_targets[0].moving_points, 0x0508, 'firmware 63: the same bytes are points');
    const quiet = fp400Sensor('fw-unsupported');
    await fp400Poll(quiet);await fp400Poll(quiet);
    assert.equal(quiet.calls.filter(c => c === 'read/1/genBasic/appVersion').length, 1, 'an unsupported version is not asked for again');
});

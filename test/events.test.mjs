import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition, {decodeMotionEvent, parseSoftwareZone} from '../z2m/aqara-fp400.mjs';

const hex = h => Buffer.from(h, 'hex');
const desk = parseSoftwareZone({name: 'Desk', x_min: -140, x_max: 60, y_min: 8, y_max: 158, absence_timeout: 3});
function record({id, x, y, activity = 2}) {
    const r = Buffer.from('0900200029000029000029000029000021000030003000200000'.slice(0, 50), 'hex');
    r[3] = id; r.writeInt16LE(x, 5); r.writeInt16LE(y, 8); r.writeInt16LE(activity, 14); r[22] = 255;
    return r;
}
const frame = targets => Buffer.concat([Buffer.from([0x1c, 0x5f, 0x11, 0x01, 0x8b, 0x00, 0x00, 0x4c, targets.length, 0]), ...targets.map(record)]);

test('movement events decode with or without a type tag', () => {
    assert.equal(decodeMotionEvent(hex('1c5f11078b000006')), 'approach');
    assert.equal(decodeMotionEvent(hex('1c5f11078b00003007')), 'away');
    assert.equal(decodeMotionEvent(hex('1c5f11078b000000')), 'enter');
    assert.equal(decodeMotionEvent(hex('1c5f11078b030000')), undefined, 'event 3 is the learning result');
    assert.equal(decodeMotionEvent(hex('1c5f11078b000009')), undefined, 'unknown value');
});
test('only the main endpoint fires actions; movement frames are kept for diagnosis', () => {
    const motion = definition.fromZigbee.find(c => c.cluster === 'aqaraFp400Radar' && c.type.includes('raw'));
    assert.deepEqual(motion.convert({}, {endpoint: {ID: 1}, data: hex('1c5f11078b000001')}), {motion_last_frame: '1c5f11078b000001', action: 'leave'});
    assert.deepEqual(motion.convert({}, {endpoint: {ID: 3}, data: hex('1c5f11078b000001')}), {motion_last_frame: '1c5f11078b000001'});
    assert.equal(motion.convert({}, {endpoint: {ID: 1}, data: hex('1c5f11070a000000')}), undefined);
});
test('remove_target sends the command once per request and reports a refusal', async () => {
    const control = definition.toZigbee.find(c => c.key.includes('remove_target'));
    const sent = [];
    const meta = status => ({device: {getEndpoint: () => ({command: async (...args) => {sent.push(args); return {statusCode: status};}})}});
    await control.convertSet(null, 'remove_target', '3', meta(0));
    assert.deepEqual(sent[0].slice(0, 3), ['aqaraFp400Location', 'removeDetectionTarget', {targetId: 3}]);
    await assert.rejects(() => control.convertSet(null, 'remove_target', 4, meta(0x8b)), /did not accept/);
    for (const bad of ['', 'x', -1, 256, 1.5]) await assert.rejects(() => control.convertSet(null, 'remove_target', bad, meta(0)), /needs a target id/);
    assert.equal(sent.length, 2);
});
test('position frames publish zone enter events after the new state', async () => {
    const frames = definition.fromZigbee.find(c => c.cluster === 'aqaraFp400Location' && c.type.includes('raw'));
    const device = {ieeeAddr: 'events-test', meta: {fp400SoftwareZones: {1: desk}}}, published = [];
    frames.convert({}, {endpoint: {ID: 1}, data: frame([]), device}, p => published.push(p));
    const out = frames.convert({}, {endpoint: {ID: 1}, data: frame([{id: 3, x: 0, y: 80, activity: 1}]), device}, p => published.push(p));
    assert.equal(out.software_zone_1_count, 1);
    assert.equal(out.software_zone_1_activity, 'moving');
    assert.equal(published.length, 0, 'events wait until the state is out');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(published, [{action: 'software_zone_1_enter'}]);
    await definition.onEvent({type: 'stop', data: {ieeeAddr: device.ieeeAddr}});
});
test('a position report cut at 80 bytes (Ember) still updates the zones', () => {
    const frames = definition.fromZigbee.find(c => c.cluster === 'aqaraFp400Location' && c.type.includes('raw'));
    const device = {ieeeAddr: 'cut-test', meta: {fp400SoftwareZones: {1: desk}}};
    const cut = frame([{id: 0, x: -119, y: 217}, {id: 6, x: 58, y: 514}, {id: 2, x: 0, y: 80}, {id: 4, x: -30, y: 98}]).subarray(0, 80);
    const out = frames.convert({}, {endpoint: {ID: 1}, data: cut, device}, () => {});
    assert.deepEqual([out.tracking_status, out.software_zone_1_occupancy, out.target_count, out.targets_xy], ['valid', true, 4, '0:-119:217;6:58:514;2:0:80']);
    definition.onEvent({type: 'stop', data: {ieeeAddr: device.ieeeAddr}});
});

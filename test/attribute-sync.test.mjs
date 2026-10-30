import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareDefinition} from 'zigbee-herdsman-converters';
import definition, {decodeAttributeSync, readNativeZoneMap} from '../z2m/aqara-fp400.mjs';

const model = prepareDefinition({...definition});
const captures = JSON.parse(readFileSync(new URL('./fixtures/fp400-attribute-sync.json', import.meta.url)));
const names = {'0x0406': 'msOccupancySensing', '0xfc0b': 'aqaraFp400Radar', '0xfc0c': 'aqaraFp400Location', '0x0400': 'msIlluminanceMeasurement'};
const bridge = cluster => model.fromZigbee.findLast(c => c.cluster === cluster && c.type.includes('raw'));
const makeDevice = id => ({ieeeAddr: id, meta: {}, getEndpoint: ID => ({ID, read: async (cluster, [attr]) => attr === 0 ? {0: [3, 4]} : {1: ID - 2}})});
const stop = device => definition.onEvent({type: 'stop', data: {ieeeAddr: device.ieeeAddr}});

test('all 20 captured 8A reports reach the prepared standard and native converters', async () => {
    let n = 0;
    for (const capture of captures) for (const vector of capture.frames) {
        const cluster = names[vector.cluster], device = makeDevice(`sync-${n++}`), raw = Buffer.from(vector.zclHex, 'hex');
        await readNativeZoneMap(device);
        const published = [], meta = {device, state: {}, publish: state => published.push(state)};
        const message = {cluster, type: 'raw', data: raw, endpoint: device.getEndpoint(vector.endpoint), device, meta: {rawData: raw}};
        const state = await bridge(cluster).convert(model, message, meta.publish, {native_zones: true}, meta);
        const ordinary = {}, report = {...message, type: 'attributeReport', data: decodeAttributeSync(cluster, raw)};
        for (const converter of model.fromZigbee.filter(c => c.cluster === cluster && c.type.includes('attributeReport'))) {
            Object.assign(ordinary, await converter.convert(model, report, meta.publish, {native_zones: true}, meta));
        }
        assert.deepEqual(state, ordinary, `${capture.session} frame ${vector.frame}`);
        if (cluster === 'msOccupancySensing') {
            assert.equal(state[`occupancy_${vector.endpoint}`], raw[8] === 1);
            if (vector.endpoint >= 3) assert.equal(state[`native_zone_${vector.endpoint - 2}_occupancy`], raw[8] === 1);
        } else if (cluster === 'aqaraFp400Radar') {
            if (vector.endpoint === 1) assert.equal(state.human_count, raw.readUInt16LE(8));
            else {assert.equal(state[`native_zone_${vector.endpoint - 2}_count`], raw.readUInt16LE(8)); assert.equal(state.human_count, undefined);}
        } else if (cluster === 'aqaraFp400Location') assert.equal(state.activity_state, 'still');
        else assert.equal(typeof state.illuminance_2, 'number');
        await stop(device);
    }
});

test('truncated and unsupported 8A payloads publish no partial report', async () => {
    const device = makeDevice('sync-invalid'), called = [];
    const spyModel = {...model, fromZigbee: [{cluster: 'aqaraFp400Radar', type: ['attributeReport'], convert: () => {called.push(1); return {human_count: 0};}}]};
    const good = Buffer.from('1c5f117d8a0200210100', 'hex');
    const invalid = [...Array.from({length: good.length - 1}, (_, i) => good.subarray(0, i + 1)),
        Buffer.concat([good, Buffer.from('02002100', 'hex')]), // one complete record before a truncated one
        Buffer.from('1c5f117d8a02002001', 'hex'), Buffer.from('1c5e117d8a0200210100', 'hex'),
        Buffer.from('1c5f117d8a0300210100', 'hex')];
    for (const data of invalid) {
        const state = await bridge('aqaraFp400Radar').convert(spyModel, {cluster: 'aqaraFp400Radar', data, device, endpoint: device.getEndpoint(1)}, () => {}, {}, {device});
        assert.equal(state, undefined);
    }
    assert.deepEqual(called, []);
    await stop(device);
});

test('herdsman numeric raw cluster dispatch works before custom clusters are registered', async () => {
    const device = makeDevice('sync-numeric');
    for (const [cluster, hex, expected] of [[64523, '1c5f117d8a0200210100', {human_count: 1}], [64524, '1c5f11008a07003002', {activity_state: 'still'}]]) {
        const converter = bridge(cluster);
        assert.ok(converter, 'dispatch uses numeric cluster equality');
        const state = await converter.convert(model, {cluster, type: 'raw', data: Buffer.from(hex, 'hex'), device, endpoint: device.getEndpoint(1)}, () => {}, {}, {device, state: {}});
        for (const [key, value] of Object.entries(expected)) assert.equal(state[key], value);
    }
    await stop(device);
});

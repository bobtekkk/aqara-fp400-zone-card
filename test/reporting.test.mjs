import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition, {fp400ReportingSlots, fp400UnreportedPoll, nativeZoneIds} from '../z2m/aqara-fp400.mjs';

const configure = device => fp400ReportingSlots.configure[0](device, {ID: 1});
const zone = id => [{elmType: 0x20, elmVal: id}, {elmType: 0x30, elmVal: 0}, {elmType: 0x41, elmVal: Buffer.alloc(40)}, {elmType: 0x10, elmVal: 1}];

// A fake FP400 with its five-entry reporting table, filled the way converter 0.4 left it.
function fakeSensor({zones = [], zonesReadable = true, lightFails = false} = {}) {
    const table = new Set(['1/msOccupancySensing', '3/msOccupancySensing', '4/msOccupancySensing', '5/msOccupancySensing', '6/msOccupancySensing']);
    const reads = [];
    const device = {
        ieeeAddr: `report-${Math.random()}`, meta: {}, saves: 0, table, reads,
        save() {this.saves++;},
        getEndpoint: id => ({
            bind: async () => {},
            configureReporting: async (cluster, [{maximumReportInterval}]) => {
                const entry = `${id}/${cluster}`;
                if (maximumReportInterval === 0xffff) table.delete(entry);
                else if (!table.has(entry)) {
                    if (table.size >= 5) throw new Error('Status INSUFFICIENT_SPACE');
                    table.add(entry);
                }
            },
            read: async (cluster, attributes) => {
                reads.push(`${id}/${cluster}`);
                if (cluster === 'aqaraFp400Radar' && attributes[0] !== 'humanCount') {
                    if (!zonesReadable) throw new Error('Timeout');
                    return attributes[0] === 0 ? {0: zones.map(zone => zone + 2)} : {1: id - 2};
                }
                if (cluster === 'aqaraFp400Config') {
                    if (!zonesReadable) throw new Error('Timeout');
                    return {16: zones.map(zone)};
                }
                if (cluster === 'msIlluminanceMeasurement' && lightFails) throw new Error('Timeout');
                return {[attributes[0]]: 0};
            },
        }),
    };
    return device;
}
const polled = async device => {
    device.reads.length = 0;
    await fp400UnreportedPoll(device).catch(() => {});
    return device.reads.filter(read => !read.includes('aqaraFp400Radar')).map(read => Number(read.split('/')[0]));
};

test('without native zones the light gets a report entry and no zone endpoint is polled', async () => {
    const device = fakeSensor();
    await configure(device);
    assert.deepEqual([...device.table].sort(), ['1/msOccupancySensing', '2/msIlluminanceMeasurement']);
    assert.deepEqual(device.meta.fp400Reporting, {reported: [2], zones: []});
    assert.ok(device.saves > 0, 'kept with the device');
    assert.deepEqual(await polled(device), [2]);
});

test('native zones come before the light, and those that find no entry are polled', async () => {
    const device = fakeSensor({zones: [1, 2, 3, 4, 5]});
    await configure(device);
    // Room and zones 1-4 fill the table; zone 5 (endpoint 7) and the light are polled.
    assert.deepEqual(device.meta.fp400Reporting.reported, [3, 4, 5, 6]);
    assert.deepEqual(await polled(device), [2, 7]);
});

test('entries of zone slots the sensor does not use go to the light', async () => {
    const device = fakeSensor({zones: [1, 2]});
    await configure(device);
    assert.deepEqual([...device.table].sort(), ['1/msOccupancySensing', '2/msIlluminanceMeasurement', '3/msOccupancySensing', '4/msOccupancySensing']);
    assert.deepEqual(device.meta.fp400Reporting.reported, [3, 4, 2]);
    assert.deepEqual(await polled(device), [2]);
});

test('an unreadable zone list changes no existing report', async () => {
    const device = fakeSensor({zonesReadable: false});
    await configure(device);
    assert.equal(device.table.size, 5);
    assert.ok(!device.table.has('2/msIlluminanceMeasurement'), 'table was full');
    assert.deepEqual(device.meta.fp400Reporting, {reported: [3, 4, 5, 6], zones: null});
    assert.deepEqual(await polled(device), [2, 7, 8, 9, 10]);
});

test('a sensor set up by converter 0.4 keeps the old polling until configure runs again', async () => {
    assert.deepEqual(await polled(fakeSensor()), [2, 7, 8, 9, 10]);
});

test('a failed light read still polls the zones and is reported', async () => {
    const device = fakeSensor({lightFails: true});
    await assert.rejects(fp400UnreportedPoll(device), /Timeout/);
    assert.deepEqual(device.reads.filter(read => !read.includes('aqaraFp400Radar')).map(read => Number(read.split('/')[0])), [2, 7, 8, 9, 10]);
});

test('native zone ids are read from plain or struct records', () => {
    assert.deepEqual(nativeZoneIds([zone(1), zone(3)]), [1, 3]);
    assert.deepEqual(nativeZoneIds([[2, 0, Buffer.alloc(40), 1]]), [2]);
    assert.deepEqual(nativeZoneIds([]), []);
    assert.equal(nativeZoneIds(undefined), null);
    assert.equal(nativeZoneIds([['x']]), null);
});

test('Zigbee2MQTT can offer firmware updates, which the sensor fetches on endpoint 1', () => {
    assert.equal(definition.ota, true);
});

test('a native zone timeout can be 0 although the sensor reports 10 s as its minimum', async () => {
    const control = definition.toZigbee.find(c => c.key.includes('zone_1_absence_timeout'));
    const written = [];
    const endpoint = {
        ID: 3,
        read: async (cluster, [id]) => {
            if (cluster === 'aqaraFp400Radar') return id === 0 ? {0: [3]} : {1: 1};
            if (id === 4) return {4: [{elmVal: 10}, {elmVal: 300}]};
            return {3: written.at(-1)};
        },
        write: async (cluster, payload) => {written.push(payload[3].value);},
    };
    const device = {meta: {}, save() {}, getEndpoint: () => endpoint};
    const result = await control.convertSet(null, 'zone_1_absence_timeout', 0, {device});
    assert.deepEqual(result, {state: {zone_1_absence_timeout: 0}});
    assert.deepEqual(written, [0]);
    await assert.rejects(control.convertSet(null, 'zone_1_absence_timeout', 301, {device}), /0\.\.300/);
});

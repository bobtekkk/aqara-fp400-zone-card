// Aqara FP400 (lumi.models.4447_8295) external converter for Zigbee2MQTT 2.x: software presence zones,
// interference blocks and position tracking. Builds on the community converter by jcastro (Zigbee2MQTT issue #33146).
// https://github.com/bobtekkk/aqara-fp400-zone-card (MIT License)
import * as m from 'zigbee-herdsman-converters/lib/modernExtend';
import * as exposes from 'zigbee-herdsman-converters/lib/exposes';
const e = exposes.presets;
const ea = exposes.access;
// Vendor attributes confirmed by direct reads from this FP400.
const aqaraHumanCount = {
    cluster: 'aqaraFp400Radar',
    type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        const count = msg.data.humanCount ?? msg.data[2];
        return typeof count === 'number' ? {human_count: count} : undefined;
    },
};
const aqaraActivityState = {
    cluster: 'aqaraFp400Location',
    type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        const state = msg.data.activityState ?? msg.data[7];
        const values = ['unknown', 'active', 'still'];
        return Number.isInteger(state) && state >= 0 && state < values.length
            ? {activity_state: values[state]}
            : undefined;
    },
};
// Attribute IDs, ZCL types and write access discovered on this Zigbee device.
// Labels follow the FP400 protocol reference; physical effects require validation.
const configOptions = {
    installation_mode: {id: 0, type: 0x30, values: {unknown: 0, wall: 1, ceiling: 2}, description: 'Mounting mode; experimental Zigbee mapping. Unknown is read-only.'},
    side_installation: {id: 2, type: 0x30, values: {unknown: 0, wall: 1, left_corner: 2, right_corner: 3}, description: 'Wall or corner mounting; experimental Zigbee mapping. Unknown is read-only.'},
    coordinate_reverse: {id: 45, type: 0x30, values: {disabled: 0, enabled: 1, auto: 2}, description: 'Mounting direction / coordinate reversal; experimental Zigbee mapping'},
    human_count_enabled: {id: 35, type: 0x10, values: {ON: 1, OFF: 0}, description: 'Native human-count feature flag. Count reads can work while OFF; physical effect is not yet established'},
    ai_high_precision: {id: 41, type: 0x10, values: {ON: 1, OFF: 0}, description: 'AI enhanced person recognition'},
    ai_adaptive_sensitivity: {id: 42, type: 0x10, values: {ON: 1, OFF: 0}, description: 'AI adaptive detection sensitivity'},
    ai_entry_exit_recognition: {id: 43, type: 0x10, values: {ON: 1, OFF: 0}, description: 'AI entry and exit region recognition'},
    ai_interference_recognition: {id: 44, type: 0x10, values: {ON: 1, OFF: 0}, description: 'AI interference source recognition'},
    detection_direction: {id: 46, type: 0x30, values: {omnidirectional: 0, left_right: 1}, description: 'Movement detection direction'},
    proximity_distance: {id: 47, type: 0x30, values: {far: 0, medium: 1, near: 2}, description: 'Approach detection distance level; not the overall detection range'},
};
const configCluster = 'aqaraFp400Config';
const manufacturerOptions = {manufacturerCode: 0x115f};
function decodeConfig(data) {
    const result = {};
    for (const [key, option] of Object.entries(configOptions)) {
        const raw = data[key] ?? data[option.id];
        const value = Object.entries(option.values).find(([, number]) => number === Number(raw));
        if (raw !== undefined && value) result[key] = value[0];
    }
    return result;
}
const fp400ConfigReport = {
    cluster: configCluster, type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => decodeConfig(msg.data),
};
const fp400ConfigControl = {
    key: Object.keys(configOptions),
    convertGet: async (entity, key, meta) => {
        await meta.device.getEndpoint(1).read(configCluster, [configOptions[key].id], manufacturerOptions);
    },
    convertSet: async (entity, key, value, meta) => {
        const option = configOptions[key];
        if (!Object.hasOwn(option.values, value)) throw new Error(`Invalid ${key}: ${value}`);
        const endpoint = meta.device.getEndpoint(1);
        if (['installation_mode', 'side_installation'].includes(key) && value === 'unknown') throw new Error('Unknown is a diagnostic value; choose an actual mounting mode');
        await endpoint.write(configCluster, {[option.id]: {value: option.values[value], type: option.type}}, manufacturerOptions);
        const readback = decodeConfig(await endpoint.read(configCluster, [configOptions[key].id], manufacturerOptions));
        if (readback[key] !== value) throw new Error(`${key} was not confirmed by the sensor`);
        return {state: readback};
    },
};
const fp400Learning = {
    key: ['spatial_learning'],
    convertSet: async (entity, key, value, meta) => {
        if (value !== 'start') throw new Error('spatial_learning accepts only start');
        // Acceptance is not completion. Never run automatically on configure.
        await meta.device.getEndpoint(1).command(configCluster, 'startLearning', {}, {
            ...manufacturerOptions, disableDefaultResponse: false, disableResponse: false,
        });
        return {state: {learning_state: 'accepted', learning_started_time: new Date().toISOString(), learning_result_code: null, learning_result_time: null}};
    },
};
const sensitivityValues = ['low', 'medium', 'high'];
const fp400SensitivityReport = {
    cluster: '128', type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        if (msg.endpoint.ID !== 1) return;
        const raw = msg.data[0];
        if (Number.isInteger(raw) && raw >= 0 && raw < 3) return {presence_sensitivity: sensitivityValues[raw]};
    },
};
const fp400AbsenceReport = {
    cluster: 'msOccupancySensing', type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        if (msg.endpoint.ID !== 1) return;
        const value = msg.data[3];
        if (Number.isInteger(value)) return {absence_timeout: value};
    },
};
const fp400SensitivityControl = {
    key: ['presence_sensitivity'],
    convertGet: async (entity, key, meta) => {await meta.device.getEndpoint(1).read(128, [0]);},
    convertSet: async (entity, key, value, meta) => {
        const level = sensitivityValues.indexOf(value);
        if (level < 0) throw new Error('Select low, medium or high sensitivity');
        const endpoint = meta.device.getEndpoint(1);
        await endpoint.write(128, {0: {value: level, type: 0x20}});
        const data = await endpoint.read(128, [0]);
        if (data[0] !== level) throw new Error('Sensitivity write was not confirmed');
        return {state: {presence_sensitivity: value}};
    },
};
const fp400AbsenceControl = {
    key: ['absence_timeout'],
    convertGet: async (entity, key, meta) => {await meta.device.getEndpoint(1).read('msOccupancySensing', [3]);},
    convertSet: async (entity, key, value, meta) => {
        if (!Number.isInteger(value) || value < 10 || value > 300) throw new Error('Absence timeout must be 10..300 seconds');
        const endpoint = meta.device.getEndpoint(1);
        await endpoint.write('msOccupancySensing', {3: {value, type: 0x21}});
        const data = await endpoint.read('msOccupancySensing', [3]);
        if (data[3] !== value) throw new Error('Absence timeout write was not confirmed');
        return {state: {absence_timeout: value}};
    },
};
// Community FP400 mapping: 20 rows of 16 half-metre cells. Attribute 20 stores
// excluded cells. Zigbee write access is confirmed; physical cutoff needs checking.
function boundaryBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (Array.isArray(value)) return Buffer.from(value);
    if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
    throw new Error('Invalid monitoring boundary response');
}
function decodeDepth(value) {
    const mask = boundaryBuffer(value);
    if (mask.length === 0) return 10;
    if (mask.length !== 40) return null;
    let allowedRows = 0, excluded = false;
    for (let row = 0; row < 20; row++) {
        const first = mask[row * 2], second = mask[row * 2 + 1];
        if (first === 0 && second === 0 && !excluded) allowedRows++;
        else if (first === 255 && second === 255) excluded = true;
        else return null;
    }
    return allowedRows / 2;
}
const fp400DepthReport = {
    cluster: configCluster, type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        if (msg.data[20] === undefined) return;
        try {return {detection_depth: decodeDepth(msg.data[20])};} catch {return;}
    },
};
const fp400DepthControl = {
    key: ['detection_depth'],
    convertGet: async (entity, key, meta) => {await meta.device.getEndpoint(1).read(configCluster, [20], manufacturerOptions);},
    convertSet: async (entity, key, value, meta) => {
        if (typeof value !== 'number' || value < 0.5 || value > 10 || !Number.isInteger(value * 2)) throw new Error('Forward depth must be 0.5..10 metres in 0.5 metre steps');
        const endpoint = meta.device.getEndpoint(1);
        const mask = Buffer.alloc(40, 255);
        mask.fill(0, 0, value * 4);
        await withDeviceLock(meta.device, async () => {
            const before = await endpoint.read(configCluster, [20], manufacturerOptions);
            if (decodeDepth(before[20]) === null) throw new Error('Existing custom-shaped boundary cannot be replaced by this depth control');
            await endpoint.write(configCluster, {20: {value: mask, type: 0x41}}, manufacturerOptions);
            const data = await endpoint.read(configCluster, [20], manufacturerOptions);
            if (!boundaryBuffer(data[20]).equals(mask)) throw new Error('Monitoring depth write was not confirmed');
        });
        return {state: {detection_depth: value}};
    },
};
// Mounting and region access/types confirmed by Zigbee discoverExt.
// Labels and geometry are community mappings and still need physical validation.
const installStatuses = ['level_facing_up', 'level_tilted_facing_up', 'level_reverse_tilted_facing_up',
    'side_facing_forward', 'side_reverse_facing_forward', 'top_facing_down', 'tilted_facing_down',
    'reverse_tilted_facing_down', 'invalid'];
const diagnosticAttributes = {installation_height: 4, installation_height_min: 5, installation_height_max: 6,
    installation_status: 7, installation_angle: 8, configured_zones: 16, maximum_zones: 17, learning_reporting_timeout: 22};
const regionAttributes = {entry_exit_region: 18, interference_region: 19, monitoring_region: 20};
function regionBuffer(value) {
    const mask = boundaryBuffer(value);
    if (mask.length !== 0 && mask.length !== 40) throw new Error('Unsupported region mask length');
    return mask.length === 0 ? Buffer.alloc(40) : mask;
}
// Native grid: 20 rows × 16 columns of 50 cm cells. Rows run near to far from y = 0. Columns run
// right to left: column 0 is x = 350..400 cm and x = 0 is the boundary of columns 7 and 8, as checked
// against the device's own zone assignment by github.com/RAR/ha-aqara-fp400.
export function worldToGrid(rect) {
    const {x_min, x_max, y_min, y_max} = rect ?? {};
    if (![x_min, x_max, y_min, y_max].every(Number.isFinite) || x_min >= x_max || y_min >= y_max) {
        throw new Error('Rectangle needs x_min < x_max and y_min < y_max in centimetres');
    }
    const grid = {
        row_start: Math.max(0, Math.floor(y_min / 50)),
        row_end: Math.min(19, Math.ceil(y_max / 50) - 1),
        column_start: Math.max(0, 8 - Math.ceil(x_max / 50)),
        column_end: Math.min(15, 7 - Math.floor(x_min / 50)),
    };
    if (grid.row_start > grid.row_end || grid.column_start > grid.column_end) {
        throw new Error('Rectangle is outside the sensor grid (x -400..400 cm, y 0..1000 cm)');
    }
    return grid;
}
// Region masks and software zones are edited read-modify-write; overlapping edits would overwrite each other.
const deviceLocks = new Map();
function withDeviceLock(device, task) {
    const run = (deviceLocks.get(device.ieeeAddr) ?? Promise.resolve()).then(() => task());
    deviceLocks.set(device.ieeeAddr, run.catch(() => {}));
    return run;
}
// Monitoring cells are stored as exclusions, so a clear bit means "selected".
function regionState(key, value) {
    let set = 0;
    for (let byte of regionBuffer(value)) for (; byte; byte &= byte - 1) set++;
    return `${key === 'monitoring_region' ? 320 - set : set} cells selected`;
}
function decodeInstallation(data) {
    const state = {};
    for (const [key, id] of Object.entries(diagnosticAttributes)) {
        const raw = data[id];
        if (raw === undefined) continue;
        if (key === 'installation_status') state[key] = installStatuses[raw] ?? `unknown_${raw}`;
        else if (key === 'configured_zones') {
            if (Array.isArray(raw)) {
                state[key] = JSON.stringify(raw);
                state.configured_zone_count = raw.length;
            }
        } else if (Number.isInteger(raw)) state[key] = raw;
    }
    for (const [key, id] of Object.entries(regionAttributes)) {
        if (data[id] === undefined) continue;
        try {
            state[key] = regionState(key, data[id]);
            if (key === 'interference_region') state.interference_mask_hex = regionBuffer(data[id]).toString('hex');
        } catch { /* preserve last valid region */ }
    }
    return state;
}
const fp400InstallationReport = {
    cluster: configCluster, type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => msg.endpoint.ID === 1 ? decodeInstallation(msg.data) : undefined,
};
const fp400InstallationControl = {
    key: [...Object.keys(diagnosticAttributes), 'configured_zone_count'],
    convertGet: async (entity, key, meta) => {
        await meta.device.getEndpoint(1).read(configCluster, [diagnosticAttributes[key] ?? 16], manufacturerOptions);
    },
    convertSet: async (entity, key, value, meta) => {
        if (key !== 'installation_height') throw new Error('This installation diagnostic is read-only');
        if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Enter the actual mounting height in millimetres, greater than zero');
        const endpoint = meta.device.getEndpoint(1);
        const limits = await endpoint.read(configCluster, [5, 6], manufacturerOptions);
        // Zero limits mean the device has not supplied usable bounds, not a 0 mm maximum.
        if (limits[5] > 0 && value < limits[5]) throw new Error(`Minimum mounting height is ${limits[5]} mm`);
        if (limits[6] > 0 && value > limits[6]) throw new Error(`Maximum mounting height is ${limits[6]} mm`);
        await endpoint.write(configCluster, {4: {value, type: 0x21}}, manufacturerOptions);
        const data = await endpoint.read(configCluster, [4, 5, 6, 7, 8], manufacturerOptions);
        if (data[4] !== value) throw new Error('Mounting height was not confirmed by the sensor');
        return {state: decodeInstallation(data)};
    },
};
// Edit rectangles while preserving every cell outside the selected rectangle.
// Grid indices deliberately avoid claiming unverified Zigbee distances or left/right axes.
const fp400RegionControl = {
    key: Object.keys(regionAttributes).map(key => `${key}_edit`),
    convertSet: async (entity, key, value, meta) => {
        const region = key.replace(/_edit$/, '');
        if (!value || typeof value !== 'object' || !['add', 'remove'].includes(value.operation)) {
            throw new Error('Choose add or remove and specify the rectangle bounds');
        }
        const {row_start: r0, row_end: r1, column_start: c0, column_end: c1} = value;
        if (![r0, r1, c0, c1].every(Number.isInteger) || r0 < 0 || r1 > 19 || c0 < 0 || c1 > 15 || r0 > r1 || c0 > c1) {
            throw new Error('Rows must be 0..19, columns 0..15, with start not greater than end');
        }
        const endpoint = meta.device.getEndpoint(1);
        const id = regionAttributes[region];
        return withDeviceLock(meta.device, async () => {
            const current = await endpoint.read(configCluster, [id], manufacturerOptions);
            const mask = Buffer.from(regionBuffer(current[id]));
            const selected = value.operation === 'add';
            const setBit = region === 'monitoring_region' ? !selected : selected;
            for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
                const bit = row * 16 + col, flag = 0x80 >> (bit % 8);
                if (setBit) mask[bit >> 3] |= flag;
                else mask[bit >> 3] &= ~flag;
            }
            await endpoint.write(configCluster, {[id]: {value: mask, type: 0x41}}, manufacturerOptions);
            const readback = await endpoint.read(configCluster, [id], manufacturerOptions);
            if (!regionBuffer(readback[id]).equals(mask)) throw new Error('Region write was not confirmed by the sensor');
            const state = decodeInstallation(readback);
            if (id === 20) state.detection_depth = decodeDepth(readback[id]);
            return {state};
        });
    },
};
const fp400RegionGet = {
    key: [...Object.keys(regionAttributes), 'interference_mask_hex'],
    convertGet: async (entity, key, meta) => {
        await meta.device.getEndpoint(1).read(configCluster, [regionAttributes[key] ?? regionAttributes.interference_region], manufacturerOptions);
    },
};
// World-coordinate rectangles for the interference mask. Cells are converted to
// the 20 × 16 native grid and merged into the existing mask.
const fp400InterferenceZone = {
    key: ['interference_zone_add', 'interference_zone_remove', 'interference_clear'],
    convertSet: async (entity, key, value, meta) => {
        if (key === 'interference_clear') {
            if (value !== 'confirm') throw new Error("Send 'confirm' to clear all interference cells");
            const endpoint = meta.device.getEndpoint(1);
            const mask = Buffer.alloc(40);
            const readback = await withDeviceLock(meta.device, async () => {
                await endpoint.write(configCluster, {19: {value: mask, type: 0x41}}, manufacturerOptions);
                return endpoint.read(configCluster, [19], manufacturerOptions);
            });
            if (!regionBuffer(readback[19]).equals(mask)) throw new Error('Clear was not confirmed by the sensor');
            return {state: decodeInstallation(readback)};
        }
        if (typeof value === 'string') value = JSON.parse(value);
        const rectangle = worldToGrid(value);
        return fp400RegionControl.convertSet(entity, 'interference_region_edit',
            {operation: key.endsWith('_add') ? 'add' : 'remove', ...rectangle}, meta);
    },
};
async function refreshFp400Configuration(endpoint) {
    for (const attributes of [Object.values(configOptions).map(option => option.id), [4, 5, 6, 7, 8, 22], [16, 17], [18], [19], [20]]) {
        await endpoint.read(configCluster, attributes, manufacturerOptions);
    }
}
const fp400Refresh = {
    key: ['refresh_configuration'],
    convertSet: async (entity, key, value, meta) => {
        if (value !== 'refresh') throw new Error('Select refresh');
        await refreshFp400Configuration(meta.device.getEndpoint(1));
        await refreshZoneSettings(meta.device);
    },
};
const fp400LearningResult = {
    cluster: configCluster, type: ['raw'],
    convert: (model, msg) => {
        if (msg.endpoint.ID !== 1) return;
        const data = msg.data;
        // Observed full ZCL frame: 1c/0c 5f 11 TSN 8b 03 00 RESULT.
        // Ignore other event IDs, truncation and unknown framing.
        if (!Buffer.isBuffer(data) || data.length !== 8 || ![0x1c, 0x0c].includes(data[0]) ||
            data.readUInt16LE(1) !== 0x115f || data[4] !== 0x8b || data.readUInt16LE(5) !== 3) return;
        return {learning_state: 'result_received', learning_result_code: data[7], learning_result_time: new Date().toISOString()};
    },
};
const fp400AdditionalExposes = [
    e.numeric('installation_height', ea.ALL).withUnit('mm').withValueMin(0).withValueMax(65535).withValueStep(1).withCategory('config')
        .withDescription('Actual mounting height in millimetres. 0 means unconfigured; enter a positive measured height. Experimental Zigbee mapping.'),
    e.numeric('installation_height_min', ea.STATE_GET).withUnit('mm').withCategory('diagnostic').withDescription('Device-reported minimum mounting height; 0 means no usable limit reported'),
    e.numeric('installation_height_max', ea.STATE_GET).withUnit('mm').withCategory('diagnostic').withDescription('Device-reported maximum mounting height; 0 means no usable limit reported'),
    e.text('installation_status', ea.STATE_GET).withCategory('diagnostic').withDescription('Orientation reported by the sensor; community enum interpretation'),
    e.numeric('installation_angle', ea.STATE_GET).withUnit('°').withCategory('diagnostic').withDescription('Reported tilt angle; community interpretation'),
    e.numeric('maximum_zones', ea.STATE_GET).withCategory('diagnostic').withDescription('Maximum number of native detection zones'),
    e.numeric('configured_zone_count', ea.STATE_GET).withCategory('diagnostic').withDescription('Number of native zone records; not a person count'),
    e.text('configured_zones', ea.STATE_GET).withCategory('diagnostic').withDescription('Native zone records for protocol investigation; zone commands are not yet implemented'),
    e.numeric('learning_reporting_timeout', ea.STATE_GET).withUnit('s').withCategory('diagnostic').withDescription('Device learning reporting timeout; not a verified calibration duration'),
    e.enum('learning_state', ea.STATE, ['accepted', 'result_received']).withCategory('diagnostic').withDescription('Accepted means only command acknowledgement; result_received means event 3 was received'),
    e.numeric('learning_result_code', ea.STATE).withCategory('diagnostic').withDescription('Raw event 3 result: 0 is consistent with success in the community reference; interpretation remains provisional'),
    e.text('learning_started_time', ea.STATE).withCategory('diagnostic').withDescription('UTC time of the last learning command accepted during this converter installation'),
    e.text('learning_result_time', ea.STATE).withCategory('diagnostic').withDescription('UTC time of the last received learning result event'),
    e.enum('refresh_configuration', ea.SET, ['refresh']).withCategory('config').withDescription('Read mounting, AI, regions and native zone configuration from the sensor'),
    e.text('interference_zone_add', ea.SET).withCategory('config')
        .withDescription('Mark an interference rectangle in world coordinates (cm), e.g. {"x_min":-100,"x_max":100,"y_min":50,"y_max":250}. Cells are added to the existing mask.'),
    e.text('interference_zone_remove', ea.SET).withCategory('config')
        .withDescription('Clear the interference cells inside a world-coordinate rectangle. Same JSON shape as interference_zone_add.'),
    e.text('interference_clear', ea.SET).withCategory('config')
        .withDescription("Clear every interference cell. Send 'confirm' to apply."),
    e.text('interference_mask_hex', ea.STATE_GET).withCategory('diagnostic')
        .withDescription('Raw interference mask, 80 hex characters (40 bytes, 320 cells). Used by the room-zones card to show blocked cells.'),
    ...Object.keys(regionAttributes).flatMap(key => [
        e.text(key, ea.STATE_GET).withCategory('diagnostic').withDescription('Number of selected grid cells. Monitoring cells are included; interference cells are marked as interference sources. Use the rectangle editor to change a region. Geometry is experimental.'),
        e.composite(`${key}_edit`, `${key}_edit`, ea.SET).withCategory('config')
            .withDescription('Experimental rectangle editor. Add/remove selected cells while preserving other cells. Rows 0..19 near to far; column 0 is at x = +4 m, column 15 at x = -4 m.')
            .withFeature(e.enum('operation', ea.SET, ['add', 'remove']))
            .withFeature(e.numeric('row_start', ea.SET).withValueMin(0).withValueMax(19).withValueStep(1))
            .withFeature(e.numeric('row_end', ea.SET).withValueMin(0).withValueMax(19).withValueStep(1))
            .withFeature(e.numeric('column_start', ea.SET).withValueMin(0).withValueMax(15).withValueStep(1))
            .withFeature(e.numeric('column_end', ea.SET).withValueMin(0).withValueMax(15).withValueStep(1)),
    ]),
];
// EP3..10 returned native zone IDs 1..8. Their two configuration attributes
// are readable/writable even while the native zone-definition list is empty.
const zoneSlots = Array.from({length: 8}, (_, index) => ({zone: index + 1, endpoint: index + 3}));
const zoneSettingKeys = zoneSlots.flatMap(({zone}) => [`zone_${zone}_sensitivity`, `zone_${zone}_absence_timeout`]);
const fp400ZoneSettingsReport = {
    cluster: '128', type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        const slot = zoneSlots.find(slot => slot.endpoint === msg.endpoint.ID);
        const raw = msg.data[0];
        if (slot && Number.isInteger(raw) && raw >= 0 && raw < 3) {
            return {[`zone_${slot.zone}_sensitivity`]: sensitivityValues[raw]};
        }
    },
};
const fp400ZoneAbsenceReport = {
    cluster: 'msOccupancySensing', type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        const slot = zoneSlots.find(slot => slot.endpoint === msg.endpoint.ID);
        const value = msg.data[3];
        if (slot && Number.isInteger(value)) return {[`zone_${slot.zone}_absence_timeout`]: value};
    },
};
const fp400ZoneSettingsControl = {
    key: zoneSettingKeys,
    convertGet: async (entity, key, meta) => {
        const zone = Number(key.split('_')[1]);
        const sensitivity = key.endsWith('_sensitivity');
        await meta.device.getEndpoint(zone + 2).read(sensitivity ? 128 : 'msOccupancySensing', [sensitivity ? 0 : 3]);
    },
    convertSet: async (entity, key, value, meta) => {
        const zone = Number(key.split('_')[1]);
        const endpoint = meta.device.getEndpoint(zone + 2);
        const sensitivity = key.endsWith('_sensitivity');
        const encoded = sensitivity ? sensitivityValues.indexOf(value) : value;
        if (sensitivity ? encoded < 0 : (!Number.isInteger(value) || value < 0 || value > 300)) {
            throw new Error(sensitivity ? 'Select low, medium or high sensitivity' : 'Zone absence timeout must be 0..300 seconds');
        }
        const nativeId = await endpoint.read('aqaraFp400Radar', [1], manufacturerOptions);
        if (nativeId[1] !== zone) throw new Error('Native zone ID does not match this endpoint');
        if (!sensitivity) {
            const bounds = (await endpoint.read('msOccupancySensing', [4]))[4];
            const minimum = bounds?.[0]?.elmVal;
            const maximum = bounds?.[1]?.elmVal;
            if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
                throw new Error('Sensor did not return usable zone timeout bounds');
            }
            if (value < minimum || value > maximum) throw new Error(`Zone timeout must be ${minimum}..${maximum} seconds`);
        }
        const cluster = sensitivity ? 128 : 'msOccupancySensing';
        const attribute = sensitivity ? 0 : 3;
        await endpoint.write(cluster, {[attribute]: {value: encoded, type: sensitivity ? 0x20 : 0x21}});
        const data = await endpoint.read(cluster, [attribute]);
        if (data[attribute] !== encoded) throw new Error('Zone setting was not confirmed by the sensor');
        return {state: {[key]: value}};
    },
};
const fp400CapacityReport = {
    cluster: 'aqaraFp400Location', type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        const value = msg.data[0];
        if (msg.endpoint.ID === 1 && Number.isInteger(value)) return {maximum_detection_targets: value};
    },
};
const fp400CapacityGet = {
    key: ['maximum_detection_targets'],
    convertGet: async (entity, key, meta) => {
        await meta.device.getEndpoint(1).read('aqaraFp400Location', [0], manufacturerOptions);
    },
};
async function refreshZoneSettings(device) {
    for (const {endpoint} of zoneSlots) {
        for (const [cluster, attributes] of [[128, [0]], ['msOccupancySensing', [3]]]) {
            try {await device.getEndpoint(endpoint).read(cluster, attributes);} catch { /* preserve other zone readings */ }
        }
    }
    try {await device.getEndpoint(1).read('aqaraFp400Location', [0], manufacturerOptions);} catch {}
}
const fp400ZoneExposes = [
    ...zoneSlots.flatMap(({zone}) => [
        e.enum(`zone_${zone}_sensitivity`, ea.ALL, sensitivityValues).withCategory('config')
            .withDescription(`Sensitivity of native zone slot ${zone}. Does not create its detection area. Zigbee access confirmed; physical independence pending validation.`),
        e.numeric(`zone_${zone}_absence_timeout`, ea.ALL).withUnit('s').withValueMin(0).withValueMax(300).withValueStep(1).withCategory('config')
            .withDescription(`Absence confirmation time of native zone slot ${zone}. Does not create its detection area; readback confirms writes.`),
    ]),
    e.numeric('maximum_detection_targets', ea.STATE_GET).withCategory('diagnostic')
        .withDescription('Device-reported tracking capacity; not the current people count'),
];
// Observed Zigbee FC0C event 0, not the different Matter target schema.
// Unknown/truncated packets never become an empty target list.
export function decodeTrackingFrame(data) {
    if (!Buffer.isBuffer(data) || data.length < 7 || ![0x0c, 0x1c].includes(data[0]) ||
        data.readUInt16LE(1) !== 0x115f || data[4] !== 0x8b || data.readUInt16LE(5) !== 0) return undefined;
    if (data.length < 10 || data[7] !== 0x4c) throw new Error('Unsupported tracking array');
    const count = data.readUInt16LE(8);
    if (count > 10 || data.length !== 10 + 25 * count) throw new Error('Incomplete tracking frame');
    const targets = [], ids = new Set();
    const tags = [[0,9],[1,0],[2,0x20],[4,0x29],[7,0x29],[10,0x29],[13,0x29],[16,0x21],[19,0x30],[21,0x30],[23,0x20]];
    for (let index = 0; index < count; index++) {
        const r = data.subarray(10 + index * 25, 35 + index * 25);
        if (tags.some(([offset, tag]) => r[offset] !== tag) || ids.has(r[3])) throw new Error('Invalid tracking record');
        ids.add(r[3]);
        targets.push({id:r[3], x:r.readInt16LE(5), y:r.readInt16LE(8), v3:r.readInt16LE(11), v4:r.readInt16LE(14),
            v5:r.readUInt16LE(17), s1:r[20], s2:r[22], s3:r[24]});
    }
    return targets;
}
// Software zones use the observed x/y coordinates (approximately centimetres).
// Geometry must be checked in the room. They never write native zone records.
export function parseSoftwareZone(value) {
    if (value === 'clear' || value === null || value === '') return null;
    if (typeof value === 'string') value = JSON.parse(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Zone must be an object or clear');
    const zone = {name:value.name ?? 'Zone', x_min:value.x_min, x_max:value.x_max,
        y_min:value.y_min, y_max:value.y_max, absence_timeout:value.absence_timeout ?? 3};
    if (typeof zone.name !== 'string' || !zone.name.trim() || zone.name.length > 32) throw new Error('Zone name must be 1..32 characters and not blank');
    for (const k of ['x_min','x_max','y_min','y_max']) {
        if (!Number.isFinite(zone[k]) || Math.abs(zone[k]) > 2000) throw new Error('Zone bounds must be between -2000 and 2000');
    }
    if (zone.x_min >= zone.x_max || zone.y_min >= zone.y_max) throw new Error('Zone minimum must be smaller than maximum');
    if (!Number.isInteger(zone.absence_timeout) || zone.absence_timeout < 0 || zone.absence_timeout > 300) throw new Error('Zone absence timeout must be 0..300 seconds');
    return zone;
}
export class SoftwareZoneTracker {
    constructor(zones = {}) {this.zones=zones;this.lastAt=null;this.outsideSince={};this.occupied={};this.awaiting=new Set();this.invalid=false;}
    accept(targets, now) {
        this.lastAt=now;this.invalid=false;this.awaiting.clear();
        for (const [id,z] of Object.entries(this.zones)) {
            const inside=targets.some(t=>t.x>=z.x_min && t.x<z.x_max && t.y>=z.y_min && t.y<z.y_max);
            if (inside) {this.occupied[id]=true;delete this.outsideSince[id];}
            else if (this.outsideSince[id]===undefined) this.outsideSince[id]=now;
        }
    }
    // An edited zone waits for a fresh frame: positions from before the edit must not confirm it.
    reset(id) {delete this.outsideSince[id];delete this.occupied[id];this.awaiting.add(Number(id));}
    state(now) {
        const fresh=this.lastAt!==null && now-this.lastAt<30000;
        const usable=fresh && !this.invalid;
        const result={tracking_status:!fresh?'stale':this.invalid?'invalid':'valid'};
        for (let id=1;id<=8;id++) {
            const z=this.zones[id], prefix=`software_zone_${id}`, live=usable && !this.awaiting.has(id);
            if (live && z && this.outsideSince[id]!==undefined && now-this.outsideSince[id]>=z.absence_timeout*1000) this.occupied[id]=false;
            result[`${prefix}_config`]=z?JSON.stringify(z):'clear';
            result[`${prefix}_available`]=Boolean(z && live);
            result[`${prefix}_occupancy`]=z && live ? Boolean(this.occupied[id]) : null;
        }
        return result;
    }
}
const softwareZoneContexts=new Map();
function softwareContext(device, publish) {
    let context=softwareZoneContexts.get(device.ieeeAddr);
    if (!context) {
        context={tracker:new SoftwareZoneTracker(device.meta.fp400SoftwareZones ?? {}),publish,lastState:''};
        // Publishes only changes that happen with time (absence timeouts, staleness).
        context.timer=setInterval(()=>{
            const state=context.tracker.state(Date.now()), encoded=JSON.stringify(state);
            if (encoded!==context.lastState) {context.lastState=encoded;context.publish?.(state);}
        },1000).unref();
        softwareZoneContexts.set(device.ieeeAddr,context);
    }
    if (publish) context.publish=publish;
    return context;
}
// Tracker state for a converter to return; recorded so the timer does not publish it a second time.
function zoneState(context) {
    const state=context.tracker.state(Date.now());context.lastState=JSON.stringify(state);return state;
}
async function subscribeTracking(device, seconds=120) {
    const result=await device.getEndpoint(1).command('aqaraFp400Location','subscribeLocationData',{timeout:seconds},
        {...manufacturerOptions,disableDefaultResponse:false,disableResponse:false});
    if (result?.statusCode!==0) throw new Error(`Tracking subscription not acknowledged: ${JSON.stringify(result)}`);
}
const softwareZoneControl={
    key:Array.from({length:8},(_,i)=>`software_zone_${i+1}_config`),
    convertGet:async(entity,key,meta)=>{meta.publish(zoneState(softwareContext(meta.device,meta.publish)));},
    convertSet:async(entity,key,value,meta)=>{
        const zone=parseSoftwareZone(value), id=Number(key.split('_')[2]);
        return withDeviceLock(meta.device, async()=>{
            const zones={...meta.device.meta.fp400SoftwareZones};
            if (zone) zones[id]=zone;else delete zones[id];
            if (Object.keys(zones).length) await subscribeTracking(meta.device);
            const previous=meta.device.meta.fp400SoftwareZones;
            meta.device.meta.fp400SoftwareZones=zones;
            try {await meta.device.save();} catch(error) {meta.device.meta.fp400SoftwareZones=previous;throw error;}
            const context=softwareContext(meta.device,meta.publish);
            context.tracker.zones=zones;context.tracker.reset(id);
            return {state:zoneState(context)};
        });
    },
};
// Also creates the tracker after a restart, so zones report unknown rather than a cached state.
const softwareZoneHeartbeat={
    cluster:'aqaraFp400Radar',type:['attributeReport','readResponse'],
    convert:(model,msg,publish)=>{
        if(msg.endpoint.ID!==1)return;
        return zoneState(softwareContext(msg.device,publish));
    },
};
const softwareZoneExposes=Array.from({length:8},(_,i)=>{
    const key=`software_zone_${i+1}`;
    return [e.text(`${key}_config`,ea.ALL).withCategory('config').withDescription('Software rectangle JSON: name, x_min/x_max/y_min/y_max in observed coordinate units (approximately cm), absence_timeout in seconds; clear removes it'),
        e.binary(`${key}_occupancy`,ea.STATE,true,false).withDescription('Presence inside this software zone; unknown when positions are stale or incomplete'),
        e.binary(`${key}_available`,ea.STATE,true,false).withCategory('diagnostic').withDescription('Zone is configured and complete position data is fresh')];
}).flat();

const fp400Tracking = {
    cluster: 'aqaraFp400Location', type: ['raw'],
    convert: (model, msg, publish) => {
        if (msg.endpoint.ID !== 1) return;
        try {
            const targets = decodeTrackingFrame(msg.data);
            if (!targets) return;
            const context=softwareContext(msg.device,publish);
            context.tracker.accept(targets,Date.now());
            return {...zoneState(context), tracking_last_frame:msg.data.toString('hex').slice(0, 240),
                tracking_last_update:new Date().toISOString(), target_count:targets.length,
                targets_xy:targets.map(t => `${t.id}:${t.x}:${t.y}`).join(';') || 'none',
                tracking_targets:targets};
        } catch {
            const context=softwareContext(msg.device,publish);context.tracker.invalid=true;
            return {...zoneState(context), tracking_last_frame:msg.data.toString('hex').slice(0, 240)};
        }
    },
};
const fp400TrackingExposes = [
    e.enum('tracking_status', ea.STATE, ['valid','invalid','stale']).withCategory('diagnostic').withDescription('Validity of position reports; invalid frames do not clear targets'),
    e.text('tracking_last_frame', ea.STATE).withCategory('diagnostic').withDescription('Latest FC0C position event, hex (first 120 bytes)'),
    e.text('tracking_last_update', ea.STATE).withCategory('diagnostic').withDescription('Time of last complete position report'),
    e.numeric('target_count', ea.STATE).withDescription('Number of tracking records; may include retained tracks or animals'),
    e.text('targets_xy', ea.STATE).withDescription('id:x:y positions in raw device units; units/orientation need room calibration'),
];

export default {
    zigbeeModel: ['lumi.models.4447_8295'],
    model: 'FP400',
    vendor: 'Aqara',
    description: 'Spatial multi-sensor (presence, illuminance and people count)',
    // Numeric-name copies catch reports that arrive before the custom clusters are registered.
    fromZigbee: [softwareZoneHeartbeat, {...softwareZoneHeartbeat,cluster:"64523"}, fp400Tracking,
        fp400ZoneSettingsReport, fp400ZoneAbsenceReport,
        fp400CapacityReport, {...fp400CapacityReport, cluster: '64524'},
        fp400InstallationReport, {...fp400InstallationReport, cluster: '64522'},
        fp400LearningResult,
        fp400SensitivityReport, fp400AbsenceReport,
        fp400DepthReport, {...fp400DepthReport, cluster: '64522'},
        fp400ConfigReport, {...fp400ConfigReport, cluster: '64522'},
        aqaraHumanCount,
        {...aqaraHumanCount, cluster: '64523'},
        aqaraActivityState,
        {...aqaraActivityState, cluster: '64524'},
    ],
    toZigbee: [softwareZoneControl, fp400ZoneSettingsControl, fp400CapacityGet,
        ...fp400InstallationControl.key.map(key => ({...fp400InstallationControl, key: [key]})),
        ...fp400RegionControl.key.map(key => ({...fp400RegionControl, key: [key]})),
        ...fp400RegionGet.key.map(key => ({...fp400RegionGet, key: [key]})),
        ...fp400InterferenceZone.key.map(key => ({...fp400InterferenceZone, key: [key]})), fp400Refresh, ...Object.keys(configOptions).map((key) => ({...fp400ConfigControl, key: [key]})), fp400Learning, fp400SensitivityControl, fp400AbsenceControl, fp400DepthControl],
    exposes: [...softwareZoneExposes, ...fp400TrackingExposes,
        ...fp400ZoneExposes,
        ...fp400AdditionalExposes,
        e.numeric('detection_depth', ea.ALL).withUnit('m').withValueMin(0.5).withValueMax(10).withValueStep(0.5).withCategory('config')
            .withDescription('Forward monitoring depth across the full width, for front-facing mounting. Approximate 0.5 m grid; check the physical cutoff. 10 m clears this depth restriction.'),
        e.enum('presence_sensitivity', ea.ALL, sensitivityValues).withCategory('config')
            .withDescription('Manual presence sensitivity. AI adaptive sensitivity is a separate setting.'),
        e.numeric('absence_timeout', ea.ALL).withUnit('s').withValueMin(10).withValueMax(300).withValueStep(1).withCategory('config')
            .withDescription('Delay after the last detection before reporting no presence'),
        e.enum('spatial_learning', ea.SET, ['start']).withCategory('config')
            .withDescription('Start AI space learning only with the room empty and the sensor in its final position. Result code and event receipt time are reported; the result meaning is provisional.'),
        ...Object.entries(configOptions).map(([key, option]) =>
            (option.type === 0x10 ? e.binary(key, ea.ALL, 'ON', 'OFF') : e.enum(key, ea.ALL, Object.keys(option.values)))
                .withCategory('config').withDescription(option.description)),
        e.numeric('human_count', ea.STATE).withValueMin(0).withValueMax(10)
            .withDescription('People detected by the radar; read every 30 seconds'),
        e.enum('activity_state', ea.STATE, ['unknown', 'active', 'still'])
            .withDescription('Radar activity state; read every 30 seconds'),
    ],
    // Tracking (re)starts from the 10 s poll below: on 'start' this hook runs before the custom clusters exist.
    onEvent: async(event)=>{
        if(event.type==='stop') {
            const context=softwareZoneContexts.get(event.data.ieeeAddr);
            if(context)clearInterval(context.timer);
            softwareZoneContexts.delete(event.data.ieeeAddr);
            deviceLocks.delete(event.data.ieeeAddr);
        }
    },
    extend: [
        m.deviceAddCustomCluster(configCluster, {
            name: configCluster, ID: 64522, manufacturerCode: 0x115f,
            attributes: Object.fromEntries(Object.entries(configOptions).map(([key, option]) =>
                [key, {ID: option.id, name: key, type: option.type, write: true}])),
            commands: {startLearning: {ID: 3, name: 'startLearning', parameters: []}},
            commandsResponse: {},
        }),
        m.deviceAddCustomCluster('aqaraFp400Radar', {
            name: 'aqaraFp400Radar',
            ID: 64523,
            manufacturerCode: 0x115f,
            attributes: {humanCount: {ID: 2, name: 'humanCount', type: 0x21}},
            commands: {},
            commandsResponse: {},
        }),
        m.deviceAddCustomCluster('aqaraFp400Location', {
            name: 'aqaraFp400Location',
            ID: 64524,
            manufacturerCode: 0x115f,
            attributes: {activityState: {ID: 7, name: 'activityState', type: 0x30}},
            commands: {subscribeLocationData:{ID:0,name:'subscribeLocationData',parameters:[{name:'timeout',type:0x21}]}},
            commandsResponse: {},
        }),
        m.poll({key:'fp400_tracking_subscription',defaultIntervalSeconds:10,poll:async(device)=>{
            if(Object.keys(device.meta.fp400SoftwareZones ?? {}).length)await subscribeTracking(device);
        }}),
        m.deviceEndpoints({
            multiEndpointSkip: [...zoneSettingKeys, 'maximum_detection_targets', ...Object.keys(configOptions), ...fp400AdditionalExposes.map(expose => expose.property), 'spatial_learning', 'detection_depth', 'presence_sensitivity', 'absence_timeout'],
            endpoints: Object.fromEntries(Array.from({length: 10}, (_, i) => [String(i + 1), i + 1])),
        }),
        // The FP400 rejects configureReporting on endpoint 7 with INSUFFICIENT_SPACE.
        // Keep reports already accepted by endpoints 1 and 3-6.
        m.occupancy({endpointNames: ['1', '3', '4', '5', '6']}),
        m.occupancy({endpointNames: ['7', '8', '9', '10'], reporting: false}),
        m.identify(),
        // A read succeeds on endpoint 2; poll it because reporting is not configured.
        m.illuminance({endpointNames: ['2'], reporting: false}),
        m.poll({
            key: 'fp400_unreported_attributes',
            defaultIntervalSeconds: 60,
            poll: async (device) => {
                // An unused or temporarily unavailable zone must not block the others.
                for (const id of [7, 8, 9, 10]) {
                    try {await device.getEndpoint(id).read('msOccupancySensing', ['occupancy']);} catch {}
                }
                await device.getEndpoint(2).read('msIlluminanceMeasurement', ['measuredValue']);
            },
        }),
        m.poll({
            key: 'fp400_people_attributes',
            defaultIntervalSeconds: 30,
            poll: async (device) => {
                const endpoint = device.getEndpoint(1);
                for (const [cluster, attribute] of [['aqaraFp400Radar', 'humanCount'], ['aqaraFp400Location', 'activityState']]) {
                    try {await endpoint.read(cluster, [attribute], manufacturerOptions);} catch {}
                }
            },
        }),
    ],
    configure: async (device) => {
        await refreshZoneSettings(device);
        const endpoint = device.getEndpoint(1);
        for (const [cluster, attrs, options] of [[128, [0, 1, 2], {}], ['msOccupancySensing', [3, 4], {}], [configCluster, [20], manufacturerOptions]]) {
            try {await endpoint.read(cluster, attrs, options);} catch {}
        }
        try {
            await refreshFp400Configuration(endpoint);
        } catch {
            // Preserve basic detection on firmware without these settings.
        }
        for (const [cluster, attribute] of [['aqaraFp400Radar', 'humanCount'], ['aqaraFp400Location', 'activityState']]) {
            try {await endpoint.read(cluster, [attribute], manufacturerOptions);} catch {}
        }
        for (const id of [7, 8, 9, 10]) {
            try {await device.getEndpoint(id).read('msOccupancySensing', ['occupancy']);} catch {}
        }
    },
};

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FP400ZoneCard, registryFp400s} from '../dist/fp400-zone-card.js';

for (const admin of [false, true]) test(`renamed settings use the selected device's registry IDs (admin=${admin})`, async () => {
    const c = Object.create(FP400ZoneCard.prototype), calls = [];
    const items = [
        ['number', 'absence_timeout', 'number.office_empty_delay', '5', 'set_value', {value: 5}],
        ['select', 'presence_sensitivity', 'select.office_detection', 'high', 'select_option', {option: 'high'}],
        ['switch', 'ai_high_precision', 'switch.office_recognition', 'on', 'turn_on', {}],
    ];
    const registry = Object.fromEntries(items.map(([, key, id]) => [id, {unique_id: `0x54ef440000000001_${key}_zigbee2mqtt`}]));
    registry['text.office_zone'] = {unique_id: '0x54ef440000000001_software_zone_1_config_zigbee2mqtt'};
    registry['text.other_zone'] = {unique_id: '0x54ef440000000002_software_zone_1_config_zigbee2mqtt'};
    registry['number.other_delay'] = {unique_id: '0x54ef440000000002_absence_timeout_zigbee2mqtt'};
    c.fp = registryFp400s(registry).find(d => d.ieee === '0x54ef440000000001');
    c.config = {device: 'old_name'}; c.busy = {}; c.renderSettings = () => {};
    c.shadowRoot = {querySelector: () => ({})}; c.notice = text => {c.message = text;};
    c._hass = {user: {is_admin: admin}, states: {}, callService: async (domain, service, data) => {
        calls.push({domain, service, ...data});
        c._hass.states[data.entity_id] = {state: String(data.value ?? data.option ?? 'on')};
    }};
    for (const [domain, key, id, value, service, data] of items) {
        c._hass.states[id] = {state: 'unknown', attributes: {min: 0, max: 300}};
        assert.equal(c.entity(domain, key), id);
        await c.applySetting({dataset: {setting: id}, value, checked: true});
        assert.deepEqual(calls.at(-1), {domain, service, entity_id: id, ...data});
        assert.match(c.message, /^Saved:/);
    }
    await c.applySetting({dataset: {setting: 'number.other_delay'}, value: '20'});
    assert.equal(calls.length, 3, 'another device must not be changed');
});

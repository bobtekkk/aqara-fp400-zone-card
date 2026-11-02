import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition from '../z2m/aqara-fp400.mjs';

for(const [cluster,data,key,value] of [
    ['aqaraFp400Radar',{humanCount:3},'human_count',3],
    ['64523',{2:3},'human_count',3],
    ['aqaraFp400Location',{activityState:2},'activity_state','still'],
    ['64524',{7:2},'activity_state','still'],
    ['aqaraFp400Config',{ai_high_precision:1},'ai_high_precision','ON'],
    ['64522',{41:1},'ai_high_precision','ON'],
])test(`room ${key} filters child reports on ${cluster}`,()=>{
    const converters=definition.fromZigbee.filter(c=>c.cluster===cluster&&c.type.includes('attributeReport'));
    const converter=converters.find(c=>c.convert({}, {endpoint:{ID:1},data,device:{meta:{}}})?.[key]===value);
    assert.ok(converter,'room report is decoded');
    for(const type of ['attributeReport','readResponse'])for(const ID of [2,3,6,10])
        assert.equal(converter.convert({}, {endpoint:{ID},type,data,device:{meta:{}}})?.[key],undefined);
});

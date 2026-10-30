import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition,{fp400Poll} from '../z2m/aqara-fp400.mjs';
import {fp400Sensor} from './helpers/fp400-sensor.mjs';
const set=(d,key,value)=>definition.toZigbee.find(c=>c.key.includes(key)).convertSet(null,key,value,{device:d});
const announce=d=>definition.onEvent({type:'deviceAnnounce',data:{device:d}});
const status=async d=>{let state;await definition.toZigbee.find(c=>c.key.includes('restore_status')).convertGet(null,'restore_status',{device:d,publish:s=>{state=s;}});return state;};

test('a partial restoration retries at 10, 30, 60 and 300 seconds and then recovers',async(t)=>{
    let now=1000000;t.mock.method(Date,'now',()=>now);
    const d=fp400Sensor('partial-retry');await fp400Poll(d);await set(d,'presence_sensitivity','high');
    d.powerCut();d.fail('read','1/128/0',4);await announce(d);
    const attempts=()=>d.calls.filter(c=>c==='read/1/128/0').length;
    for(const delay of [10000,30000,60000,300000]){
        await fp400Poll(d);assert.equal((await status(d)).restore_status,'pending');
        const before=attempts();now+=delay-1;await fp400Poll(d);assert.equal(attempts(),before);
        now++;
    }
    await fp400Poll(d);assert.equal(d.get(1,128,0),2);assert.equal((await status(d)).restore_status,'complete');
});
test('an announcement bypasses retry backoff and a new user setting wins',async(t)=>{
    let now=1000000;t.mock.method(Date,'now',()=>now);
    const d=fp400Sensor('retry-new-value');await fp400Poll(d);await set(d,'presence_sensitivity','high');d.powerCut();
    d.fail('read','1/128/0');await announce(d);await fp400Poll(d);
    await set(d,'presence_sensitivity','low');await announce(d);await fp400Poll(d);
    assert.equal(d.get(1,128,0),0);assert.equal((await status(d)).restore_status,'complete');
});
test('a failed persistent save is visible and retried without losing the confirmed value',async(t)=>{
    let now=1000000;t.mock.method(Date,'now',()=>now);
    const d=fp400Sensor('retry-database');await fp400Poll(d);d.saveFails=true;
    await assert.rejects(set(d,'absence_timeout',5),/Database write failed/);
    assert.match((await status(d)).restore_error,/Database write failed/);
    d.saveFails=false;now+=10000;await fp400Poll(d);assert.equal((await status(d)).restore_status,'complete');
    d.powerCut();await announce(d);await fp400Poll(d);assert.equal(d.get(1,'msOccupancySensing',3),5);
});
test('user writes cannot interleave with restoration readback',async()=>{
    const d=fp400Sensor('restore-serialized');await fp400Poll(d);await set(d,'presence_sensitivity','high');d.powerCut();await announce(d);
    const ep=d.getEndpoint(1),write=ep.write;let release,entered;
    const pending=new Promise(r=>{entered=r;});
    ep.write=async(c,data)=>{await write(c,data);if(c===128&&data[0].value===2){entered();await new Promise(r=>{release=r;});}};
    const poll=fp400Poll(d);await pending;const user=set(d,'presence_sensitivity','low');
    await new Promise(r=>setImmediate(r));assert.equal(d.get(1,128,0),2,'new write waits for restoration');
    release();await Promise.all([poll,user]);assert.equal(d.get(1,128,0),0);
});
test('unsupported attributes are explicit; an empty or timed out read is retried during initial adoption',async(t)=>{
    let now=1000000;t.mock.method(Date,'now',()=>now);
    const d=fp400Sensor('adoption-retry');d.fail('read','1/aqaraFp400Config/41',1,new Error('Timeout, not UNSUPPORTED_ATTRIBUTE'));
    await fp400Poll(d);assert.equal((await status(d)).restore_status,'pending');
    now+=10000;await fp400Poll(d);assert.equal((await status(d)).restore_status,'complete');
    await set(d,'presence_sensitivity','high');d.powerCut();await announce(d);
    d.fail('read','1/128/0',10,Object.assign(new Error('Unsupported attribute'),{code:0x86}));
    await fp400Poll(d);assert.equal((await status(d)).restore_status,'error');
    assert.match((await status(d)).restore_error,/presence_sensitivity.*unsupported/);
    const reads=d.calls.length;now+=10000;await fp400Poll(d);assert.equal(d.calls.length,reads+1,'only initial room presence is retried without a reporting context');
});

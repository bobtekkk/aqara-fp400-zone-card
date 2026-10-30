import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FP400ZoneCard} from '../dist/fp400-zone-card.js';

const before='2026-10-29T10:00:00.000Z', after='2026-10-29T10:00:10.000Z';
function learner(){
    const c=Object.create(FP400ZoneCard.prototype);
    c.config={device:'fp'}; c.loaded=new Set(); c.saved={}; c.drafts={}; c.dirty=new Set();
    c.shadowRoot={querySelector:()=>({contains:()=>false})};
    for(const key of ['renderList','renderInspector','renderMap','renderLive','renderButtons','renderSettings'])c[key]=()=>{};
    c._hass={states:{},callService:async()=>{}};c.notice=(text,type)=>{c.message=text;c.messageType=type;};
    c.learnBefore=before;
    c.result=(time,state='result_received',code='0')=>{
        for(const [key,value] of Object.entries({learning_result_time:time,learning_state:state,learning_result_code:code}))c._hass.states[`sensor.fp_${key}`]={state:value};
        c.sync();
    };
    return c;
}
test('clearing the prior result and old timestamps cannot finish learning',()=>{
    const c=learner();
    for(const time of [undefined,null,'','unknown','unavailable','not a date',before]){
        c.result(time,'accepted');assert.equal(c.learnBefore,before);assert.notEqual(c.messageType,'success');
    }
    c.result(after,'accepted');assert.equal(c.learnBefore,before,'time alone is not a result event');
    c.result('2026-10-28T10:00:00.000Z');assert.equal(c.learnBefore,before,'older retained results are ignored');
    c.result(after);assert.equal(c.learnBefore,undefined);assert.match(c.message,/result received.*code 0/i);
    assert.doesNotMatch(c.message,/finished|successful/i,'raw result code has no validated success interpretation');
});
test('timeout is not success, and late results do not complete a discarded attempt',async(t)=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const c=learner();c.learnBefore=undefined;c.learnArmed=true;
    await c.learn();assert.notEqual(c.learnBefore,undefined,'a first-ever learning can be pending');
    t.mock.timers.tick(30000);assert.equal(c.learnBefore,undefined);assert.match(c.message,/No learning result/);
    c.result(after);assert.match(c.message,/No learning result/);
    c.disconnectedCallback();
});
test('a result received during service acknowledgement is observed; command failure clears the attempt',async()=>{
    const c=learner();c.learnBefore=undefined;c.learnArmed=true;c.result(before);
    c._hass.callService=async()=>c.result(after,'result_received','7');
    await c.learn();assert.match(c.message,/result received.*code 7/i);assert.equal(c.learnBefore,undefined);
    c.learnArmed=true;c._hass.callService=async()=>{throw new Error('Offline');};
    await c.learn();assert.equal(c.learnBefore,undefined);assert.equal(c.message,'Offline');
    c.disconnectedCallback();
});

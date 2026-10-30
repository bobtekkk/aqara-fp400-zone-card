import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SoftwareZoneTracker} from '../z2m/aqara-fp400.mjs';

const zone={name:'Desk',x_min:-100,x_max:100,y_min:0,y_max:200,absence_timeout:3};
for(const reported of [2,3])test(`partial positions cancel an existing absence countdown (${reported} reported)`,()=>{
    const t=new SoftwareZoneTracker({1:zone});
    t.accept([{id:1,x:0,y:80}],0);
    t.accept([{id:1,x:200,y:80}],1000);
    t.accept([{id:2,x:300,y:80}],2000,reported);
    assert.equal(t.state(4000).tracking_status,'partial');
    assert.equal(t.state(4000).software_zone_1_occupancy,true,'missing positions cannot confirm absence');
    t.accept([{id:2,x:300,y:80}],5000);
    assert.equal(t.state(7999).software_zone_1_occupancy,true);
    assert.equal(t.state(8000).software_zone_1_occupancy,false,'a complete snapshot starts a new delay');
});
test('room absence can clear a zone held by partial positions',()=>{
    const t=new SoftwareZoneTracker({1:zone});
    t.accept([{id:1,x:0,y:80}],0);t.accept([{id:1,x:200,y:80}],1000);
    t.accept([{id:2,x:300,y:80}],2000,3);t.setPresence(false,2500);
    assert.equal(t.state(2600).software_zone_1_occupancy,false);
});

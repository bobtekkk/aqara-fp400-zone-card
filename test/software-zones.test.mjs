import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition,{SoftwareZoneTracker,parseSoftwareZone} from '../z2m/aqara-fp400.mjs';
const desk=parseSoftwareZone({name:'Desk',x_min:-140,x_max:60,y_min:8,y_max:158,absence_timeout:3});
test('desk entry, delayed exit, and stale data',()=>{
 const t=new SoftwareZoneTracker({1:desk});
 assert.equal(t.state(0).software_zone_1_occupancy,null);
 t.accept([{id:1,x:-40,y:83}],1000);
 assert.equal(t.state(1000).software_zone_1_occupancy,true);
 t.accept([{id:1,x:200,y:83}],2000);
 assert.equal(t.state(4999).software_zone_1_occupancy,true);
 assert.equal(t.state(5000).software_zone_1_occupancy,false);
 t.accept([{id:1,x:-40,y:83}],6000);
 assert.equal(t.state(35999).software_zone_1_occupancy,true);
 assert.equal(t.state(36000).software_zone_1_occupancy,null);
 assert.equal(t.state(36000).tracking_status,'stale');
});
test('bad packet cannot imply absence; next complete snapshot recovers',()=>{
 const t=new SoftwareZoneTracker({1:desk});t.accept([{x:0,y:100}],0);t.invalid=true;
 assert.equal(t.state(1000).software_zone_1_available,false);
 assert.equal(t.state(1000).software_zone_1_occupancy,null);
 t.accept([{x:0,y:100}],2000);assert.equal(t.state(2000).software_zone_1_occupancy,true);
 t.accept([],3000);assert.equal(t.state(6000).software_zone_1_occupancy,false);
});
test('multiple targets and independent zones',()=>{
 const t=new SoftwareZoneTracker({1:desk,2:parseSoftwareZone({...desk,name:'Other',x_min:100,x_max:200})});
 t.accept([{x:0,y:80},{x:150,y:80}],0);
 assert.equal(t.state(0).software_zone_1_occupancy,true);assert.equal(t.state(0).software_zone_2_occupancy,true);
 t.accept([{x:150,y:80}],1000);
 assert.equal(t.state(4000).software_zone_1_occupancy,false);assert.equal(t.state(4000).software_zone_2_occupancy,true);
 assert.equal(t.state(4000).software_zone_3_occupancy,null);
});
test('zone bounds are validated before saving',()=>{
 for(const z of [{...desk,x_min:60},{...desk,y_min:NaN},{...desk,absence_timeout:-1},{...desk,name:'x'.repeat(33)},[]])assert.throws(()=>parseSoftwareZone(z));
 assert.equal(parseSoftwareZone('clear'),null);
 assert.deepEqual(parseSoftwareZone(JSON.stringify(desk)),desk);
});
test('save/reload configuration; rejected subscription does not claim success',async()=>{
 let saved=0;
 const device={ieeeAddr:'test-device',meta:{},save:async()=>{saved++;},getEndpoint:()=>({command:async()=>({statusCode:0})})};
 const c=definition.toZigbee.find(c=>c.key.includes('software_zone_1_config'));
 const result=await c.convertSet(null,'software_zone_1_config',desk,{device,publish:()=>{}});
 assert.equal(saved,1);assert.deepEqual(device.meta.fp400SoftwareZones[1],desk);
 assert.equal(result.state.software_zone_1_occupancy,null);
 const restored=new SoftwareZoneTracker(device.meta.fp400SoftwareZones);restored.accept([{x:0,y:80}],0);
 assert.equal(restored.state(0).software_zone_1_occupancy,true);
 device.getEndpoint=()=>({command:async()=>({statusCode:128})});
 await assert.rejects(()=>c.convertSet(null,'software_zone_2_config',desk,{device,publish:()=>{}}));assert.equal(saved,1);
 await definition.onEvent({type:'stop',data:{ieeeAddr:device.ieeeAddr}});
});
test('two zone saves at the same moment both persist',async()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const device={ieeeAddr:'zone-race',meta:{},save:async()=>{},getEndpoint:()=>({command:async()=>{await sleep(20);return {statusCode:0};}})};
 const c=definition.toZigbee.find(c=>c.key.includes('software_zone_1_config'));
 await Promise.all([['software_zone_1_config','Desk'],['software_zone_2_config','Bed']].map(([key,name])=>c.convertSet(null,key,{...desk,name},{device,publish:()=>{}})));
 assert.deepEqual(Object.values(device.meta.fp400SoftwareZones).map(z=>z.name).sort(),['Bed','Desk']);
 await definition.onEvent({type:'stop',data:{ieeeAddr:device.ieeeAddr}});
});
test('editing one zone does not blank the other zones',()=>{
 const t=new SoftwareZoneTracker({1:desk,2:parseSoftwareZone({...desk,name:'Other',x_min:100,x_max:200})});
 t.accept([{x:0,y:80}],0);
 t.zones={...t.zones,2:parseSoftwareZone({...desk,name:'Other',x_min:120,x_max:220})};t.reset(2);
 assert.equal(t.state(500).software_zone_1_occupancy,true);
 assert.equal(t.state(500).software_zone_2_occupancy,null);
 t.accept([{x:0,y:80}],1000);assert.equal(t.state(1000).software_zone_2_occupancy,false);
});
test('a position frame reports its status and is not published a second time by the timer',async()=>{
 const frames=definition.fromZigbee.find(c=>c.cluster==='aqaraFp400Location'&&c.type.includes('raw'));
 const device={ieeeAddr:'frame-test',meta:{fp400SoftwareZones:{1:desk}}},published=[];
 const ok=frames.convert({},{endpoint:{ID:1},data:Buffer.from('1c5f11758b00004c0000','hex'),device},s=>published.push(s));
 assert.equal(ok.tracking_status,'valid');assert.equal(ok.targets_xy,'none');assert.equal(ok.software_zone_1_occupancy,false);
 await new Promise(r=>setTimeout(r,1300));
 assert.equal(published.length,0,'timer re-published an unchanged state');
 const bad=frames.convert({},{endpoint:{ID:1},data:Buffer.from('1c5f11758b00004c0b00','hex'),device},s=>published.push(s));
 assert.equal(bad.tracking_status,'invalid');assert.equal(bad.software_zone_1_occupancy,null);
 await definition.onEvent({type:'stop',data:{ieeeAddr:device.ieeeAddr}});
});
test('blank zone names are rejected like the card does',()=>assert.throws(()=>parseSoftwareZone({...desk,name:'   '})));
test('configuration controls cannot be mistaken for numbered endpoints',()=>{
 const endpoints=Object.keys(definition.extend.find(e=>e.endpoint).endpoint());
 for(const converter of definition.toZigbee.filter(c=>c.key.some(k=>k.startsWith('software_zone_')))) {
  for(const key of converter.key)assert.equal(endpoints.some(endpoint=>key.endsWith(`_${endpoint}`)),false,`${key} would be split into an endpoint suffix`);
 }
});

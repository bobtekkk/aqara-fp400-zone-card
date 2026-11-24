import {test} from 'node:test';
import assert from 'node:assert/strict';
import definition,{SoftwareZoneTracker,parseSoftwareZone,inZone} from '../z2m/aqara-fp400.mjs';
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
test('a report cut short keeps missing targets where they were last seen',()=>{
 const bed=parseSoftwareZone({name:'Bed',x_min:-60,x_max:150,y_min:210,y_max:320,absence_timeout:3});
 const t=new SoftwareZoneTracker({1:desk,2:bed});
 t.accept([{id:1,x:0,y:80,moving:false},{id:2,x:50,y:250,moving:true}],0);
 t.accept([{id:1,x:0,y:80,moving:false},{id:7,x:-300,y:600,moving:false},{id:8,x:300,y:900,moving:false}],1000,4); // id 2 did not arrive
 let s=t.state(9000);
 assert.deepEqual([s.software_zone_2_occupancy,s.software_zone_2_count,s.software_zone_2_activity,s.tracking_status],[true,1,'moving','partial']);
 t.accept([{id:1,x:0,y:80,moving:false}],10000); // a complete report without id 2: it is gone
 s=t.state(13000);
 assert.deepEqual([s.software_zone_1_occupancy,s.software_zone_2_occupancy,s.software_zone_2_count],[true,false,0]);
});
test('a cut report that cannot account for everyone never empties a zone',()=>{
 const t=new SoftwareZoneTracker({1:desk});
 t.accept([{id:9,x:300,y:900}],0,4); // just started: 3 of 4 targets unknown
 assert.equal(t.state(10000).software_zone_1_occupancy,null);assert.equal(t.state(10000).software_zone_1_available,false);
 t.accept([{id:9,x:300,y:900}],11000);
 assert.equal(t.state(14000).software_zone_1_occupancy,false);
 t.accept([{id:1,x:0,y:80}],15000);t.accept([{id:9,x:300,y:900}],16000,3); // id 1 was seen in the desk, then went missing
 assert.equal(t.state(30000).software_zone_1_occupancy,true);
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
test('zone people count, moving/still, and enter/leave events',()=>{
 const t=new SoftwareZoneTracker({1:desk});
 assert.deepEqual(t.accept([{id:0,x:0,y:80,moving:false}],0),[],'nothing is known before the first frame');
 assert.equal(t.state(0).software_zone_1_count,1);assert.equal(t.state(0).software_zone_1_activity,'still');
 assert.deepEqual(t.accept([{id:0,x:0,y:80,moving:true},{id:1,x:-50,y:100,moving:false}],100),[{zone:1,type:'enter'}]);
 assert.equal(t.state(100).software_zone_1_count,2);assert.equal(t.state(100).software_zone_1_activity,'moving');
 assert.deepEqual(t.accept([{id:1,x:-50,y:100,moving:false}],200),[{zone:1,type:'leave'}]);
 assert.deepEqual(t.accept([],300),[{zone:1,type:'leave'}]);
 assert.equal(t.state(300).software_zone_1_count,0);assert.equal(t.state(300).software_zone_1_activity,null);
 t.reset(1);assert.deepEqual(t.accept([{id:5,x:0,y:80}],400),[],'no burst of events right after an edit');
 assert.equal(t.state(31400).software_zone_1_count,null,'stale data has no count');
});
test('blank zone names are rejected like the card does',()=>assert.throws(()=>parseSoftwareZone({...desk,name:'   '})));
test('configuration controls cannot be mistaken for numbered endpoints',()=>{
 const endpoints=Object.keys(definition.extend.find(e=>e.endpoint).endpoint());
 for(const converter of definition.toZigbee.filter(c=>c.key.some(k=>k.startsWith('software_zone_')))) {
  for(const key of converter.key)assert.equal(endpoints.some(endpoint=>key.endsWith(`_${endpoint}`)),false,`${key} would be split into an endpoint suffix`);
 }
});
test('a zone drawn on a turned map checks targets in its own frame',()=>{
 const z=parseSoftwareZone({name:'Bed',x_min:0,x_max:100,y_min:200,y_max:300,rotation:90});
 assert.equal(inZone({x:-250,y:50},z),true);assert.equal(inZone({x:50,y:250},z),false);
 const t=new SoftwareZoneTracker({1:z});t.accept([{id:1,x:-250,y:50}],0);assert.equal(t.state(0).software_zone_1_occupancy,true);
 assert.equal('rotation' in parseSoftwareZone({name:'Bed',x_min:0,x_max:100,y_min:200,y_max:300,rotation:0}),false);
 assert.throws(()=>parseSoftwareZone({name:'Bed',x_min:0,x_max:100,y_min:200,y_max:300,rotation:181}),/rotation/);
});
test('when positions pause, the sensor\'s own presence keeps the zones: held while someone is there, empty when nobody is',()=>{
 const t=new SoftwareZoneTracker({1:desk});
 t.accept([{id:1,x:0,y:80,moving:false}],0);
 assert.equal(t.state(31000).software_zone_1_occupancy,null,'no positions and no presence: unknown');
 t.setPresence(true,31000);
 let s=t.state(60000);
 assert.deepEqual([s.software_zone_1_occupancy,s.software_zone_1_count,s.software_zone_1_activity,s.software_zone_1_available,s.tracking_status],[true,1,'still',true,'held']);
 assert.deepEqual(t.setPresence(false,61000),[{zone:1,type:'leave'}]);
 s=t.state(62000);
 assert.deepEqual([s.software_zone_1_occupancy,s.software_zone_1_count,s.software_zone_1_available,s.tracking_status],[false,0,true,'held']);
 t.reset(1);assert.equal(t.state(63000).software_zone_1_occupancy,false,'a zone edited in an empty room is empty at once');
 t.accept([{id:2,x:0,y:80,moving:true}],64000);assert.equal(t.state(64000).software_zone_1_occupancy,true,'fresh positions win again');
});
test('activity: moving if anyone moves, still only if everyone is still, otherwise unknown',()=>{
 const t=new SoftwareZoneTracker({1:desk}),act=targets=>{t.accept(targets,0);return t.state(0).software_zone_1_activity;};
 assert.equal(act([{id:1,x:0,y:80}]),null,'old firmware sent raw 11 on one unit: no moving flag');
 assert.equal(t.state(0).software_zone_1_occupancy,true,'the zone is still occupied');
 assert.equal(act([{id:1,x:0,y:80,moving:false},{id:2,x:10,y:80}]),null);
 assert.equal(act([{id:1,x:0,y:80,moving:true},{id:2,x:10,y:80}]),'moving');
 assert.equal(act([{id:1,x:0,y:80,moving:false},{id:2,x:10,y:80,moving:false}]),'still');
});
test('people only: zones leave out what the sensor calls a pet or an object, and keep people, children and unknowns',()=>{
 const t=new SoftwareZoneTracker({1:desk}),pet={id:2,x:10,y:80,moving:true,type:'pet'};
 t.accept([pet],0);
 assert.deepEqual([t.state(0).software_zone_1_count,t.state(0).software_zone_1_activity],[1,'moving'],'off by default: a pet counts');
 t.peopleOnly=true;
 const frame=[{id:1,x:0,y:80,moving:false,type:'person'},{...pet},{id:3,x:-20,y:90,type:'vacuum'},{id:4,x:20,y:70,moving:false,type:'child'},{id:5,x:30,y:60,moving:false}];
 const events=t.accept(frame,100);
 assert.deepEqual([t.state(100).software_zone_1_count,t.state(100).software_zone_1_activity],[3,'still'],'person, child and the dot of unknown type count; the moving pet does not');
 assert.deepEqual(frame.map(f=>f.ignored??false),[false,true,true,false,false],'what the zones leave out is marked for the card');
 assert.deepEqual(events,[{zone:1,type:'enter'},{zone:1,type:'enter'},{zone:1,type:'enter'},{zone:1,type:'leave'}],'the pet leaves the zone, the others enter');
 for (const type of ['not_person','fan','curtain','plant','air_purifier']) assert.equal(t.ignores({type}),true,type);
 // A record the coordinator cut before its type keeps the type it had a moment ago.
 const cut=[{id:2,x:10,y:80,moving:true}];
 t.accept(cut,200,1);
 assert.deepEqual([cut[0].type,cut[0].ignored,t.state(200).software_zone_1_count],['pet',true,0]);
 t.peopleOnly=false;t.accept([{id:2,x:10,y:80,moving:true}],300);
 assert.equal(t.state(300).software_zone_1_count,1,'turned off: the pet counts again');
});
test('a reused id does not take the type of a dot that left frames ago',()=>{
 const t=new SoftwareZoneTracker({1:desk}),far={id:1,x:300,y:900,moving:false,type:'person'};t.peopleOnly=true;
 t.accept([{id:7,x:0,y:80,moving:true,type:'pet'},{...far}],0);
 t.accept([{...far}],100,4);t.accept([{...far}],200,4); // Ember cut these frames: the pet with id 7 is not in them
 const person={id:7,x:0,y:80,moving:false}; // someone new with the pet's old id, cut before the type
 t.accept([{...far},person],300,4);
 assert.deepEqual([person.type,person.ignored,t.state(300).software_zone_1_count],[undefined,undefined,1]);
});

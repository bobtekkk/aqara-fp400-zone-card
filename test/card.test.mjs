import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeZone,rectangleFromPoints,moveRectangle,fitView,parseTargets,rectBits,draftMask,turn,rangeBox,opPoints,opBits,findDevice,FP400ZoneCard} from '../dist/fp400-zone-card.js';
const desk={name:'Desk',x_min:-115,x_max:85,y_min:-19,y_max:131,absence_timeout:3};
test('grid drawing works in every drag direction and snaps to half metres',()=>{
 assert.deepEqual(rectangleFromPoints({x:114,y:174},{x:-112,y:21}),{x_min:-100,x_max:100,y_min:0,y_max:150});
 assert.deepEqual(rectangleFromPoints({x:-112,y:21},{x:114,y:174}),{x_min:-100,x_max:100,y_min:0,y_max:150});
});
test('moving an existing off-grid zone preserves its dimensions and offset',()=>{
 assert.deepEqual(moveRectangle(desk,57,-28),{...desk,x_min:-65,x_max:135,y_min:-50,y_max:100});
 const edge=moveRectangle(desk,10000,10000);assert.equal(edge.x_max,400);assert.equal(edge.y_max,1000);assert.equal(edge.x_max-edge.x_min,200);
});
test('moving a zone that is already outside the map never makes it jump',()=>{
 const far={...desk,x_min:-1000,x_max:-500};
 assert.deepEqual(moveRectangle(far,-1,0),far);assert.deepEqual(moveRectangle(far,-120,0,0),far);
 const wide={...desk,x_min:-900,x_max:900};assert.deepEqual(moveRectangle(wide,30,0,0),wide);
 assert.equal(moveRectangle(far,200,0).x_min,-800);
});
test('the card picker writes no device, so renaming the sensor later cannot break the card; it finds the FP400 itself',()=>{
 assert.deepEqual(FP400ZoneCard.getStubConfig({states:{'text.living_room_fp400_software_zone_1_config':{state:'clear'}}}),{});
 assert.equal(findDevice({states:{'light.kitchen':{},'text.living_room_fp400_software_zone_1_config':{state:'clear'}}}),'living_room_fp400');
 assert.equal(findDevice({states:{'light.kitchen':{}}}),null);
});
test('a configured FP400 that was renamed falls back to the only one Home Assistant has, and says so',()=>{
 const c=Object.create(FP400ZoneCard.prototype);c.dirty=new Set();c.loaded=new Set();c.notice=t=>{c.message=t;};
 c.config={device:'old_name'};c._hass={states:{'text.new_name_software_zone_1_config':{state:'clear'}}};
 c.resolveDevice();assert.equal(c.device,'new_name');assert.match(c.message,/old_name.*new_name/);
 c._hass.states['text.other_software_zone_1_config']={state:'clear'};c.resolveDevice();
 assert.equal(c.device,'old_name','with two candidates it does not guess');assert.match(c.message,/new_name, other/);
 c.config={device:'other'};c.resolveDevice();assert.equal(c.device,'other');assert.equal(c.deviceNote,null);
});
test('turned maps: points turn around the sensor, and the range box turns with them',()=>{
 const p=turn({x:100,y:0},90);assert.ok(Math.abs(p.x)<1e-9&&Math.abs(p.y-100)<1e-9);
 assert.deepEqual(rangeBox(0),{x_min:-400,x_max:400,y_min:-50,y_max:1000});
 assert.deepEqual(rangeBox(90),{x_min:-50,x_max:1000,y_min:-400,y_max:400});
 const b=rangeBox(45);assert.deepEqual(fitView([],45),{x:b.x_min,y:b.y_min,width:b.x_max-b.x_min,height:b.y_max-b.y_min},'an empty turned map shows the whole range');
 assert.deepEqual(fitView([]),{x:-300,y:-50,width:600,height:600});
});
test('zones keep the turn of the map they were drawn on',()=>{
 assert.equal(normalizeZone({...desk,rotation:45}).rotation,45);
 assert.equal('rotation' in normalizeZone({...desk,rotation:0}),false);
 assert.throws(()=>normalizeZone({...desk,rotation:200}));
});
test('areas: a straight map sends rectangles; a turned one sends corner points covering the right cells',()=>{
 const rect={x_min:-100,x_max:0,y_min:100,y_max:200};
 assert.deepEqual(opBits({rect}),rectBits(rect));
 const turned={rect:{x_min:-300,x_max:-200,y_min:-100,y_max:0},rotation:-90};
 assert.deepEqual(opPoints(turned),[[-100,300],[-100,200],[0,200],[0,300]]);
 assert.deepEqual(opBits(turned),rectBits({x_min:-100,x_max:0,y_min:200,y_max:300}));
});
test('invalid input never becomes a usable zone; user names remain data',()=>{
 assert.throws(()=>normalizeZone({...desk,x_max:-115}));assert.throws(()=>normalizeZone({...desk,name:''}));assert.throws(()=>normalizeZone({...desk,absence_timeout:NaN}));
 assert.equal(normalizeZone('clear'),null);assert.deepEqual(normalizeZone(JSON.stringify(desk)),desk);
 assert.equal(normalizeZone({...desk,name:'<img src=x onerror=alert(1)>'}).name,'<img src=x onerror=alert(1)>');
 assert.deepEqual(parseTargets('1:-25:82;bad;2:300:150'),[{id:1,x:-25,y:82},{id:2,x:300,y:150}]);
 assert.deepEqual(parseTargets('none'),[]);
});
function editor(){
 const c=Object.create(FP400ZoneCard.prototype);c.config={device:'0x54ef440000000001'};c.saved={1:desk,2:null};c.drafts={1:{...desk,name:'Desk revised'},2:null};c.base={1:{...desk}};c.dirty=new Set([1]);c.loaded=new Set([1,2]);c.saving=false;c.pendingAreas=[];c.pendingClears=new Set();c.render=()=>{};c.notice=(text)=>{c.message=text;};c._hass={user:{is_admin:false},callService:async()=>{}};return c;
}
test('save sends only changed zones and waits for confirmed device state',async()=>{
 const c=editor(),sent=[];c._hass.callService=async(domain,service,data)=>{sent.push({domain,service,data});c.saved[1]=JSON.parse(data.value);};
 await c.save();assert.equal(sent.length,1);assert.equal(sent[0].domain,'text');assert.equal(sent[0].data.entity_id,'text.0x54ef440000000001_software_zone_1_config');assert.equal(c.dirty.size,0);assert.match(c.message,/Saved/);
});
test('unconfirmed save keeps edits and does not report success',async()=>{
 const c=editor();c.confirm=async()=>{throw new Error('No device acknowledgement');};await c.save();assert.equal(c.dirty.size,1);assert.match(c.message,/acknowledgement/);assert.equal(c.saving,false);
});
test('a confirmation that arrives after the timeout clears the unsaved mark',async()=>{
 const c=editor();c.confirm=async()=>{throw new Error('Zone 1 was not confirmed');};
 await c.save();assert.equal(c.dirty.size,1);
 for(const f of ['renderList','renderInspector','renderMap','renderLive','renderButtons'])c[f]=()=>{};
 c.shadowRoot={querySelector:()=>({contains:()=>false})};
 c._hass.states={'text.0x54ef440000000001_software_zone_1_config':{state:JSON.stringify(c.drafts[1])}};
 c.sync();
 assert.equal(c.dirty.size,0);
 c.base={1:{...c.saved[1]}};c.dirty.add(1);c.drafts[1]={...desk,name:'Mine'};
 c._hass.states={'text.0x54ef440000000001_software_zone_1_config':{state:JSON.stringify({...desk,name:'Theirs'})}};
 c.sync();
 assert.equal(c.dirty.has(1),true,'a different external change must stay a conflict');
});
test('concurrent external edits block writes rather than overwrite them',async()=>{
 const c=editor();c.saved[1]={...desk,name:'Changed elsewhere'};let calls=0;c._hass.callService=async()=>{calls++;};await c.save();assert.equal(calls,0);assert.match(c.message,/changed elsewhere/);
});
// A fake sensor: masks change a little after each call, like the real converter.
function areaSensor(c,bits){
 const key='sensor.0x54ef440000000001_interference_mask_hex',calls=[];
 const hex=()=>{const m=new Uint8Array(40);for(const b of bits)m[b>>3]|=0x80>>(b%8);return [...m].map(v=>v.toString(16).padStart(2,'0')).join('');};
 c._hass.states={[key]:{state:hex()}};
 c._hass.callService=async(d,s,data)=>{const op=data.entity_id.split('_').slice(-2).join('_');calls.push(op);setTimeout(()=>{if(op==='interference_clear')bits.clear();else for(const b of rectBits(JSON.parse(data.value)))op==='zone_add'?bits.add(b):bits.delete(b);c._hass.states[key]={state:hex()};},40);};
 return calls;
}
test('areas: clear first, then one confirmed edit at a time, skipping edits already in place',async()=>{
 const c=editor(),bits=new Set([0,200]);c.dirty=new Set();c.base={};
 c.pendingClears=new Set(['interference']);c.pendingAreas=[{type:'interference',op:'add',rect:{x_min:-400,x_max:-300,y_min:0,y_max:100}},{type:'interference',op:'add',rect:{x_min:-400,x_max:-350,y_min:0,y_max:50}}];
 const calls=areaSensor(c,bits);
 await c.save();
 assert.deepEqual(calls,['interference_clear','zone_add']);assert.deepEqual([...bits].sort((a,b)=>a-b),rectBits({x_min:-400,x_max:-300,y_min:0,y_max:100}));
 assert.equal(c.pendingAreas.length,0);assert.equal(c.pendingClears.size,0);assert.equal(c.mode,'select');assert.match(c.message,/Saved/);
});
test('areas: erasing sends a remove and waits until the cells are gone',async()=>{
 const c=editor(),painted=rectBits({x_min:-400,x_max:-200,y_min:0,y_max:100}),bits=new Set(painted);c.dirty=new Set();c.base={};
 c.pendingAreas=[{type:'interference',op:'remove',rect:{x_min:-400,x_max:-300,y_min:0,y_max:100}},{type:'interference',op:'remove',rect:{x_min:-400,x_max:-350,y_min:0,y_max:50}}];
 const calls=areaSensor(c,bits);
 await c.save();
 assert.deepEqual(calls,['zone_remove'],'the second erase is already done by the first');
 assert.deepEqual([...bits].sort((a,b)=>a-b),rectBits({x_min:-300,x_max:-200,y_min:0,y_max:100}));
});
test('the map preview applies a clear, paints and erases in order',()=>{
 const r=(x_min,x_max)=>({x_min,x_max,y_min:0,y_max:50});
 assert.deepEqual([...draftMask(new Set([100]),false,[{op:'add',rect:r(300,400)},{op:'remove',rect:r(350,400)}])].sort((a,b)=>a-b),[1,100]);
 assert.deepEqual([...draftMask(new Set([100]),true,[{op:'add',rect:r(350,400)}])],[0]);
 assert.deepEqual([...draftMask(null)],[]);
});
test('admins get zone entities named after the zone; names typed by hand are kept; deleting gives back only names the card gave',async()=>{
 const c=editor(),ws=[],id=s=>`0x54ef440000000001_software_zone_1_${s}`;
 c._hass.user.is_admin=true;c._hass.callWS=async m=>{ws.push(m);};
 c._hass.states={[`binary_sensor.${id('occupancy')}`]:{attributes:{friendly_name:'Desk occupancy'}},[`binary_sensor.${id('available')}`]:{attributes:{friendly_name:'My own name'}},
  [`text.${id('config')}`]:{attributes:{friendly_name:'Desk zone configuration'}},[`sensor.${id('count')}`]:{attributes:{friendly_name:'x Software zone 1 count'}}};
 await c.nameEntities(1,{...desk,name:'Office'},desk);
 assert.deepEqual(ws.map(m=>[m.entity_id.split('.')[0]+'.'+m.entity_id.split('_').slice(-1)[0],m.name,m.device_class]),[['binary_sensor.occupancy','Office occupancy','occupancy'],['text.config','Office zone configuration',undefined],['sensor.count','Office people',undefined]],'"My own name" stays');
 ws.length=0;await c.nameEntities(1,desk,desk);
 assert.deepEqual(ws.map(m=>m.name),['Desk people'],'on load, only the still-default count is named; nothing else changes');
 ws.length=0;await c.nameEntities(1,null,desk);
 assert.deepEqual(ws.map(m=>[m.entity_id.split('_').slice(-1)[0],m.name]),[['occupancy',null],['config',null]],'only names the card set are reset; a missing entity (activity) is skipped');
 c._hass.user.is_admin=false;ws.length=0;await c.nameEntities(1,desk,null);assert.equal(ws.length,0);
});
test('deletion uses clear; partial save preserves only the failed changes',async()=>{
 const c=editor();c.drafts[1]=null;c.drafts[2]={...desk,name:'Second'};c.base[2]=null;c.dirty.add(2);let calls=0;
 c._hass.callService=async(d,s,data)=>{calls++;if(calls===1){assert.equal(data.value,'clear');c.saved[1]=null;}else throw new Error('Offline');};
 await c.save();assert.deepEqual([...c.dirty],[2]);assert.match(c.message,/1 saved.*Offline/);
});

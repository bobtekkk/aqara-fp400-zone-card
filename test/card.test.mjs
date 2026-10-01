import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeZone,rectangleFromPoints,moveRectangle,fitView,parseTargets,rectBits,FP400ZoneCard} from '../dist/fp400-zone-card.js';
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
test('the card picker finds the FP400 by its entities, whatever it is called',()=>{
 assert.deepEqual(FP400ZoneCard.getStubConfig({states:{'light.kitchen':{},'text.living_room_fp400_software_zone_1_config':{state:'clear'}}}),{device:'living_room_fp400'});
 assert.deepEqual(FP400ZoneCard.getStubConfig({states:{'light.kitchen':{}}}),{});
});
test('invalid input never becomes a usable zone; user names remain data',()=>{
 assert.throws(()=>normalizeZone({...desk,x_max:-115}));assert.throws(()=>normalizeZone({...desk,name:''}));assert.throws(()=>normalizeZone({...desk,absence_timeout:NaN}));
 assert.equal(normalizeZone('clear'),null);assert.deepEqual(normalizeZone(JSON.stringify(desk)),desk);
 assert.equal(normalizeZone({...desk,name:'<img src=x onerror=alert(1)>'}).name,'<img src=x onerror=alert(1)>');
 assert.deepEqual(parseTargets('1:-25:82;bad;2:300:150'),[{id:1,x:-25,y:82},{id:2,x:300,y:150}]);
 assert.deepEqual(parseTargets('none'),[]);
});
function editor(){
 const c=Object.create(FP400ZoneCard.prototype);c.config={device:'0x54ef440000000001'};c.saved={1:desk,2:null};c.drafts={1:{...desk,name:'Desk revised'},2:null};c.base={1:{...desk}};c.dirty=new Set([1]);c.loaded=new Set([1,2]);c.saving=false;c.render=()=>{};c.notice=(text)=>{c.message=text;};c._hass={user:{is_admin:false},callService:async()=>{}};return c;
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
test('blocks: clear first, then one confirmed add at a time, skipping covered blocks',async()=>{
 const c=editor(),key='sensor.0x54ef440000000001_interference_mask_hex',bits=new Set([0,200]),calls=[];
 c.dirty=new Set();c.base={};c.pendingClear=true;c.pendingBlocks=[{x_min:-400,x_max:-300,y_min:0,y_max:100},{x_min:-400,x_max:-350,y_min:0,y_max:50}];
 const hex=()=>{const m=new Uint8Array(40);for(const b of bits)m[b>>3]|=0x80>>(b%8);return [...m].map(v=>v.toString(16).padStart(2,'0')).join('');};
 c._hass.states={[key]:{state:hex()}};
 c._hass.callService=async(d,s,data)=>{const op=data.entity_id.split('_').slice(-2).join('_');calls.push(op);setTimeout(()=>{if(op==='interference_clear')bits.clear();else for(const b of rectBits(JSON.parse(data.value)))bits.add(b);c._hass.states[key]={state:hex()};},40);};
 await c.save();
 assert.deepEqual(calls,['interference_clear','zone_add']);assert.deepEqual([...bits].sort((a,b)=>a-b),rectBits({x_min:-400,x_max:-300,y_min:0,y_max:100}));
 assert.equal(c.pendingBlocks.length,0);assert.equal(c.pendingClear,false);assert.equal(c.mode,'select');assert.match(c.message,/Saved/);
});
test('deletion uses clear; partial save preserves only the failed changes',async()=>{
 const c=editor();c.drafts[1]=null;c.drafts[2]={...desk,name:'Second'};c.base[2]=null;c.dirty.add(2);let calls=0;
 c._hass.callService=async(d,s,data)=>{calls++;if(calls===1){assert.equal(data.value,'clear');c.saved[1]=null;}else throw new Error('Offline');};
 await c.save();assert.deepEqual([...c.dirty],[2]);assert.match(c.message,/1 saved.*Offline/);
});

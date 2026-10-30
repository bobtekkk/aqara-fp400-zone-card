import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FP400ZoneCard,normalizeNativeZone,maskHex,maskBits} from '../dist/fp400-zone-card.js';
const zone={name:'Desk',mask_hex:maskHex(new Set([0,1,2,16,18,32,33,34]))};
function editor(){
    const c=Object.create(FP400ZoneCard.prototype);Object.assign(c,{zoneMode:'native',config:{device:'fp'},saved:{1:zone,2:'unmanaged',3:null},drafts:{1:{...zone,name:'Office'},2:'unmanaged',3:null},base:{1:zone},dirty:new Set([1]),loaded:new Set([1,2,3]),selected:1,saving:false,busy:{},pendingAreas:[],pendingClears:new Set(),overwriteNative:new Set(),render(){},notice(text){this.message=text;}});
    const states={};c._hass={states,user:{is_admin:false},callService:async()=>{}};
    for(const [id,z] of Object.entries(c.saved)){states[`text.fp_native_zone_${id}_config`]={state:z===null?'clear':typeof z==='string'?z:JSON.stringify(z)};states[`sensor.fp_native_zone_${id}_status`]={state:'ready'};states[`number.fp_zone_${id}_absence_timeout`]={state:id==='1'?'10':'unknown',attributes:{min:0,max:300,step:1}};}
    return c;
}
function publish(c,id,z,status='ready',error=''){
    c._hass.states[`text.fp_native_zone_${id}_config`]={state:z===null?'clear':typeof z==='string'?z:JSON.stringify(z)};
    c._hass.states[`sensor.fp_native_zone_${id}_status`]={state:status};
    c._hass.states[`sensor.fp_native_zone_${id}_error`]={state:error};
    c.sync();
}
function syncable(c){
    for(const f of ['renderList','renderInspector','renderMap','renderLive','renderButtons','renderSettings'])c[f]=()=>{};
    c.shadowRoot={querySelector:()=>({contains:()=>false})};return c;
}
test('native shape is preserved exactly, including holes and disconnected cells',()=>{
    assert.deepEqual([...maskBits(normalizeNativeZone(JSON.stringify(zone)).mask_hex)],[0,1,2,16,18,32,33,34]);
    assert.equal(normalizeNativeZone('unmanaged'),'unmanaged');assert.equal(normalizeNativeZone('clear'),null);
    assert.throws(()=>normalizeNativeZone({...zone,mask_hex:'0'.repeat(80)}),/Paint/);
});
test('only confirmed clear native slots are available for drawing',()=>{
    const c=editor();assert.equal(c.freeId(),3);
    c._hass.states['sensor.fp_native_zone_3_status']={state:'pending'};
    assert.equal(c.freeId(),null);
    c._hass.states['sensor.fp_native_zone_3_status']={state:'error'};assert.equal(c.freeId(),null);
    c._hass.states['sensor.fp_native_zone_3_status']={state:'ready'};c._hass.states['text.fp_native_zone_3_config']={state:'unknown'};assert.equal(c.freeId(),null);
});
test('native save waits beyond the HA service response and keeps exact mask bytes',async()=>{
    const c=syncable(editor()),sent=[];let returned=false;
    c._hass.callService=async(d,s,data)=>{sent.push(data);publish(c,1,'unmanaged','pending');setTimeout(()=>{returned=true;publish(c,1,JSON.parse(data.value));},30);};
    const saving=c.save();assert.equal(c.saving,true);assert.equal(returned,false);assert.equal(c.dirty.has(1),true);
    await saving;assert.equal(sent[0].entity_id,'text.fp_native_zone_1_config');assert.deepEqual(JSON.parse(sent[0].value),{name:'Office',mask_hex:zone.mask_hex});assert.equal(c.dirty.size,0);assert.match(c.message,/Native zones/);
});
test('unmanaged overwrite and deletion require explicit confirmation of that slot',async()=>{
    const c=syncable(editor());c.dirty=new Set([2]);c.base={2:'unmanaged'};c.drafts[2]={...zone,name:'Replacement'};
    const sent=[];c._hass.callService=async(d,s,data)=>{sent.push(JSON.parse(data.value));publish(c,2,normalizeNativeZone(data.value));};
    await c.save();assert.equal(sent.length,0);assert.match(c.message,/Confirm/);
    c.overwriteNative.add(2);await c.save();assert.equal(sent[0].overwrite,true);assert.equal(c.dirty.size,0);
    publish(c,2,'unmanaged');c.base[2]='unmanaged';c.drafts[2]=null;c.dirty.add(2);
    c._hass.callService=async(d,s,data)=>{sent.push(JSON.parse(data.value));publish(c,2,null);};
    await c.save();assert.equal(sent.length,1);c.overwriteNative.add(2);await c.save();assert.deepEqual(sent[1],{clear:true,overwrite:true});
});
test('failed native write retains draft and last confirmed baseline; uncertain retry asks for overwrite',async()=>{
    const c=syncable(editor());let calls=0;c._hass.callService=async()=>{
        calls++;c._hass.states['text.fp_native_zone_1_config']={state:'unmanaged'};c.sync();
        c._hass.states['sensor.fp_native_zone_1_status']={state:'pending'};c.sync();
        c._hass.states['sensor.fp_native_zone_1_error']={state:'Sensor refused'};
        c._hass.states['sensor.fp_native_zone_1_status']={state:'error'};c.sync();
    };
    await c.save();assert.match(c.message,/Sensor refused/);assert.equal(c.dirty.has(1),true);assert.equal(c.saved[1].name,'Desk');assert.equal(c.drafts[1].name,'Office');
    await c.save();assert.equal(calls,1);assert.match(c.message,/Confirm/);
    c.overwriteNative.add(1);c._hass.callService=async(d,s,data)=>{calls++;assert.equal(JSON.parse(data.value).overwrite,true);publish(c,1,normalizeNativeZone(data.value));};
    await c.save();assert.equal(calls,2);assert.equal(c.dirty.size,0);
});
test('native partial save clears only the confirmed slot and rejects oversized payload before sending',async()=>{
    const c=syncable(editor());c.drafts[3]={...zone,name:'Second'};c.base[3]=null;c.dirty.add(3);let calls=0;
    c._hass.callService=async(d,s,data)=>{calls++;const id=Number(data.entity_id.split('_')[3]);if(id===1)publish(c,1,JSON.parse(data.value));else publish(c,3,'unmanaged','error','Offline');};
    await c.save();assert.equal(calls,2);assert.deepEqual([...c.dirty],[3]);assert.match(c.message,/1 saved.*Offline/);
    const x=editor();x.drafts[1].name='A'+'\u0000'.repeat(31);let sent=0;x._hass.callService=async()=>{sent++;};await x.save();assert.equal(sent,0);assert.match(x.message,/255-character/);
});
test('native occupancy is independent of unavailable tracking and switching refuses unsaved work',()=>{
    const c=editor();c._hass.states['binary_sensor.fp_native_zone_1_occupancy']={state:'on'};c._hass.states['sensor.fp_tracking_status']={state:'stale'};
    assert.equal(c.zoneLive(1),true);c.switchZones();assert.equal(c.native,true);assert.match(c.message,/Save or discard/);
});

test('changing the visible mode during asynchronous entity naming keeps native names scoped',async()=>{
    const c=editor(),writes=[];c._hass.user.is_admin=true;
    for(const namespace of ['native','software'])for(const [domain,suffix] of [['binary_sensor','occupancy'],['text','config'],['sensor','count']])c._hass.states[`${domain}.fp_${namespace}_zone_1_${suffix}`]={attributes:{friendly_name:`FP ${namespace} zone 1 ${suffix}`}};
    c._hass.callWS=async data=>{writes.push(data);c.zoneMode='software';};
    await c.nameEntities(1,zone,null);
    assert.equal(writes.length,3);assert.ok(writes.every(w=>w.entity_id.includes('_native_zone_1_')));
});

test('late native confirmation resolves the draft when ready arrives after configuration',async()=>{
    const c=syncable(editor());let calls=0;
    c._hass.callService=async()=>{calls++;publish(c,1,'unmanaged','pending');};
    c.waitUntil=async()=>{throw new Error('Timed out');};
    await c.save();assert.equal(c.dirty.has(1),true);
    c._hass.states['text.fp_native_zone_1_config']={state:JSON.stringify(c.drafts[1])};c.sync();
    assert.equal(c.dirty.has(1),true);
    c._hass.states['sensor.fp_native_zone_1_status']={state:'ready'};c.sync();
    assert.equal(c.dirty.size,0);assert.match(c.message,/saved after all/);
    await c.save();assert.equal(calls,1);
});
test('a concrete native configuration changed elsewhere still blocks stale edits',async()=>{
    const c=syncable(editor());let calls=0;c._hass.callService=async()=>{calls++;};
    publish(c,1,{...zone,name:'Other dashboard'});
    await c.save();assert.equal(calls,0);assert.match(c.message,/changed elsewhere/);assert.equal(c.drafts[1].name,'Office');
});

test('native timeout writes the existing renamed number entity without changing geometry',async()=>{
    const c=syncable(editor()),sent=[],id='number.kitchen_delay';
    c.fp={label:'fp',keys:{'number.zone_1_absence_timeout':id}};
    c._hass.states[id]=c._hass.states['number.fp_zone_1_absence_timeout'];delete c._hass.states['number.fp_zone_1_absence_timeout'];
    c._hass.callService=async(domain,service,data)=>{sent.push({domain,service,...data});setTimeout(()=>{c._hass.states[id]={...c._hass.states[id],state:String(data.value)};c.sync();},30);};
    const pending=c.applySetting({dataset:{setting:id,nativeTimeout:'1'},value:'25'},['number','zone_1_absence_timeout','Zone 1 empty delay',{unit:'s',min:0}]);
    assert.equal(c.busy[id],true);
    await c.save();assert.equal(sent.length,1);assert.match(c.message,/confirm the zone empty delay/);
    await pending;
    assert.deepEqual(sent,[{domain:'number',service:'set_value',entity_id:id,value:25}]);
    assert.equal(c.saved[1].name,'Desk');assert.equal(c.drafts[1].name,'Office');assert.equal(c.dirty.has(1),true);
    assert.equal(c.state('number','zone_1_absence_timeout'),'25');
    await c.applySetting({dataset:{setting:id,nativeTimeout:'1'},value:'301'},['number','zone_1_absence_timeout','Zone 1 empty delay',{unit:'s',min:0}]);
    assert.equal(sent.length,1);assert.match(c.message,/0 to 300/);
});
test('native timeout cannot write a new or pending zone before numeric state is ready',async()=>{
    const c=syncable(editor());let calls=0;c._hass.callService=async()=>{calls++;};
    const input={dataset:{setting:'number.fp_zone_3_absence_timeout',nativeTimeout:'3'},value:'25'},descriptor=['number','zone_3_absence_timeout','Zone 3 empty delay',{unit:'s',min:0}];
    c.drafts[3]=zone;c.dirty.add(3);c.base[3]=null;
    await c.applySetting(input,descriptor);assert.equal(calls,0);
    publish(c,3,'unmanaged','pending');c._hass.states['number.fp_zone_3_absence_timeout'].state='10';
    await c.applySetting(input,descriptor);assert.equal(calls,0);
    publish(c,3,zone);assert.equal(c.nativeTimeoutReady(3),true);
});
test('missing optional native controls keep software mode and retain existing native drafts',()=>{
    const c=syncable(editor());c.zoneMode='software';c.dirty.clear();
    for(const id of Object.keys(c._hass.states))if(id.includes('_native_zone_'))delete c._hass.states[id];
    c.switchZones();assert.equal(c.native,false);assert.match(c.message,/Enable native_zones/);
    c.zoneMode='native';c.dirty.add(1);c.sync();
    assert.equal(c.drafts[1].name,'Office');assert.equal(c.nativeEditable(1),false);assert.equal(c.freeId(),null);assert.match(c.message,/discard edits/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FP400ZoneCard,parseTargets} from '../dist/fp400-zone-card.js';

// A card that reads live dots over MQTT, as an administrator's does.
function live(){
    const handlers=new Map(),card=Object.create(FP400ZoneCard.prototype);
    Object.defineProperty(card,'isConnected',{value:true});
    Object.assign(card,{config:{device:'fp'},fp:{label:'fp'},mqttBaseTopic:'zigbee2mqtt',mqttFriendlyName:null,mqttGeneration:0,renders:0,target:null,forgetting:null,saving:false,busy:{}});
    card._hass={user:{is_admin:true},states:{},connection:{subscribeMessage:async(callback,{topic})=>{handlers.set(topic,callback);return ()=>handlers.delete(topic);}}};
    card.renderLive=()=>card.renders++;card.sync=()=>{};card.notice=text=>{card.message=text;};
    card.send=payload=>handlers.get('zigbee2mqtt/fp')({payload:JSON.stringify(payload)});
    return card;
}
const now=new Date().toISOString();
const frame=details=>({targets_xy:details.map(t=>`${t.id}:${t.x}:${t.y}`).join(';')||'none',tracking_targets:details,tracking_status:'valid',tracking_last_update:now});
const person={id:1,x:-25,y:82,moving:true,type:'person',posture:2,cell:513},pet={id:4,x:-160,y:260,moving:false,type:'pet',ignored:true,posture:0};

test('each live dot gets what the sensor knows about it, matched by id; diagnostics stay out',async()=>{
    const card=live();await card.ensureTrackingSubscription();
    card.send({...frame([person,pet]),tracking_targets:[pet,{id:9,x:0,y:0,type:'fan'},person]});
    assert.deepEqual(card.targets(),[{id:1,x:-25,y:82,moving:true,type:'person'},{id:4,x:-160,y:260,moving:false,type:'pet',ignored:true}]);
});

test('unknown or malformed details are left out',()=>{
    assert.deepEqual(parseTargets('1:0:0;2:5:5;3:9:9',[{id:1,moving:'yes',type:'sofa',ignored:'true'},{id:2,type:'toString',moving:null},null,'junk',{id:3,type:'air_purifier',moving:false}]),
        [{id:1,x:0,y:0},{id:2,x:5,y:5},{id:3,x:9,y:9,moving:false,type:'air_purifier'}]);
    assert.deepEqual(parseTargets('1:0:0',{id:1,moving:true}),[{id:1,x:0,y:0}],'details must be a list');
});

test('an identical payload does not redraw; a dot that stops moving in the same place does',async()=>{
    const card=live();await card.ensureTrackingSubscription();
    card.send(frame([person,pet]));assert.equal(card.renders,1);
    card.send(frame([{...person},{...pet}]));assert.equal(card.renders,1,'the same details in a new array');
    card.send(frame([{...person,moving:false},pet]));assert.equal(card.renders,2,'same positions, new moving flag');
    assert.equal(card.targets()[0].moving,false);
});

test('an older converter and the HA entity fallback give plain dots, as before',async()=>{
    const card=live();await card.ensureTrackingSubscription();
    card.send({targets_xy:'2:10:30',tracking_last_update:now,tracking_status:'valid'});
    assert.deepEqual(card.targets(),[{id:2,x:10,y:30}]);
    // Converter 0.6 already sends tracking_targets, with raw numbers only: its activity is not read as moving.
    card.send(frame([{id:1,x:-25,y:82,cell:513,activity:2,posture:1}]));
    assert.deepEqual(card.targets(),[{id:1,x:-25,y:82}]);
    const fallback=live();fallback._hass.user.is_admin=false;fallback._hass.states={'sensor.fp_targets_xy':{state:'1:-25:82'}};
    await fallback.ensureTrackingSubscription();assert.deepEqual(fallback.targets(),[{id:1,x:-25,y:82}]);
});

test('the target panel says what the sensor knows in plain words',async()=>{
    const card=live();await card.ensureTrackingSubscription();
    const panel=t=>{card.send(frame([t]));card.target=t.id;return card.targetPanel().replace(/<[^>]+>/g,'');};
    assert.match(panel(pet),/right now\. Still right now\. The sensor thinks this is a pet\. Zones ignore it\. Not a person\?/);
    assert.match(panel(person),/right now\. Moving right now\. Not a person\?/,'a person adds nothing about what it is');
    for(const [type,words] of [['child','a child'],['vacuum','a robot vacuum'],['fan','a fan'],['curtain','a curtain'],['plant','a plant'],['air_purifier','an air purifier'],['not_person','not a person']])
        assert.match(panel({id:2,x:0,y:100,type}),new RegExp(`The sensor sees something here right now\\. The sensor thinks this is ${words}\\. Not a person\\?`));
    assert.match(panel({id:3,x:0,y:100}),/The sensor sees something here right now\. Not a person\?/,'no details: as before');
    card.target=7;assert.match(card.targetPanel(),/The sensor does not see this target right now\. Not a person\?/);
});

test('People only is a sensor setting with a hint, hidden when the converter does not have it',async()=>{
    const card=live(),calls=[],hint='Zones ignore dots the sensor marks as a pet, robot vacuum, fan, curtain, plant or air purifier.';
    const row=()=>card.settingRow('switch','people_only','Zones count only people',{hint});
    assert.equal(row(),'');
    card._hass.states['switch.fp_people_only']={state:'off'};
    assert.match(row(),new RegExp(`^<label class="setting toggle" title="${hint.replace(/\./g,'\\.')}"><span>Zones count only people</span><input type="checkbox" role="switch"`));
    card.renderSettings=()=>{};card.shadowRoot={querySelector:()=>({})};
    card._hass.callService=async(domain,service,data)=>{calls.push({domain,service,...data});card._hass.states[data.entity_id]={state:service==='turn_on'?'on':'off'};};
    await card.applySetting({dataset:{setting:'switch.fp_people_only'},checked:true});
    assert.deepEqual(calls,[{domain:'switch',service:'turn_on',entity_id:'switch.fp_people_only'}]);
    assert.equal(card.message,'Saved: Zones count only people.');
    assert.match(row(),/ checked>/);
});

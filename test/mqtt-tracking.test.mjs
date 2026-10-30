import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FP400ZoneCard,registryFp400s} from '../dist/fp400-zone-card.js';

function fixture({admin=true,deviceName='living_room_fp400',mqttName=null,base='zigbee2mqtt',delay=false}={}){
    const handlers=new Map(),unsubscribed=[],requests=[],pending=[];
    const connection={subscribeMessage:async(callback,request)=>{
        requests.push(request);
        if(delay)await new Promise(resolve=>pending.push(resolve));
        handlers.set(request.topic,callback);
        return ()=>{unsubscribed.push(request.topic);handlers.delete(request.topic);};
    }};
    const card=Object.create(FP400ZoneCard.prototype);
    Object.defineProperty(card,'isConnected',{value:true});
    card.config={device:deviceName};card.fp={label:deviceName,ieee:'0x54ef440000000001',deviceId:'device-1'};
    card.mqttBaseTopic=base;card.mqttFriendlyName=mqttName;card.mqttGeneration=0;
    card._hass={user:{is_admin:admin},connection,devices:{'device-1':{name:'z2m_actual_name',name_by_user:'Renamed in HA'}},states:{
        [`sensor.${deviceName}_tracking_status`]:{state:'valid'},
        [`sensor.${deviceName}_targets_xy`]:{state:'9:1:2'},
        [`sensor.${deviceName}_tracking_last_update`]:{state:new Date().toISOString()},
    }};
    card.renderLive=()=>{};card.sync=()=>{};card.notice=()=>{};
    return {card,handlers,unsubscribed,requests,pending,connection};
}
const send=(handlers,topic,payload)=>handlers.get(topic)?.({payload:JSON.stringify(payload)});

test('resolve MQTT topic from HA device discovery name (not name_by_user) without bridge/devices',async()=>{
    const {card,requests,handlers}=fixture();
    await card.ensureTrackingSubscription();
    assert.equal(card.mqttTopic,'zigbee2mqtt/z2m_actual_name');
    assert.deepEqual(requests,[{type:'mqtt/subscribe',topic:'zigbee2mqtt/z2m_actual_name'}]);
    assert.equal(handlers.has('zigbee2mqtt/bridge/devices'),false);
    card.stopTrackingSubscription();
});

test('entity-registry lookup retains device_id for friendly-name resolution after entity renames',()=>{
    const rows={
        'text.custom_zone_1_config':{unique_id:'0x54ef440000000001_software_zone_1_config_zigbee2mqtt',device_id:'device-1'},
        'sensor.some_random_name':{unique_id:'0x54ef440000000001_software_zone_1_count_zigbee2mqtt',device_id:'device-1'},
    };
    const [device]=registryFp400s(rows);
    assert.equal(device.ieee,'0x54ef440000000001');
    assert.equal(device.deviceId,'device-1');
    assert.equal(device.keys['sensor.software_zone_1_count'],'sensor.some_random_name');
});

test('admin reads live coordinates from MQTT without discovered sensor entities',async()=>{
    const {card,handlers}=fixture();
    const topic='zigbee2mqtt/z2m_actual_name';
    await card.ensureTrackingSubscription();card._hass.states={};
    let renders=0;card.renderLive=()=>renders++;
    send(handlers,topic,{targets_xy:'1:-20:120',tracking_last_update:new Date().toISOString(),tracking_status:'valid'});
    assert.deepEqual(card.targets(),[{id:1,x:-20,y:120}]);
    assert.equal(card.fresh(),true);
    assert.equal(renders,1);
    send(handlers,topic,{targets_xy:'1:-20:120',tracking_last_update:card.trackingValue('tracking_last_update'),tracking_status:'valid'});
    assert.equal(renders,1,'duplicate data should not redraw map');
    card.stopTrackingSubscription();
});

test('low-frequency MQTT masks and learning results refresh editor, not every position frame',async()=>{
    const {card,handlers}=fixture();await card.ensureTrackingSubscription();card._hass.states={};
    let syncs=0,renders=0;card.sync=()=>syncs++;card.renderLive=()=>renders++;
    const topic='zigbee2mqtt/z2m_actual_name',mask='a3'.repeat(40);
    send(handlers,topic,{interference_mask_hex:mask,entry_exit_mask_hex:mask,edge_mask_hex:mask,learning_result_time:'2026-10-27T10:00:00Z'});
    assert.equal(syncs,1);assert.equal(card.areaMask('edge'),mask);assert.equal(card.trackingValue('learning_result_time'),'2026-10-27T10:00:00Z');
    send(handlers,topic,{interference_mask_hex:mask,entry_exit_mask_hex:mask,edge_mask_hex:mask,learning_result_time:'2026-10-27T10:00:00Z'});
    assert.equal(syncs,1);
    send(handlers,topic,{targets_xy:'2:10:30',tracking_last_update:'2026-10-27T10:01:00Z',tracking_status:'valid'});
    assert.equal(syncs,1);assert.equal(renders,1);
    send(handlers,topic,{edge_mask_hex:'ef'.repeat(40)});
    assert.equal(syncs,2);
    card.stopTrackingSubscription();
});

test('explicit MQTT name override and custom base topic win over HA discovery',async()=>{
    const {card,handlers}=fixture({mqttName:'custom room name',base:'zigbee2mqtt/custom'});
    await card.ensureTrackingSubscription();
    assert.ok(handlers.has('zigbee2mqtt/custom/custom room name'));
    card.stopTrackingSubscription();
});

test('non-admins subscribe to no MQTT and retain entity-state fallback with clear warning',async()=>{
    const {card,handlers}=fixture({admin:false});
    await card.ensureTrackingSubscription();assert.equal(handlers.size,0);
    assert.deepEqual(card.targets(),[{id:9,x:1,y:2}]);assert.equal(card.fresh(),true);
    delete card._hass.states['sensor.living_room_fp400_targets_xy'];
    delete card._hass.states['sensor.living_room_fp400_tracking_last_update'];
    const help=card.liveTrackingHelp();
    assert.match(help,/administrator/);assert.match(help,/sensor.living_room_fp400_targets_xy/);
    assert.match(help,/sensor.living_room_fp400_tracking_last_update/);
});

test('old topics cannot update UI after the device changes',async()=>{
    const {card,handlers,unsubscribed}=fixture();
    await card.ensureTrackingSubscription();
    const old=handlers.get('zigbee2mqtt/z2m_actual_name');
    card._hass.devices['device-1'].name='new_z2m_name';
    await card.ensureTrackingSubscription();
    old({payload:JSON.stringify({targets_xy:'4:55:66'})});
    assert.deepEqual(card.targets(),[{id:9,x:1,y:2}]);
    assert.ok(unsubscribed.includes('zigbee2mqtt/z2m_actual_name'));
    card.stopTrackingSubscription();
});

test('disconnect while subscribe is pending releases the late subscription',async()=>{
    const {card,pending,unsubscribed}=fixture({delay:true});
    const promise=card.ensureTrackingSubscription();
    assert.equal(pending.length,1);
    card.stopTrackingSubscription();pending.shift()();
    await promise;
    assert.ok(unsubscribed.includes('zigbee2mqtt/z2m_actual_name'));
    assert.equal(card.mqttKey,null);
});

test('malformed and irrelevant MQTT payloads are ignored',async()=>{
    const {card,handlers}=fixture();await card.ensureTrackingSubscription();
    const recv=handlers.get('zigbee2mqtt/z2m_actual_name');
    recv({payload:'not json'});recv({payload:'[]'});recv({payload:'{}'});recv({payload:'{"battery":90}'});
    assert.equal(card.liveTracking,null);
    card.stopTrackingSubscription();
});

test('a failed MQTT subscription is reported and not retried on every HA state update',async()=>{
    const {card,connection}=fixture();let calls=0,warning='';
    card._hass.states={};
    connection.subscribeMessage=async()=>{calls++;throw new Error('Unauthorized');};
    card.notice=text=>{warning=text;};
    await card.ensureTrackingSubscription();
    assert.match(warning,/subscription failed/i);
    assert.match(card.liveTrackingHelp(),/Live MQTT is unavailable/);
    assert.equal(card.mqttKey,null);
    await card.ensureTrackingSubscription();
    assert.equal(calls,1,'do not hammer Home Assistant after a subscription failure');
});

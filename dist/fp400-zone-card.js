/* Aqara FP400 zone card for Home Assistant + Zigbee2MQTT. https://github.com/bobtekkk/aqara-fp400-zone-card (MIT License) */
const VERSION = '0.2.0';
const COLORS = ['#67e4b8','#9fa9ff','#f9bf73','#f28fad','#68cce8','#d6a0ef','#bddb79','#ff9d7a'];
const LIMITS = {x_min:-400,x_max:400,y_min:-50,y_max:1000};
// The sensor's own area masks, in sidebar order. The map draws them in reverse, so ignore spots end up on top.
export const AREAS = {
    interference:{label:'Ignore spot',color:'#ff6b78',hint:'A spot that shows fake targets, like a fan, a curtain or a TV.'},
    entry_exit:{label:'Doorway',color:'#ffd166',hint:'Where people walk in and out. The sensor picks people up and lets them go faster here.'},
    edge:{label:'Outside room',color:'#8fa1ad',hint:'Behind a wall, a window or in the next room. The sensor stops watching these cells.'},
};
// Sensor settings, shown when the converter provides them: [domain, key, label, select options or number unit, number scale].
// They apply right away, like in the Aqara app.
const SETTINGS = [
    ['Detection',[
        ['select','presence_sensitivity','Sensitivity',{low:'Low',medium:'Medium',high:'High'}],
        ['number','absence_timeout','Empty after','s'],
        ['select','proximity_distance','Approach distance',{far:'Far',medium:'Medium',near:'Near'}],
        ['select','detection_direction','Movement events',{omnidirectional:'Any direction',left_right:'Left and right'}],
    ]],
    ['Smart features',[
        ['switch','ai_high_precision','Better person recognition'],
        ['switch','ai_adaptive_sensitivity','Adaptive sensitivity'],
        ['switch','ai_interference_recognition','Find fake-target spots itself'],
        ['switch','ai_entry_exit_recognition','Find doorways itself'],
        ['switch','human_count_enabled','People counting'],
    ]],
    ['Mounting',[
        ['select','installation_mode','Mounted on',{wall:'Wall',ceiling:'Ceiling'}],
        ['select','side_installation','Wall position',{wall:'Flat on the wall',left_corner:'Left corner',right_corner:'Right corner'}],
        ['number','installation_height','Height','cm',10],
        ['select','coordinate_reverse','Swap left and right',{disabled:'No',enabled:'Yes',auto:'Automatic'}],
    ]],
];
// What the card names a zone's entities in Home Assistant, e.g. "Desk occupancy".
const ENTITY_NAMES = [['binary_sensor','occupancy','occupancy','occupancy'],['binary_sensor','available','tracking available'],['text','config','zone configuration'],['sensor','count','people'],['sensor','activity','activity']];
const escapeHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => value == null ? null : {...value};
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
// Live data re-renders many times a second; replacing unchanged nodes under the pointer swallows clicks.
const setHtml = (el,html) => {if(el._html!==html){el._html=html;el.innerHTML=html;}};
export function normalizeZone(value) {
    if(value == null || value === 'clear' || value === '') return null;
    if(typeof value === 'string')value=JSON.parse(value);
    if(!value || Array.isArray(value) || typeof value !== 'object')throw new Error('Invalid zone');
    const z={name:value.name,x_min:value.x_min,x_max:value.x_max,y_min:value.y_min,y_max:value.y_max,absence_timeout:value.absence_timeout ?? 3};
    if(typeof z.name!=='string' || !z.name.trim() || z.name.length>32)throw new Error('Give the zone a name (up to 32 characters).');
    for(const k of ['x_min','x_max','y_min','y_max'])if(!Number.isFinite(z[k]) || Math.abs(z[k])>2000)throw new Error('Use valid zone dimensions.');
    if(z.x_max<=z.x_min || z.y_max<=z.y_min)throw new Error('Width and depth must be greater than zero.');
    if(!Number.isInteger(z.absence_timeout) || z.absence_timeout<0 || z.absence_timeout>300)throw new Error('Empty delay must be 0–300 seconds.');
    return z;
}
const sameZone=(a,b)=>JSON.stringify(normalizeZone(a))===JSON.stringify(normalizeZone(b));
export function rectangleFromPoints(a,b,step=50) {
    const snap=v=>step?Math.round(v/step)*step:v;
    const ax=clamp(snap(a.x),LIMITS.x_min,LIMITS.x_max),bx=clamp(snap(b.x),LIMITS.x_min,LIMITS.x_max);
    const ay=clamp(snap(a.y),LIMITS.y_min,LIMITS.y_max),by=clamp(snap(b.y),LIMITS.y_min,LIMITS.y_max);
    return {x_min:Math.min(ax,bx),x_max:Math.max(ax,bx),y_min:Math.min(ay,by),y_max:Math.max(ay,by)};
}
export function moveRectangle(zone,dx,dy,step=50) {
    const snap=v=>step?Math.round(v/step)*step:v;
    // Keep zones on the map, but never push one that is already outside further out (or make it jump in).
    dx=clamp(snap(dx),Math.min(0,LIMITS.x_min-zone.x_min),Math.max(0,LIMITS.x_max-zone.x_max));
    dy=clamp(snap(dy),Math.min(0,LIMITS.y_min-zone.y_min),Math.max(0,LIMITS.y_max-zone.y_max));
    return {...zone,x_min:zone.x_min+dx,x_max:zone.x_max+dx,y_min:zone.y_min+dy,y_max:zone.y_max+dy};
}
export function parseTargets(value) {
    if(!value || value==='none')return [];
    return value.split(';').flatMap(item=>{
        const parts=item.split(':').map(Number);
        return parts.length===3 && parts.every(Number.isFinite)?[{id:parts[0],x:parts[1],y:parts[2]}]:[];
    });
}
export function fitView(zones,targets=[]) {
    const points=Object.values(zones).filter(Boolean).flatMap(z=>[{x:z.x_min,y:z.y_min},{x:z.x_max,y:z.y_max}]);
    points.push(...targets,{x:0,y:0});
    if(points.length===1)return {x:-300,y:-50,width:600,height:600};
    const x1=clamp(Math.min(...points.map(p=>p.x))-90,-400,200), x2=clamp(Math.max(...points.map(p=>p.x))+90,-200,400);
    const y1=clamp(Math.min(...points.map(p=>p.y))-60,-50,800), y2=clamp(Math.max(...points.map(p=>p.y))+100,150,1000);
    return {x:x1,y:y1,width:Math.max(300,x2-x1),height:Math.max(300,y2-y1)};
}
// The sensor's area masks: 20 rows x 16 columns of 50 cm cells covering x -400..400, y 0..1000.
// Columns run right to left (column 0 is x = 350..400). Must match worldToGrid in z2m/aqara-fp400.mjs (a test checks this).
export function rectBits(r){
    const r0=Math.max(0,Math.floor(r.y_min/50)),r1=Math.min(19,Math.ceil(r.y_max/50)-1);
    const c0=Math.max(0,8-Math.ceil(r.x_max/50)),c1=Math.min(15,7-Math.floor(r.x_min/50));
    const bits=[];for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++)bits.push(row*16+col);
    return bits;
}
const cellOf = bit => ({x_min:350-(bit&15)*50,x_max:400-(bit&15)*50,y_min:(bit>>4)*50,y_max:(bit>>4)*50+50});
export function maskBits(hex){
    if(typeof hex!=='string'||!/^[0-9a-f]{80}$/i.test(hex))return null;
    const bits=new Set();
    for(let bit=0;bit<320;bit++)if(parseInt(hex.substr((bit>>3)*2,2),16)&(0x80>>(bit%8)))bits.add(bit);
    return bits;
}
// What a mask will hold after Save: an optional clear, then each painted (add) or erased (remove) rectangle in order.
export function draftMask(saved,clear=false,ops=[]){
    const bits=new Set(clear?[]:saved??[]);
    for(const {op,rect} of ops)for(const bit of rectBits(rect))op==='remove'?bits.delete(bit):bits.add(bit);
    return bits;
}
// Entity IDs look like text.<device>_software_zone_1_config; <device> is the FP400's friendly name in Zigbee2MQTT.
export function findDevice(hass){
    for(const id of Object.keys(hass?.states??{})){const m=/^text\.([a-z0-9_]+)_software_zone_1_config$/.exec(id);if(m)return m[1];}
    return null;
}
export function clampBlock(r){
    const c={x_min:Math.max(-400,r.x_min),x_max:Math.min(400,r.x_max),y_min:Math.max(0,r.y_min),y_max:Math.min(1000,r.y_max)};
    return c.x_max-c.x_min>=50&&c.y_max-c.y_min>=50?c:null;
}
const areaPattern=(uid,type,color)=>type==='edge'
    ?`<pattern id="${uid}-edge" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="#091117" fill-opacity=".82"/><line x1="0" y1="0" x2="0" y2="14" stroke="${color}" stroke-opacity=".5" stroke-width="1" vector-effect="non-scaling-stroke"/></pattern>`
    :`<pattern id="${uid}-${type}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(${type==='interference'?45:-45})"><line x1="0" y1="0" x2="0" y2="10" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></pattern>`;
const STYLE=`
:host{display:block;height:100%;--ink:#eef5f6;--muted:#93a8b5;--line:#2b3d49;--accent:#67e4b8;font-family:Inter,system-ui,-apple-system,sans-serif;color:var(--ink)}
*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}ha-card{display:flex;flex-direction:column;background:#101b24;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 12px 45px #0002;margin:8px auto;max-width:1440px;height:calc(100dvh - 80px);color:var(--ink)}
header{padding:16px 24px 14px;display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid var(--line);flex-shrink:0}.eyebrow{font-size:10px;font-weight:750;letter-spacing:2px;color:var(--accent);margin-bottom:5px}h1{margin:0;font-size:22px;font-weight:650;letter-spacing:-.6px}.subtitle{font-size:12px;color:var(--muted);margin-top:5px}.header-actions{display:flex;gap:8px;align-items:center}.live{display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap;border:1px solid var(--line);border-radius:30px;padding:8px 12px}.live i{width:7px;height:7px;background:#83929c;border-radius:50%}.live.fresh i{background:var(--accent);box-shadow:0 0 12px #67e4b844}.main{display:grid;grid-template-columns:minmax(0,1fr) 300px;flex:1;min-height:0;overflow:hidden}.canvas-panel{min-width:0;background:#101d27;display:flex;flex-direction:column;overflow:hidden}.toolbar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;gap:10px;border-bottom:1px solid var(--line);flex-shrink:0}.toolbar-group{display:flex;gap:6px;align-items:center}.btn{color:var(--ink);border:1px solid var(--line);background:#182833;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:600;min-height:36px}.btn:hover:not(:disabled){background:#253b47}.btn.active{border-color:var(--accent);color:var(--accent);background:#173b35}.btn.primary{background:var(--accent);color:#09261b;border:0}.btn.primary:hover:not(:disabled){background:#89f1cd}.btn.icon{min-width:36px;padding:6px;font-size:16px}.btn.danger{color:#ffa5ae}.btn.subtle{background:transparent;border-color:transparent;color:var(--muted)}.map-wrap{flex:1;min-height:240px;position:relative;overflow:hidden;--rw:34px;--rh:22px}.map-canvas{position:absolute;top:0;left:var(--rw);right:0;bottom:var(--rh);overflow:hidden}.ruler-y,.ruler-x,.ruler-corner{position:absolute;pointer-events:none;background:#0d1820;color:#7a8f9c;font-size:9px;font-weight:600;letter-spacing:.3px}.ruler-y{top:0;bottom:var(--rh);left:0;width:var(--rw);border-right:1px solid var(--line)}.ruler-x{bottom:0;left:var(--rw);right:0;height:var(--rh);border-top:1px solid var(--line)}.ruler-corner{bottom:0;left:0;width:var(--rw);height:var(--rh);border-right:1px solid var(--line);border-top:1px solid var(--line)}.tick{position:absolute;white-space:nowrap;font-variant-numeric:tabular-nums}.ruler-y .tick{right:4px;text-align:right;transform:translateY(-50%)}.ruler-y .tick::after{content:"";position:absolute;right:-4px;top:50%;width:5px;height:1px;background:#4b6472}.ruler-y .tick.minor::after{width:3px;background:#3a5260}.ruler-x .tick{top:4px;text-align:center;transform:translateX(-50%);min-width:24px}.ruler-x .tick::before{content:"";position:absolute;top:-4px;left:50%;width:1px;height:4px;background:#4b6472;transform:translateX(-50%)}.ruler-x .tick.minor::before{height:3px;background:#3a5260}.map{width:100%;height:100%;display:block;touch-action:none;user-select:none;outline:none;cursor:grab}.map.draw,.map.areas{cursor:crosshair}.map.panning{cursor:grabbing}.map .zone-shape{cursor:move}.map .handle{cursor:nwse-resize}.map text{pointer-events:none;font-family:inherit}.map .target,.map .area-cell,.map .area-pending,.map .area-preview{pointer-events:none}.map.areas .area-pending{pointer-events:auto;cursor:pointer}.map:not(.draw):not(.areas) .target .hit{pointer-events:auto;cursor:pointer}.map .area-cell.gone{opacity:.22}.legend{display:flex;justify-content:space-between;gap:12px;padding:10px 20px;color:var(--muted);font-size:11px;border-top:1px solid var(--line);flex-shrink:0}.legend span{display:flex;gap:7px;align-items:center}.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff}.sidebar{background:#14222c;border-left:1px solid var(--line);padding:18px 18px 18px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;min-height:0}.sidebar.show-settings>section:not(.settings),.sidebar:not(.show-settings)>.settings{display:none}.section-title{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:750;letter-spacing:1.6px;color:var(--muted);margin:0 0 11px}.section-title span{letter-spacing:0;font-weight:400}.zone-list,.area-types{display:flex;flex-direction:column;gap:7px}.zone-row,.area-type{display:flex;align-items:center;gap:10px;width:100%;padding:12px 11px;text-align:left;color:var(--ink);background:#192b36;border:1px solid transparent;border-radius:10px}.zone-row.selected{border-color:var(--zone-color);background:#21353f}.area-type.selected{border-color:var(--area-color);background:#21353f}.zone-row .swatch,.area-type .swatch{width:9px;height:28px;border-radius:5px;background:var(--zone-color);flex-shrink:0}.area-type .swatch{background:repeating-linear-gradient(45deg,var(--area-color) 0 2px,transparent 2px 5px);border:1px solid var(--area-color)}.zone-row .zone-info{flex:1;min-width:0}.zone-row strong,.area-type strong{font-size:13px;font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.zone-row small,.area-type small{display:block;color:var(--muted);font-size:10px;margin-top:4px}.zone-row .dot{width:6px;height:6px;border-radius:50%;background:var(--zone-color)}.empty{font-size:12px;color:var(--muted);line-height:1.7;padding:18px 2px}.inspector{border-top:1px solid var(--line);padding-top:18px}.field{display:block;margin-bottom:13px;font-size:11px;color:var(--muted)}.field input,.field select,.setting select,.setting input[type=number]{display:block;width:100%;margin-top:6px;background:#0f1d27;color:var(--ink);border:1px solid var(--line);border-radius:8px;min-height:40px;padding:8px 10px;font-size:13px;outline-offset:1px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fields .field{margin:0 0 12px}.inspector .btn{width:100%;margin-top:5px}.segmented{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}.area-panel{margin-top:18px;padding-top:16px;border-top:1px dashed var(--line)}.area-chips{display:flex;flex-wrap:wrap;gap:6px}.area-chip{display:flex;align-items:center;gap:6px;font-size:11px;padding:4px 9px;border-radius:20px;background:#192b36}.area-chip i{width:8px;height:8px;border-radius:2px;background:var(--area-color)}.small-note{font-size:10px;color:var(--muted);line-height:1.6}.settings{display:flex;flex-direction:column}.settings-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.settings-head .section-title{margin:0}.settings .section-title{margin-top:14px}.setting{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;padding:5px 0}.setting select,.setting input[type=number]{width:140px;flex-shrink:0;margin:0;min-height:34px;padding:6px 8px;font-size:12px}.setting.toggle input{appearance:none;-webkit-appearance:none;width:36px;height:20px;margin:0;border-radius:20px;background:#2b3d49;position:relative;cursor:pointer;flex-shrink:0}.setting.toggle input::after{content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#93a8b5;transition:left .15s}.setting.toggle input:checked{background:#1f5a49}.setting.toggle input:checked::after{left:19px;background:var(--accent)}.setting input:disabled,.setting select:disabled{opacity:.45;cursor:not-allowed}.settings .btn{width:100%;margin-top:6px}.settings .settings-head .btn{width:auto;margin:0;min-height:30px;min-width:30px;font-size:13px}.footer{display:flex;gap:15px;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--line);background:#14232c;flex-shrink:0}.footer-actions{display:flex;gap:8px}.message{font-size:12px;color:var(--muted);line-height:1.5}.message.error{color:#ffa5ae}.message.success{color:var(--accent)}.shortcut{color:#718997;font-size:10px}.snap-select{background:#142630;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:8px;font-size:11px;min-height:38px}.count-pill{font-size:10px;padding:3px 7px;border-radius:20px;background:#233945;color:var(--muted)}
@media(max-width:760px){:host{height:auto}ha-card{height:auto;display:block;margin:0;border-radius:16px}header{padding:16px}h1{font-size:20px}.subtitle{font-size:10px}.main{grid-template-columns:1fr;display:block;flex:none;overflow:visible}.canvas-panel{display:block;overflow:visible}.sidebar{border-left:0;border-top:1px solid var(--line);padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px;overflow:visible}.sidebar.show-settings{grid-template-columns:1fr}.inspector{padding-top:0;border-top:0}.map-wrap{flex:none;height:52vh;min-height:340px;max-height:520px}.toolbar{padding:10px;flex-wrap:wrap}.toolbar .btn{padding:8px 10px}.legend{padding:12px;font-size:10px}.footer{padding:12px 16px;align-items:flex-start;flex-direction:column}.footer-actions{align-self:flex-end}.live{padding:7px 9px;font-size:10px}.shortcut,.legend .shortcut{display:none}}
@media(max-width:420px){.sidebar{grid-template-columns:1fr}.zone-list{display:grid;grid-template-columns:1fr 1fr}.inspector{border-top:1px solid var(--line);padding-top:16px}.map-wrap{min-height:320px}.toolbar-group{gap:4px}.btn{font-size:11px}.subtitle{max-width:225px;line-height:1.5}.live{max-width:116px;white-space:normal}.header-actions .label{display:none}}
`;

export class FP400ZoneCard extends (globalThis.HTMLElement ?? class {}) {
    constructor(){
        super();this.attachShadow({mode:'open'});this.saved={};this.drafts={};this.base={};this.dirty=new Set();this.loaded=new Set();this.selected=null;this.mode='select';this.snap=50;this.view={x:-300,y:-50,width:600,height:600};this.saving=false;
        this.panel='zones';this.areaType='interference';this.areaTool='add';this.pendingAreas=[];this.pendingClears=new Set();this.target=null;this.targetAt=null;this.forgetting=null;this.busy={};this.uid=`fp${Math.random().toString(36).slice(2)}`;
    }
    static getStubConfig(hass){const device=findDevice(hass);return device?{device}:{};}
    setConfig(config){
        const device=config.device==null||config.device===''?null:String(config.device).toLowerCase();
        if(device!==null&&!/^[a-z0-9_]+$/.test(device))throw new Error('device must be the start of your FP400 entity IDs, for example living_room_fp400 or 0x54ef440000000001.');
        this.config={...config,device};this.resolved=device??findDevice(this._hass);this.watchedFor=null;if(!this.mounted)this.mount();if(this._hass)this.sync();
    }
    // Without a configured device, use the first FP400 the converter has created entities for.
    get device(){return this.resolved??this.config?.device;}
    getCardSize(){return 12;}
    getGridOptions(){return {columns:'full',min_columns:12};}
    // Home Assistant hands over a new hass object for every entity change in the house; only ours matter.
    set hass(value){
        this._hass=value;if(!this.config)return;
        this.resolved??=findDevice(value);
        const device=this.device;
        if(!device){this.notice('No FP400 found. Install the Zigbee2MQTT converter (see the README) or set device: in the card.','error');return;}
        if(this.watchedFor!==device){this.watchedFor=device;this.watched=this.watchedEntities();this.seen=null;}
        let changed=!this.seen;this.seen??=new Map();
        for(const id of this.watched){const s=value.states?.[id];if(this.seen.get(id)!==s){this.seen.set(id,s);changed=true;}}
        if(changed)this.sync();
    }
    watchedEntities(){
        const keys=[['sensor','targets_xy'],['sensor','tracking_status'],['sensor','tracking_last_update'],['text','remove_target'],['sensor','learning_result_time'],['button','spatial_learning'],['button','refresh_configuration']];
        for(const type of Object.keys(AREAS))keys.push(['sensor',`${type}_mask_hex`],['text',`${type}_mask_hex`],['text',`${type}_zone_add`],['text',`${type}_zone_remove`],['text',`${type}_clear`]);
        for(let i=1;i<=8;i++)keys.push(['text',`software_zone_${i}_config`],['binary_sensor',`software_zone_${i}_occupancy`],['binary_sensor',`software_zone_${i}_available`],['sensor',`software_zone_${i}_count`],['sensor',`software_zone_${i}_activity`]);
        for(const [,items] of SETTINGS)for(const [domain,key] of items)keys.push([domain,key]);
        return keys.map(([domain,key])=>this.entity(domain,key));
    }
    get hass(){return this._hass;}
    connectedCallback(){this.clock??=setInterval(()=>{if(this.mounted)this.renderLive();},1000);if(this.mounted)this.resizeObs?.observe(this.svg);}
    disconnectedCallback(){clearInterval(this.clock);this.clock=null;clearTimeout(this.learnTimer);this.resizeObs?.disconnect();}
    entity(domain,key){return `${domain}.${this.device}_${key}`;}
    state(domain,key){return this._hass?.states?.[this.entity(domain,key)]?.state;}
    available(domain,key){return !['unavailable',undefined].includes(this.state(domain,key));}
    inside(selector){return this.shadowRoot.querySelector(selector).contains(this.shadowRoot.activeElement);}
    mount(){
        this.shadowRoot.innerHTML=`<style>${STYLE}</style><ha-card>
<header><div><div class="eyebrow">AQARA FP400 · SPATIAL CONTROL</div><h1>Room zones</h1><div class="subtitle">Draw your room. Give every space its own presence sensor.</div></div><div class="header-actions"><div class="live" id="live"><i></i><span>Connecting</span></div><button class="btn" data-action="settings" aria-label="Sensor settings">⚙<span class="label"> Settings</span></button></div></header>
<div class="main"><section class="canvas-panel"><div class="toolbar"><div class="toolbar-group"><button class="btn" data-action="draw">＋ Draw zone</button><button class="btn" data-action="areas">▦ Areas</button></div><div class="toolbar-group"><label><span class="shortcut">Snap </span><select class="snap-select" id="snap" aria-label="Grid snap"><option value="50">0.5 m grid</option><option value="10">0.1 m grid</option><option value="0">Free draw</option></select></label><button class="btn icon" data-action="zoom-in" aria-label="Zoom in">＋</button><button class="btn icon" data-action="zoom-out" aria-label="Zoom out">−</button><button class="btn" data-action="fit">Fit</button></div></div>
<div class="map-wrap"><div class="map-canvas"><svg class="map" tabindex="0" aria-label="Room map. Drag empty space to pan, wheel to zoom, drag a zone to move it, drag corners to resize, click a dot to inspect a target." role="img"><defs><pattern id="${this.uid}-small" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#2a3c48" stroke-width=".6" vector-effect="non-scaling-stroke"/></pattern><pattern id="${this.uid}-large" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#${this.uid}-small)"/><path d="M 100 0 L 0 0 0 100" fill="none" stroke="#38505c" stroke-width=".7" vector-effect="non-scaling-stroke"/></pattern>${Object.entries(AREAS).map(([type,a])=>areaPattern(this.uid,type,a.color)).join('')}</defs><rect x="-2000" y="-2000" width="4000" height="4000" fill="#101d27"/><rect x="-400" y="-1000" width="800" height="1050" fill="url(#${this.uid}-large)"/><path d="M 0 0 L -400 -700 M 0 0 L 400 -700" stroke="#67e4b819" fill="none" stroke-dasharray="5 7" vector-effect="non-scaling-stroke"/><g id="areas"></g><g id="zones"></g><g id="sensor"></g><g id="targets"></g><g id="pending-areas"></g></svg></div><div class="ruler-y" id="ruler-y"></div><div class="ruler-x" id="ruler-x"></div><div class="ruler-corner"></div></div>
<div class="legend"><span><i></i>Live target positions</span><span id="map-hint">Drag the grid to pan · wheel to zoom · click a zone to select</span><span class="shortcut">Arrow keys nudge · Esc cancels</span></div></section>
<aside class="sidebar"><section><h2 class="section-title">YOUR ZONES <span id="zone-count">0 / 8</span></h2><div class="zone-list" id="zone-list"></div></section><section class="inspector" id="inspector"></section><section class="settings" id="settings"></section></aside></div>
<footer class="footer"><div class="message" id="message" role="status" aria-live="polite">Loading your saved zones…</div><div class="footer-actions"><button class="btn" data-action="discard" disabled>Discard</button><button class="btn primary" data-action="save" disabled>Save zones</button></div></footer></ha-card>`;
        this.mounted=true;this.svg=this.shadowRoot.querySelector('svg');
        this.shadowRoot.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)this.action(b.dataset.action,b);const row=e.target.closest('[data-zone]');if(row&&!this.saving){this.selected=Number(row.dataset.zone);this.target=null;this.mode='select';this.render();}});
        this.shadowRoot.querySelector('#snap').addEventListener('change',e=>{this.snap=Number(e.target.value);});
        this.shadowRoot.querySelector('#inspector').addEventListener('change',e=>this.editField(e));
        this.shadowRoot.querySelector('#settings').addEventListener('change',e=>this.applySetting(e.target));
        this.svg.addEventListener('pointerdown',e=>this.pointerDown(e));this.svg.addEventListener('pointermove',e=>this.pointerMove(e));this.svg.addEventListener('pointerup',e=>this.pointerEnd(e));this.svg.addEventListener('pointercancel',e=>this.pointerEnd(e,true));this.svg.addEventListener('lostpointercapture',e=>this.pointerEnd(e,true));
        this.svg.addEventListener('wheel',e=>this.wheel(e),{passive:false});
        this.shadowRoot.addEventListener('keydown',e=>this.keyDown(e));
        if(globalThis.ResizeObserver)(this.resizeObs=new ResizeObserver(()=>this.renderRulers())).observe(this.svg);
        this.render();
    }
    sync(){
        let changed=false;
        for(let id=1;id<=8;id++){
            const raw=this.state('text',`software_zone_${id}_config`);
            if(raw===undefined || ['unknown','unavailable'].includes(raw))continue;
            try {
                const z=normalizeZone(raw);
                if(!this.loaded.has(id)||!sameZone(z,this.saved[id])){
                    this.saved[id]=z;this.loaded.add(id);changed=true;
                    if(!this.dirty.has(id))this.drafts[id]=clone(z);
                    // A save confirmed after its timeout: the sensor now holds exactly this edit.
                    else if(!this.saving&&sameZone(z,this.drafts[id])){this.dirty.delete(id);delete this.base[id];this.notice(`Zone ${id} was saved after all.`,'success');}
                }
            }catch {
                this.unreadable??={};
                if(this.unreadable[id]!==raw){this.unreadable[id]=raw;this.notice(`Zone ${id} has an unreadable saved setting. It has not been replaced.`,'error');}
            }
        }
        if(!this.firstFit && this.loaded.size===8){
            this.firstFit=true;this.view=fitView(this.drafts);this.selected=Number(Object.keys(this.drafts).find(id=>this.drafts[id]))||null;changed=true;this.notice('All changes are saved.');
            // Zones saved before their entities existed (e.g. the people count) still get named after the zone.
            for(const [id,z] of Object.entries(this.saved))if(z)this.nameEntities(Number(id),z,z);
        }
        const areas=Object.keys(AREAS).map(t=>`${this.areaMask(t)}${this.areaReady(t)}${this.available('text',`${t}_zone_remove`)}`).join();
        if(areas!==this.lastAreas){this.lastAreas=areas;changed=true;}
        // The result time comes from the server's clock, so watch for it to change rather than comparing clocks.
        if(this.learnBefore!==undefined&&this.state('sensor','learning_result_time')!==this.learnBefore){this.learnBefore=undefined;this.notice('Room learning finished.','success');}
        if(changed&&!this.drag){this.renderList();if(!this.inside('#inspector'))this.renderInspector();}
        if(this.panel==='settings'&&!this.inside('#settings'))this.renderSettings();
        this.renderMap();this.renderLive();this.renderButtons();
    }
    targets(){return parseTargets(this.state('sensor','targets_xy'));}
    fresh(){const time=Date.parse(this.state('sensor','tracking_last_update'));return this.state('sensor','tracking_status')==='valid' && Number.isFinite(time) && Date.now()-time<30000;}
    notice(text,type=''){if(!this.mounted)return;const el=this.shadowRoot.querySelector('#message');el.textContent=text;el.className=`message ${type}`;}
    mark(id,z){if(!this.dirty.has(id))this.base[id]=clone(this.saved[id]);this.drafts[id]=z;if(sameZone(z,this.saved[id])){this.dirty.delete(id);delete this.base[id];}else this.dirty.add(id);this.notice(this.dirty.size?`${this.dirty.size} zone${this.dirty.size===1?'':'s'} with unsaved changes.`:'All changes are saved.');}
    action(action,el){
        if(action==='settings'){this.panel=this.panel==='settings'?'zones':'settings';this.render();return;}
        if(action==='learn'){this.learn();return;}
        if(action==='refresh'){this.press('refresh_configuration','Asked the sensor for its current settings and areas.');return;}
        if(this.saving)return;
        if(action==='save'){this.save();return;}
        if(action==='forget-target'){this.forgetTarget(this.target);return;}
        if(action==='discard'){for(const id of this.dirty)this.drafts[id]=clone(this.saved[id]);this.dirty.clear();this.base={};this.pendingAreas=[];this.pendingClears.clear();this.mode='select';this.notice('Changes discarded.');}
        else if(action==='draw'){if(this.mode==='draw'){this.mode='select';this.render();return;}if(this.loaded.size!==8){this.notice('Wait for all eight zone controls to connect.','error');return;}if(this.freeId()===null){this.notice('All eight zones are in use. Delete a zone to make room.','error');return;}this.mode='draw';this.target=null;this.notice('Drag across the grid to draw a zone. Nothing changes until you save.');}
        else if(action==='areas'){
            if(this.mode==='areas'){this.cancelAreas();return;}
            const ready=Object.keys(AREAS).filter(t=>this.areaReady(t));
            if(!ready.length){this.notice('Area controls are missing. Update the FP400 converter in Zigbee2MQTT.','error');return;}
            if(!ready.includes(this.areaType))this.areaType=ready[0];
            this.mode='areas';this.selected=null;this.target=null;this.panel='zones';this.notice(this.areaHelp());
        }
        else if(action==='area-type'&&this.areaReady(el.dataset.type)){this.areaType=el.dataset.type;if(!this.available('text',`${this.areaType}_zone_remove`))this.areaTool='add';this.notice(this.areaHelp());}
        else if(action==='area-tool'){this.areaTool=el.dataset.tool;this.notice(this.areaHelp());}
        else if(action==='clear-area'){
            const t=this.areaType,label=AREAS[t].label.toLowerCase();
            if(this.pendingClears.delete(t))this.notice('Clear undone.');else {this.pendingClears.add(t);this.notice(`Every ${label} cell will be cleared when you save.`);}
        }
        else if(action==='ignore-target')this.ignoreSpot();
        else if(action==='close-target')this.target=null;
        else if(action==='fit'){
            // Outside-room cells are not part of the room, so they do not widen the view.
            const cells=['interference','entry_exit'].flatMap(t=>[...this.draftBits(t)].map(cellOf));
            this.view=fitView([...Object.values(this.drafts),...this.pendingAreas.filter(o=>o.type!=='edge'&&o.op==='add').map(o=>o.rect),...cells],this.fresh()?this.targets():[]);
        }
        else if(action==='zoom-in'||action==='zoom-out')this.zoomAt(action==='zoom-in'?.8:1.25);
        else if(action==='delete'&&this.selected){this.mark(this.selected,null);this.notice('Zone marked for removal. Save to apply, or Discard to undo.');}
        this.render();
    }
    areaHelp(){return `Drag on the map to ${this.areaTool==='remove'?'erase':'paint'} ${AREAS[this.areaType].label.toLowerCase()} cells. Click a dashed shape to undo it. Nothing changes until you save.`;}
    cancelAreas(){
        const n=this.pendingAreas.length+this.pendingClears.size;this.pendingAreas=[];this.pendingClears.clear();this.mode='select';
        this.notice(n?`${n} unsaved area edit${n===1?'':'s'} removed.`:'Areas closed.');this.render();
    }
    // An area type can be edited when its controls exist and its current mask is known.
    areaReady(type){return this.available('text',`${type}_zone_add`)&&this.available('text',`${type}_clear`)&&maskBits(this.areaMask(type))!==null;}
    areaMask(type){return this.state('sensor',`${type}_mask_hex`)??this.state('text',`${type}_mask_hex`);}
    draftBits(type){return draftMask(maskBits(this.areaMask(type)),this.pendingClears.has(type),this.pendingAreas.filter(o=>o.type===type));}
    freeId(){for(let id=1;id<=8;id++)if(this.loaded.has(id)&&!this.drafts[id])return id;return null;}
    point(event){const p=this.svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const m=this.svg.getScreenCTM();if(!m)return {x:0,y:0};const v=p.matrixTransform(m.inverse());return {x:v.x,y:-v.y};}
    pointerDown(event){
        // A second finger (or a palm) must not take over a drag that is already running.
        if(this.saving||event.button>0||(this.drag&&this.drag.pointer!==event.pointerId))return;
        const p=this.point(event),handle=event.target.closest('[data-handle]'),zone=event.target.closest('[data-map-zone]'),dot=event.target.closest('[data-target]');
        if(this.mode==='draw'){
            const id=this.freeId();if(id===null)return;this.drag={kind:'draw',id,start:p,original:clone(this.drafts[id]),prevSelected:this.selected,pointer:event.pointerId};this.selected=id;
        }else if(this.mode==='areas'){
            const hit=event.target.closest('[data-pending]');
            this.drag={kind:'area-draw',start:p,rect:null,hit:hit?Number(hit.dataset.pending):null,clientStart:{x:event.clientX,y:event.clientY},moved:false,pointer:event.pointerId};
        }else if(dot){
            const id=Number(dot.dataset.target),t=this.targets().find(t=>t.id===id);
            event.preventDefault();this.svg.focus({preventScroll:true});this.target=id;this.targetAt=t?{x:t.x,y:t.y}:null;this.selected=null;this.panel='zones';this.render();return;
        }else if(zone){
            const id=Number(zone.dataset.mapZone);this.selected=id;this.target=null;this.drag={kind:handle?'resize':'move',corner:handle?.dataset.handle,id,start:p,original:clone(this.drafts[id]),pointer:event.pointerId};
        }else {
            this.drag={kind:'pan',startView:{...this.view},clientStart:{x:event.clientX,y:event.clientY},scale:this.svg.getScreenCTM()?.a||1,moved:false,pointer:event.pointerId};
            this.svg.classList.add('panning');
        }
        event.preventDefault();this.svg.focus({preventScroll:true});this.svg.setPointerCapture(event.pointerId);this.renderList();this.renderInspector();this.renderMap();
    }
    pointerMove(event){
        if(!this.drag||event.pointerId!==this.drag.pointer)return;
        const d=this.drag;
        if(d.kind==='pan'){
            const dx=(event.clientX-d.clientStart.x)/d.scale,dy=(event.clientY-d.clientStart.y)/d.scale;
            if(Math.abs(event.clientX-d.clientStart.x)+Math.abs(event.clientY-d.clientStart.y)>4)d.moved=true;
            const w=d.startView.width,h=d.startView.height;
            this.view={x:clamp(d.startView.x-dx,-400,400-w),y:clamp(d.startView.y+dy,-50,1000-h),width:w,height:h};
            this.renderMap();this.renderLive();return;
        }
        const p=this.point(event);let z;
        if(d.kind==='area-draw'){
            if(Math.abs(event.clientX-d.clientStart.x)+Math.abs(event.clientY-d.clientStart.y)>4)d.moved=true;
            d.rect=d.moved?clampBlock(rectangleFromPoints(d.start,p,50)):null;
            this.renderAreas();return;
        }
        if(d.kind==='draw'){
            const r=rectangleFromPoints(d.start,p,this.snap);
            z=r.x_max-r.x_min<10||r.y_max-r.y_min<10?d.original:{name:`Zone ${d.id}`,...r,absence_timeout:3};
        }else if(d.kind==='move')z=moveRectangle(d.original,p.x-d.start.x,p.y-d.start.y,this.snap);
        else {
            z=clone(d.original);const snap=v=>this.snap?Math.round(v/this.snap)*this.snap:v;
            if(d.corner.includes('w'))z.x_min=clamp(snap(p.x),LIMITS.x_min,z.x_max-10);
            if(d.corner.includes('e'))z.x_max=clamp(snap(p.x),z.x_min+10,LIMITS.x_max);
            if(d.corner.includes('n'))z.y_max=clamp(snap(p.y),z.y_min+10,LIMITS.y_max);
            if(d.corner.includes('s'))z.y_min=clamp(snap(p.y),LIMITS.y_min,z.y_max-10);
        }
        this.mark(d.id,z);this.renderMap();this.renderButtons();
    }
    pointerEnd(event,cancel=false){
        if(!this.drag||event.pointerId!==this.drag.pointer)return;
        const d=this.drag;this.drag=null;this.svg.classList.remove('panning');
        if(this.svg.hasPointerCapture(event.pointerId))this.svg.releasePointerCapture(event.pointerId);
        if(d.kind==='pan'){if(!d.moved&&(this.selected!==null||this.target!==null)){this.selected=null;this.target=null;this.render();}return;}
        if(d.kind==='area-draw'){
            if(!cancel&&d.rect)this.pendingAreas.push({type:this.areaType,op:this.areaTool,rect:d.rect});
            else if(!cancel&&!d.moved&&d.hit!==null)this.pendingAreas.splice(d.hit,1);
            else {this.render();return;}
            const n=this.pendingAreas.length;
            this.notice(n?`${n} unsaved area edit${n===1?'':'s'}. Save to apply, or Cancel areas to drop ${n===1?'it':'them'}.`:'No unsaved area edits.');
            this.render();return;
        }
        if(cancel)this.mark(d.id,d.original);
        if(d.kind==='draw'&&!this.drafts[d.id]){this.selected=d.prevSelected;this.render();return;}
        this.mode='select';this.render();
    }
    // Zoom keeping world point p (default: view centre) at the same place on screen.
    zoomAt(factor,p){
        const v=this.view,width=clamp(v.width*factor,180,800),height=clamp(v.height*factor,180,1050);
        p??={x:v.x+v.width/2,y:v.y+v.height/2};
        this.view={x:clamp(p.x-(p.x-v.x)/v.width*width,-400,400-width),y:clamp(p.y-(p.y-v.y)/v.height*height,-50,1000-height),width,height};
    }
    wheel(event){
        event.preventDefault();
        this.zoomAt(Math.pow(1.15,Math.sign(event.deltaY)),this.point(event));
        this.renderMap();this.renderLive();
    }
    keyDown(event){
        if(this.saving)return;
        if(event.key==='Escape'){
            const d=this.drag;
            if(d){
                this.drag=null;this.svg.classList.remove('panning');
                if(['draw','move','resize'].includes(d.kind))this.mark(d.id,d.original);
                if(d.kind==='draw')this.selected=d.prevSelected;
                this.render();return;
            }
            if(this.mode==='areas'){this.cancelAreas();return;}
            this.mode='select';this.target=null;this.render();return;
        }
        if(event.target!==this.svg)return;
        const z=this.drafts[this.selected];if(!z||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
        event.preventDefault();const step=event.shiftKey?10:(this.snap||10);
        this.mark(this.selected,moveRectangle(z,event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowDown'?-step:event.key==='ArrowUp'?step:0,0));this.render();
    }
    editField(event){
        // Use the zone the field was rendered for: clicking another zone selects it before this change event fires.
        const field=event.target.dataset.field,id=Number(event.target.dataset.for);if(!field||!this.drafts[id]||this.saving)return;
        this.shadowRoot.querySelector('#inspector')._html=null; // inputs hold typed text; always re-render them
        const z=clone(this.drafts[id]);try{
            if(field==='name')z.name=event.target.value;
            else {
                const value=Number(event.target.value);if(!event.target.value.trim()||!Number.isFinite(value))throw new Error('Enter a valid number.');
                const cx=(z.x_min+z.x_max)/2,cy=(z.y_min+z.y_max)/2,w=z.x_max-z.x_min,h=z.y_max-z.y_min;
                if(field==='width'){z.x_min=Math.round(cx-value*50);z.x_max=Math.round(cx+value*50);}
                if(field==='depth'){z.y_min=Math.round(cy-value*50);z.y_max=Math.round(cy+value*50);}
                if(field==='x'){z.x_min=Math.round(value*100-w/2);z.x_max=Math.round(value*100+w/2);}
                if(field==='y'){z.y_min=Math.round(value*100-h/2);z.y_max=Math.round(value*100+h/2);}
                if(field==='absence_timeout')z.absence_timeout=value;
            }
            normalizeZone(z);
            if(z.x_min<LIMITS.x_min||z.x_max>LIMITS.x_max||z.y_min<LIMITS.y_min||z.y_max>LIMITS.y_max)throw new Error('Keep this rectangle within the displayed 8 × 10 m sensor range.');
            this.mark(id,z);this.render();
        }catch(error){this.notice(error.message,'error');this.renderInspector();}
    }
    render(){if(!this.mounted)return;this.renderMap();this.renderList();this.renderInspector();this.renderSettings();this.renderLive();this.renderButtons();}
    renderMap(){
        if(!this.mounted)return;
        const v=this.view,scale=v.width/700,fs=12*scale,handle=8*scale;
        this.svg.setAttribute('viewBox',`${v.x} ${-v.y-v.height} ${v.width} ${v.height}`);this.svg.classList.toggle('draw',this.mode==='draw');this.svg.classList.toggle('areas',this.mode==='areas');
        const shapes=Object.entries(this.drafts).filter(([,z])=>z).map(([id,z])=>{
            const selected=Number(id)===this.selected,c=COLORS[id-1],dirty=this.dirty.has(Number(id)),occupied=!dirty&&this.state('binary_sensor',`software_zone_${id}_occupancy`)==='on'&&this.fresh();
            const w=z.x_max-z.x_min,h=z.y_max-z.y_min;
            const handles=selected?[[z.x_min,-z.y_max,'nw'],[z.x_max,-z.y_max,'ne'],[z.x_min,-z.y_min,'sw'],[z.x_max,-z.y_min,'se']].map(([x,y,corner])=>`<rect class="handle" data-handle="${corner}" x="${x-handle/2}" y="${y-handle/2}" width="${handle}" height="${handle}" rx="${1.5*scale}" fill="${c}" stroke="#10212a" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join(''):'';
            return `<g data-map-zone="${id}"><rect class="zone-shape" x="${z.x_min}" y="${-z.y_max}" width="${w}" height="${h}" rx="${4*scale}" fill="${c}" fill-opacity="${occupied?.23:.11}" stroke="${c}" stroke-width="${selected?2:1.3}" ${dirty?'stroke-dasharray="5 4"':''} vector-effect="non-scaling-stroke"/><text x="${z.x_min+10*scale}" y="${-z.y_max+19*scale}" fill="${c}" font-size="${fs}" font-weight="650">${escapeHTML(z.name.length>18?z.name.slice(0,17)+'…':z.name)}</text><text x="${z.x_min+10*scale}" y="${-z.y_max+34*scale}" fill="${c}" opacity=".7" font-size="${fs*.77}">${(w/100).toFixed(1)} × ${(h/100).toFixed(1)} m${dirty?' · unsaved':''}</text>${handles}</g>`;
        }).join('');
        setHtml(this.shadowRoot.querySelector('#zones'),shapes);
        setHtml(this.shadowRoot.querySelector('#sensor'),`<g><circle cx="0" cy="0" r="${17*scale}" fill="#162d36" stroke="#67e4b870" vector-effect="non-scaling-stroke"/><path d="M ${-6*scale} ${4*scale} L 0 ${-8*scale} L ${6*scale} ${4*scale} Z" fill="#67e4b8"/><text x="${24*scale}" y="${4*scale}" fill="#91b4bd" font-size="${fs*.8}" letter-spacing="${scale}">FP400</text></g>`);
        this.renderAreas();
        this.renderRulers();
    }
    // Saved cells, plus what Save will change: new cells as drawn, cells about to go faded.
    renderAreas(){
        let cells='';
        for(const type of Object.keys(AREAS).reverse()){
            const saved=maskBits(this.areaMask(type))??new Set(),draft=this.draftBits(type);
            for(const bit of new Set([...saved,...draft])){
                const c=cellOf(bit);
                cells+=`<rect class="area-cell${!draft.has(bit)?' gone':saved.has(bit)?'':' new'}" data-type="${type}" x="${c.x_min}" y="${-c.y_max}" width="50" height="50" fill="url(#${this.uid}-${type})" stroke="${AREAS[type].color}55" stroke-width=".7" vector-effect="non-scaling-stroke"/>`;
            }
        }
        setHtml(this.shadowRoot.querySelector('#areas'),cells);
        const rect=(r,type,op,attrs,preview)=>`<rect ${attrs} x="${r.x_min}" y="${-r.y_max}" width="${r.x_max-r.x_min}" height="${r.y_max-r.y_min}" fill="${!preview?'transparent':op==='remove'?'#0b151c':`url(#${this.uid}-${type})`}" fill-opacity="${preview?.6:1}" stroke="${op==='remove'?'#eef5f6':AREAS[type].color}" stroke-width="1.6" stroke-dasharray="${op==='remove'?'3 4':'6 4'}" vector-effect="non-scaling-stroke"/>`;
        let html=this.pendingAreas.map((o,i)=>rect(o.rect,o.type,o.op,`class="area-pending ${o.op}" data-pending="${i}" data-type="${o.type}"`)).join('');
        if(this.drag?.kind==='area-draw'&&this.drag.rect)html+=rect(this.drag.rect,this.areaType,this.areaTool,'class="area-preview"',true);
        setHtml(this.shadowRoot.querySelector('#pending-areas'),html);
    }
    renderRulers(){
        // The SVG keeps its aspect ratio, so map through the real screen transform, not the viewBox.
        const m=this.svg.getScreenCTM(),r=this.svg.getBoundingClientRect();if(!m||!r.width||!r.height)return;
        const ticks=(from,to,pos,side)=>{
            let html='';
            for(let w=Math.ceil(from/50)*50;w<=to;w+=50){const major=w%100===0;html+=`<div class="tick${major?'':' minor'}" style="${side}:${pos(w).toFixed(1)}px">${major?(Math.abs(w)<1?'0':w/100):''}</div>`;}
            return html;
        };
        setHtml(this.shadowRoot.querySelector('#ruler-y'),ticks((m.f-r.bottom)/m.d,(m.f-r.top)/m.d,y=>m.f-m.d*y-r.top,'top'));
        setHtml(this.shadowRoot.querySelector('#ruler-x'),ticks((r.left-m.e)/m.a,(r.right-m.e)/m.a,x=>m.a*x+m.e-r.left,'left'));
    }
    renderLive(){
        if(!this.mounted)return;
        const fresh=this.fresh(),targets=fresh?this.targets():[],live=this.shadowRoot.querySelector('#live');
        live.classList.toggle('fresh',fresh);live.querySelector('span').textContent=fresh?`Live · ${targets.length} target${targets.length===1?'':'s'}`:'Positions unavailable';
        const scale=this.view.width/700,seen=targets.find(t=>t.id===this.target);
        if(seen)this.targetAt={x:seen.x,y:seen.y};
        let html=targets.map(t=>{const sel=t.id===this.target;return `<g class="target" data-target="${t.id}"><circle class="hit" cx="${t.x}" cy="${-t.y}" r="${15*scale}" fill="${sel?'#ff6b7830':'#ffffff12'}"${sel?' stroke="#ff9aa5" stroke-width="1.5" vector-effect="non-scaling-stroke"':''}/><circle cx="${t.x}" cy="${-t.y}" r="${6*scale}" fill="#f6fbff" stroke="#142731" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="${t.x+11*scale}" y="${-t.y-11*scale}" fill="#fff" font-size="${10*scale}">${t.id+1}</text></g>`;}).join('');
        // Where the selected target was last seen, so a flickering ghost can still be dealt with.
        if(this.target!==null&&!seen&&this.targetAt){const a=this.targetAt;html+=`<g class="target lost"><circle cx="${a.x}" cy="${-a.y}" r="${15*scale}" fill="none" stroke="#ff9aa5" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/><text x="${a.x+11*scale}" y="${-a.y-11*scale}" fill="#ff9aa5" font-size="${10*scale}">${this.target+1}</text></g>`;}
        setHtml(this.shadowRoot.querySelector('#targets'),html);
        if(!this.drag){this.renderList();if(this.target!==null&&!this.inside('#inspector'))this.renderInspector();}
    }
    renderList(){
        const rows=[];
        for(let id=1;id<=8;id++){
            const z=this.drafts[id],removed=!z&&this.dirty.has(id)&&this.saved[id];if(!z&&!removed)continue;
            const dirty=this.dirty.has(id),fresh=this.fresh()&&this.state('binary_sensor',`software_zone_${id}_available`)==='on',on=this.state('binary_sensor',`software_zone_${id}_occupancy`)==='on';
            const count=Number(this.state('sensor',`software_zone_${id}_count`)),activity=this.state('sensor',`software_zone_${id}_activity`);
            const people=count>0?` · ${count} ${count===1?'person':'people'}${['moving','still'].includes(activity)?`, ${activity}`:''}`:'';
            rows.push({id,name:(z||removed).name,z,dot:!dirty&&fresh&&on,status:removed?'Will be removed':dirty?'Unsaved changes':!fresh?'Waiting for positions':on?`Occupied${people}`:'Empty'});
        }
        // Rows are rebuilt only when names or selection change; live status updates in place, so clicks are never lost.
        const list=this.shadowRoot.querySelector('#zone-list');
        setHtml(list,rows.map(r=>`<button class="zone-row ${r.id===this.selected?'selected':''}" style="--zone-color:${COLORS[r.id-1]}" data-zone="${r.id}" ${this.saving?'disabled':''}><span class="swatch"></span><span class="zone-info"><strong>${escapeHTML(r.name)}</strong><small></small></span><span class="dot"></span></button>`).join('')||'<div class="empty">Your room is a blank canvas.<br>Choose <b>Draw zone</b> to add your first area.</div>');
        for(const r of rows){const row=list.querySelector(`[data-zone="${r.id}"]`),small=row.querySelector('small');if(small.textContent!==r.status)small.textContent=r.status;row.querySelector('.dot').hidden=!r.dot;}
        this.shadowRoot.querySelector('#zone-count').textContent=`${rows.filter(r=>r.z).length} / 8`;
    }
    renderInspector(){
        if(!this.mounted)return;
        const el=this.shadowRoot.querySelector('#inspector');
        if(this.mode==='areas'){setHtml(el,this.areasPanel());return;}
        if(this.target!==null){setHtml(el,this.targetPanel());return;}
        const z=this.drafts[this.selected];
        const input=(label,key,value,type='number',extra='')=>`<label class="field">${label}<input data-field="${key}" data-for="${this.selected}" type="${type}" value="${escapeHTML(value)}" ${extra} ${this.saving?'disabled':''}/></label>`;
        setHtml(el,!z?`<h2 class="section-title">ZONE DETAILS</h2><div class="empty">${this.selected&&this.dirty.has(this.selected)?'This zone will be removed when you save.':'Select a zone to adjust its size, position and empty delay.'}</div><p class="small-note">Draw up to eight rectangles. Drag a zone to move it; drag a corner to resize it. Click a dot to see a target.</p>${this.areasSummary()}`
            :`<h2 class="section-title">ZONE DETAILS <span class="count-pill">${this.selected}</span></h2>${input('Name','name',z.name,'text','maxlength="32"')}<div class="fields">${input('Width · m','width',((z.x_max-z.x_min)/100).toFixed(2),'number','min="0.1" max="8" step="0.1"')}${input('Depth · m','depth',((z.y_max-z.y_min)/100).toFixed(2),'number','min="0.1" max="10" step="0.1"')}${input('Centre X · m','x',((z.x_min+z.x_max)/200).toFixed(2),'number','step="0.1"')}${input('Centre Y · m','y',((z.y_min+z.y_max)/200).toFixed(2),'number','step="0.1"')}</div>${input('Empty delay · seconds','absence_timeout',z.absence_timeout,'number','min="0" max="300" step="1"')}<p class="small-note">Wait this long after a target leaves before marking the zone empty.</p><button class="btn danger" data-action="delete" ${this.saving?'disabled':''}>Delete zone</button>${this.areasSummary()}`);
    }
    areasPanel(){
        const types=Object.entries(AREAS).map(([type,a])=>{
            const ready=this.areaReady(type),saved=maskBits(this.areaMask(type)),draft=this.draftBits(type);
            const changed=saved&&(draft.size!==saved.size||[...draft].some(b=>!saved.has(b)));
            const status=ready?`${draft.size} cell${draft.size===1?'':'s'}${changed?' · unsaved':''}`:this.available('text',`${type}_zone_add`)?'Waiting for the sensor':'Needs the newer converter';
            return `<button class="area-type${type===this.areaType?' selected':''}" data-action="area-type" data-type="${type}" style="--area-color:${a.color}" ${ready&&!this.saving?'':'disabled'}><span class="swatch"></span><span class="zone-info"><strong>${a.label}</strong><small>${status}</small></span></button>`;
        }).join('');
        const a=AREAS[this.areaType],clearing=this.pendingClears.has(this.areaType),cells=maskBits(this.areaMask(this.areaType))?.size??0,canErase=this.available('text',`${this.areaType}_zone_remove`);
        const tool=(name,label,ok=true)=>`<button class="btn${this.areaTool===name?' active':''}" data-action="area-tool" data-tool="${name}" ${ok&&!this.saving?'':'disabled'}>${label}</button>`;
        return `<h2 class="section-title">AREAS</h2><div class="area-types">${types}</div><p class="small-note">${a.hint}</p><div class="segmented">${tool('add','Paint')}${tool('remove','Erase',canErase)}</div><p class="small-note">Drag on the map in 0.5 m cells. Click a dashed shape to undo it. Nothing changes until you save.</p><button class="btn danger" data-action="clear-area" ${this.saving||(!cells&&!clearing)?'disabled':''}>${clearing?'Undo clear':`Clear all ${a.label.toLowerCase()} cells`}</button>`;
    }
    areasSummary(){
        if(!Object.keys(AREAS).some(t=>this.areaReady(t)))return '';
        const chips=Object.entries(AREAS).map(([type,a])=>{const n=this.draftBits(type).size;return n?`<span class="area-chip" style="--area-color:${a.color}"><i></i>${a.label} · ${n}</span>`:'';}).join('');
        return `<div class="area-panel"><h2 class="section-title">AREAS</h2>${chips?`<div class="area-chips">${chips}</div>`:''}<p class="small-note">${chips?'':'None yet. '}Use <b>Areas</b> to mark fake-target spots, doorways and space outside the room.</p></div>`;
    }
    targetPanel(){
        const id=this.target,seen=this.fresh()&&this.targets().some(t=>t.id===id),off=this.saving?'disabled':'';
        return `<h2 class="section-title">TARGET <span class="count-pill">${id+1}</span></h2><p class="small-note">${seen?'The sensor sees something here right now.':'The sensor does not see this target right now.'} Not a person? Make the sensor forget it. If it keeps coming back in the same spot, ignore that spot.</p><button class="btn" data-action="forget-target" ${this.forgetting!==null||!this.available('text','remove_target')?'disabled':off}>${this.forgetting!==null?'Forgetting…':'Forget this target'}</button><button class="btn" data-action="ignore-target" ${this.targetAt&&this.areaReady('interference')?off:'disabled'}>Ignore this spot</button><button class="btn subtle" data-action="close-target">Done</button>`;
    }
    renderSettings(){
        if(!this.mounted||this.panel!=='settings')return;
        const groups=SETTINGS.map(([title,items])=>{const rows=items.map(item=>this.settingRow(...item)).join('');return rows?`<h2 class="section-title">${title.toUpperCase()}</h2>${rows}`:'';}).join('');
        const learned=Date.parse(this.state('sensor','learning_result_time')),room=[];
        if(this.available('button','spatial_learning'))room.push(`<button class="btn" data-action="learn">${this.learnArmed?'Room empty? Press again to start':'Learn the empty room'}</button><p class="small-note">Teaches the sensor what your empty room looks like. ${Number.isFinite(learned)?`Last done ${new Date(learned).toLocaleString()}.`:''}</p>`);
        if(this.available('button','refresh_configuration'))room.push(`<button class="btn" data-action="refresh">Read settings from the sensor</button>`);
        setHtml(this.shadowRoot.querySelector('#settings'),`<div class="settings-head"><h2 class="section-title">SENSOR SETTINGS</h2><button class="btn icon" data-action="settings" aria-label="Close settings">✕</button></div>${groups||'<div class="empty">No settings found. Update the FP400 converter in Zigbee2MQTT.</div>'}${room.length?`<h2 class="section-title">ROOM</h2>${room.join('')}`:''}<p class="small-note">Changes apply right away.</p>`);
    }
    settingRow(domain,key,label,extra,scale=1){
        const id=this.entity(domain,key),s=this._hass?.states?.[id];if(!s)return '';
        const attrs=`data-setting="${id}" aria-label="${label}" ${s.state==='unavailable'||this.busy[id]?'disabled':''}`;
        if(domain==='switch')return `<label class="setting toggle"><span>${label}</span><input type="checkbox" role="switch" ${attrs} ${s.state==='on'?'checked':''}></label>`;
        if(domain==='select'){
            const values=(s.attributes?.options??Object.keys(extra)).filter(v=>v in extra);
            return `<label class="setting"><span>${label}</span><select ${attrs}>${values.includes(s.state)?'':'<option value="" selected disabled>Not set</option>'}${values.map(v=>`<option value="${v}" ${v===s.state?'selected':''}>${extra[v]}</option>`).join('')}</select></label>`;
        }
        const value=Number(s.state),a=s.attributes??{};
        return `<label class="setting"><span>${label} · ${extra}</span><input type="number" ${attrs} min="${Math.max(a.min??0,a.step??1)/scale}" max="${(a.max??65535)/scale}" step="1" value="${s.state!==''&&Number.isFinite(value)?value/scale:''}"></label>`;
    }
    // Settings apply at once and count as done only when the sensor's reported state matches.
    async applySetting(input){
        const id=input.dataset.setting;if(!id||this.busy[id])return;
        const [domain,object]=id.split('.'),item=SETTINGS.flatMap(([,items])=>items).find(([d,k])=>d===domain&&object===`${this.device}_${k}`);if(!item)return;
        const [, ,label,,scale=1]=item,a=this._hass.states[id]?.attributes??{},data={entity_id:id};let service,expected;
        try{
            if(domain==='switch'){service=input.checked?'turn_on':'turn_off';expected=input.checked?'on':'off';}
            else if(domain==='select'){service='select_option';data.option=expected=input.value;}
            else {
                const value=Math.round(Number(input.value)*scale),min=Math.max(a.min??0,a.step??1),max=a.max??Infinity;
                if(!input.value.trim()||!Number.isFinite(value)||value<min||value>max)throw new Error(`${label}: enter a number from ${min/scale} to ${max/scale}.`);
                service='set_value';data.value=expected=value;
            }
            this.busy[id]=true;this.renderSettings();this.notice(`Saving ${label}…`);
            await this._hass.callService(domain,service,data);
            await this.waitUntil(()=>{const now=this._hass.states[id]?.state;return domain==='number'?Number(now)===expected:now===expected;},`The sensor did not confirm ${label}. Check it again in a moment.`);
            this.notice(`Saved: ${label}.`,'success');
        }catch(error){this.notice(error?.message??String(error),'error');}
        finally{delete this.busy[id];this.shadowRoot.querySelector('#settings')._html=null;this.renderSettings();}
    }
    async press(key,message){
        try{await this._hass.callService('button','press',{entity_id:this.entity('button',key)});this.notice(message,'success');return true;}
        catch(error){this.notice(error?.message??String(error),'error');return false;}
    }
    // Learning needs an empty room, so the first press only asks.
    async learn(){
        clearTimeout(this.learnTimer);
        if(!this.learnArmed){this.learnArmed=true;this.learnTimer=setTimeout(()=>{this.learnArmed=false;this.renderSettings();},8000);this.notice('Leave the room empty, then press again. It takes about 10 seconds.');this.renderSettings();return;}
        this.learnArmed=false;this.renderSettings();
        const before=this.state('sensor','learning_result_time');
        if(await this.press('spatial_learning','Learning the room. Stay out for about 10 seconds.'))this.learnBefore=before;
    }
    // The sensor drops the track; a real person is picked up again within seconds.
    async forgetTarget(id){
        if(id===null||this.forgetting!==null)return;
        this.forgetting=id;this.renderInspector();
        try{
            await this._hass.callService('text','set_value',{entity_id:this.entity('text','remove_target'),value:String(id)});
            this.notice(`Asked the sensor to forget target ${id+1}…`);
            await this.waitUntil(()=>!this.targets().some(t=>t.id===id),'',12000);
            this.notice(`Target ${id+1} is gone. If it comes back in the same spot, use Ignore this spot.`,'success');
        }catch(error){this.notice(error?.message||`The sensor still sees target ${id+1}. If it is not a person, use Ignore this spot.`,'error');}
        finally{this.forgetting=null;this.renderInspector();}
    }
    // A 1 x 1 m ignore spot around where the target was seen, left unsaved so it can be checked first.
    ignoreSpot(){
        const a=this.targetAt;if(!a)return;
        const x=Math.round(a.x/50)*50,y=Math.round(a.y/50)*50,rect=clampBlock({x_min:x-50,x_max:x+50,y_min:y-50,y_max:y+50});
        if(!rect){this.notice('That spot is outside the sensor grid.','error');return;}
        this.pendingAreas.push({type:'interference',op:'add',rect});
        this.notice(`Marked 1 × 1 m around target ${this.target+1} to ignore. Save to apply, or click the dashed square to undo.`);
        this.areaType='interference';this.areaTool='add';this.mode='areas';this.target=null;
    }
    renderButtons(){
        const areaChanges=this.pendingAreas.length>0||this.pendingClears.size>0;
        const hasChanges=this.dirty.size>0||areaChanges;
        const missing=[...this.dirty].some(id=>['unknown','unavailable',undefined].includes(this.state('text',`software_zone_${id}_config`)))||[...this.pendingClears,...this.pendingAreas.map(o=>o.type)].some(t=>!this.areaReady(t));
        const save=this.shadowRoot.querySelector('[data-action="save"]');
        save.disabled=this.saving||!hasChanges||missing;
        save.textContent=this.saving?'Saving…':this.dirty.size&&areaChanges?'Save all':areaChanges?'Save areas':'Save zones';
        this.shadowRoot.querySelector('[data-action="discard"]').disabled=this.saving||!hasChanges;
        const drawBtn=this.shadowRoot.querySelector('[data-action="draw"]');
        drawBtn.classList.toggle('active',this.mode==='draw');
        drawBtn.disabled=this.saving||this.loaded.size!==8||(this.mode!=='draw'&&this.freeId()===null);
        drawBtn.textContent=this.mode==='draw'?'✕ Cancel draw':'＋ Draw zone';
        const areasBtn=this.shadowRoot.querySelector('[data-action="areas"]');
        areasBtn.classList.toggle('active',this.mode==='areas');
        areasBtn.disabled=this.saving||(this.mode!=='areas'&&!Object.keys(AREAS).some(t=>this.areaReady(t)));
        areasBtn.textContent=this.mode==='areas'?'✕ Cancel areas':'▦ Areas';
        this.shadowRoot.querySelector('header [data-action="settings"]').classList.toggle('active',this.panel==='settings');
        this.shadowRoot.querySelector('.sidebar').classList.toggle('show-settings',this.panel==='settings');
        this.shadowRoot.querySelector('#map-hint').textContent=
            this.mode==='draw'?'Drag across the grid to draw a new zone':
            this.mode==='areas'?`Drag to ${this.areaTool==='remove'?'erase':'paint'} ${AREAS[this.areaType].label.toLowerCase()} cells · click a dashed shape to undo it`:
            this.selected?'Drag zone to move · corners to resize · wheel to zoom':
            'Drag empty space to pan · wheel to zoom · click a zone or a dot';
    }
    async waitUntil(test,message,timeout=15000){
        const until=Date.now()+timeout;
        while(Date.now()<until){if(test())return;await new Promise(resolve=>setTimeout(resolve,150));}
        throw new Error(message);
    }
    confirm(id,expected,timeout){return this.waitUntil(()=>this.loaded.has(id)&&sameZone(this.saved[id],expected),`Zone ${id} was not confirmed. Its unsaved edit is kept; check the connection and retry.`,timeout);}
    waitForMask(type,test,message,timeout){return this.waitUntil(()=>{const bits=maskBits(this.areaMask(type));return Boolean(bits&&test(bits));},message,timeout);}
    // Admins get entities named after the zone ("Desk occupancy"). Only default names and names the card gave
    // change, never one typed by hand; a deleted zone gives the default names back.
    async nameEntities(id,z,old){
        if(!this._hass.user?.is_admin||!this._hass.callWS)return;
        for(const [domain,suffix,label,device_class] of ENTITY_NAMES){
            const entity_id=this.entity(domain,`software_zone_${id}_${suffix}`),name=this._hass.states?.[entity_id]?.attributes?.friendly_name;
            if(name===undefined)continue;
            const ours=Boolean(old)&&name===`${old.name} ${label}`,unnamed=new RegExp(`software zone ${id} ${suffix}$`,'i').test(name);
            if(z?name===`${z.name} ${label}`||!(ours||unnamed):!ours)continue;
            try{await this._hass.callWS({type:'config/entity_registry/update',entity_id,name:z?`${z.name} ${label}`:null,...(z&&device_class?{device_class}:{})});}catch {/* A display-name restriction does not undo a confirmed zone. */}
        }
    }
    async save(){
        if(this.saving||(!this.dirty.size&&!this.pendingAreas.length&&!this.pendingClears.size))return;
        const ids=[...this.dirty].sort(),completed=[];let areasDone=0;
        try{
            for(const id of ids){normalizeZone(this.drafts[id]);if(!sameZone(this.saved[id],this.base[id]))throw new Error(`Zone ${id} changed elsewhere. Discard these edits, then try again.`);}
            this.saving=true;this.render();
            for(const id of ids){
                const z=clone(this.drafts[id]),old=this.saved[id];this.notice(`Saving ${z?z.name:`zone ${id} removal`}…`);
                await this._hass.callService('text','set_value',{entity_id:this.entity('text',`software_zone_${id}_config`),value:z?JSON.stringify(z):'clear'});
                await this.confirm(id,z);
                this.dirty.delete(id);delete this.base[id];completed.push(id);
                await this.nameEntities(id,z,old);
            }
            for(const type of Object.keys(AREAS)){
                if(!this.pendingClears.has(type))continue;
                const label=AREAS[type].label.toLowerCase();this.notice(`Clearing every ${label} cell…`);
                await this._hass.callService('text','set_value',{entity_id:this.entity('text',`${type}_clear`),value:'confirm'});
                await this.waitForMask(type,bits=>bits.size===0,`The sensor did not confirm clearing the ${label} cells. Press Save to retry.`);
                this.pendingClears.delete(type);areasDone++;
            }
            // The converter edits a mask read-modify-write, so each edit must land before the next is sent.
            const total=this.pendingAreas.length;
            for(let n=1;this.pendingAreas.length;n++){
                const {type,op,rect}=this.pendingAreas[0],need=rectBits(rect),have=maskBits(this.areaMask(type));
                const done=bits=>need.every(bit=>bits.has(bit)===(op!=='remove'));
                if(!have||!done(have)){
                    this.notice(`Saving area edit ${n} of ${total}…`);
                    await this._hass.callService('text','set_value',{entity_id:this.entity('text',`${type}_zone_${op==='remove'?'remove':'add'}`),value:JSON.stringify(rect)});
                    await this.waitForMask(type,done,`Area edit ${n} was not confirmed by the sensor. It is still unsaved; press Save to retry.`);
                }
                this.pendingAreas.shift();areasDone++;
            }
            this.notice(areasDone?'Saved. The sensor now uses your areas.':'Saved. Your zones are active in Home Assistant.','success');
        }catch(error){
            const done=completed.length+areasDone;
            this.notice(`${done?`${done} saved. `:''}${error.message ?? 'Could not save. Your edits are kept.'}`,'error');
        }
        finally{this.saving=false;this.mode='select';this.render();}
    }
}
if(globalThis.customElements&&!customElements.get('fp400-zone-card')){
    customElements.define('fp400-zone-card',FP400ZoneCard);
    window.customCards=window.customCards||[];
    window.customCards.push({type:'fp400-zone-card',name:'Aqara FP400 Zone Card',description:'Draw presence zones, doorways and ignore spots for an Aqara FP400 on Zigbee2MQTT.',preview:false,documentationURL:'https://github.com/bobtekkk/aqara-fp400-zone-card'});
    console.info(`%c FP400-ZONE-CARD %c ${VERSION} `,'color:#09261b;background:#67e4b8;font-weight:700','color:#67e4b8;background:#101b24');
}

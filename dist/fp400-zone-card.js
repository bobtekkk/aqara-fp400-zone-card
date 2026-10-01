/* Aqara FP400 zone card for Home Assistant + Zigbee2MQTT. https://github.com/bobtekkk/aqara-fp400-zone-card (MIT License) */
const VERSION = '0.1.0';
const COLORS = ['#67e4b8','#9fa9ff','#f9bf73','#f28fad','#68cce8','#d6a0ef','#bddb79','#ff9d7a'];
const LIMITS = {x_min:-400,x_max:400,y_min:-50,y_max:1000};
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
// The sensor's interference mask: 20 rows x 16 columns of 50 cm cells covering x -400..400, y 0..1000.
// Columns run right to left (column 0 is x = 350..400). Must match worldToGrid in z2m/aqara-fp400.mjs (a test checks this).
export function rectBits(r){
    const r0=Math.max(0,Math.floor(r.y_min/50)),r1=Math.min(19,Math.ceil(r.y_max/50)-1);
    const c0=Math.max(0,8-Math.ceil(r.x_max/50)),c1=Math.min(15,7-Math.floor(r.x_min/50));
    const bits=[];for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++)bits.push(row*16+col);
    return bits;
}
export function maskBits(hex){
    if(typeof hex!=='string'||!/^[0-9a-f]{80}$/i.test(hex))return null;
    const bits=new Set();
    for(let bit=0;bit<320;bit++)if(parseInt(hex.substr((bit>>3)*2,2),16)&(0x80>>(bit%8)))bits.add(bit);
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
const STYLE=`
:host{display:block;height:100%;--ink:#eef5f6;--muted:#93a8b5;--line:#2b3d49;--accent:#67e4b8;font-family:Inter,system-ui,-apple-system,sans-serif;color:var(--ink)}
*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}ha-card{display:flex;flex-direction:column;background:#101b24;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 12px 45px #0002;margin:8px auto;max-width:1440px;height:calc(100dvh - 80px);color:var(--ink)}
header{padding:16px 24px 14px;display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid var(--line);flex-shrink:0}.eyebrow{font-size:10px;font-weight:750;letter-spacing:2px;color:var(--accent);margin-bottom:5px}h1{margin:0;font-size:22px;font-weight:650;letter-spacing:-.6px}.subtitle{font-size:12px;color:var(--muted);margin-top:5px}.live{display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap;border:1px solid var(--line);border-radius:30px;padding:8px 12px}.live i{width:7px;height:7px;background:#83929c;border-radius:50%}.live.fresh i{background:var(--accent);box-shadow:0 0 12px #67e4b844}.main{display:grid;grid-template-columns:minmax(0,1fr) 300px;flex:1;min-height:0;overflow:hidden}.canvas-panel{min-width:0;background:#101d27;display:flex;flex-direction:column;overflow:hidden}.toolbar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;gap:10px;border-bottom:1px solid var(--line);flex-shrink:0}.toolbar-group{display:flex;gap:6px;align-items:center}.btn{color:var(--ink);border:1px solid var(--line);background:#182833;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:600;min-height:36px}.btn:hover:not(:disabled){background:#253b47}.btn.active{border-color:var(--accent);color:var(--accent);background:#173b35}.btn.primary{background:var(--accent);color:#09261b;border:0}.btn.primary:hover:not(:disabled){background:#89f1cd}.btn.icon{min-width:36px;padding:6px;font-size:16px}.btn.danger{color:#ffa5ae}.map-wrap{flex:1;min-height:240px;position:relative;overflow:hidden;--rw:34px;--rh:22px}.map-canvas{position:absolute;top:0;left:var(--rw);right:0;bottom:var(--rh);overflow:hidden}.ruler-y,.ruler-x,.ruler-corner{position:absolute;pointer-events:none;background:#0d1820;color:#7a8f9c;font-size:9px;font-weight:600;letter-spacing:.3px}.ruler-y{top:0;bottom:var(--rh);left:0;width:var(--rw);border-right:1px solid var(--line)}.ruler-x{bottom:0;left:var(--rw);right:0;height:var(--rh);border-top:1px solid var(--line)}.ruler-corner{bottom:0;left:0;width:var(--rw);height:var(--rh);border-right:1px solid var(--line);border-top:1px solid var(--line)}.tick{position:absolute;white-space:nowrap;font-variant-numeric:tabular-nums}.ruler-y .tick{right:4px;text-align:right;transform:translateY(-50%)}.ruler-y .tick::after{content:"";position:absolute;right:-4px;top:50%;width:5px;height:1px;background:#4b6472}.ruler-y .tick.minor::after{width:3px;background:#3a5260}.ruler-x .tick{top:4px;text-align:center;transform:translateX(-50%);min-width:24px}.ruler-x .tick::before{content:"";position:absolute;top:-4px;left:50%;width:1px;height:4px;background:#4b6472;transform:translateX(-50%)}.ruler-x .tick.minor::before{height:3px;background:#3a5260}.map{width:100%;height:100%;display:block;touch-action:none;user-select:none;outline:none;cursor:grab}.map.draw,.map.block{cursor:crosshair}.map.panning{cursor:grabbing}.map .zone-shape{cursor:move}.map .handle{cursor:nwse-resize}.map text{pointer-events:none;font-family:inherit}.map .target,.map .block-cell,.map .block-pending,.map .block-preview{pointer-events:none}.map.block .block-pending{pointer-events:auto;cursor:pointer}.legend{display:flex;justify-content:space-between;gap:12px;padding:10px 20px;color:var(--muted);font-size:11px;border-top:1px solid var(--line);flex-shrink:0}.legend span{display:flex;gap:7px;align-items:center}.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff}.sidebar{background:#14222c;border-left:1px solid var(--line);padding:18px 18px 18px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;min-height:0}.section-title{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:750;letter-spacing:1.6px;color:var(--muted);margin:0 0 11px}.section-title span{letter-spacing:0;font-weight:400}.zone-list{display:flex;flex-direction:column;gap:7px}.zone-row{display:flex;align-items:center;gap:10px;width:100%;padding:12px 11px;text-align:left;color:var(--ink);background:#192b36;border:1px solid transparent;border-radius:10px}.zone-row.selected{border-color:var(--zone-color);background:#21353f}.zone-row .swatch{width:9px;height:28px;border-radius:5px;background:var(--zone-color);flex-shrink:0}.zone-row .zone-info{flex:1;min-width:0}.zone-row strong{font-size:13px;font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.zone-row small{display:block;color:var(--muted);font-size:10px;margin-top:4px}.zone-row .dot{width:6px;height:6px;border-radius:50%;background:var(--zone-color)}.empty{font-size:12px;color:var(--muted);line-height:1.7;padding:18px 2px}.inspector{border-top:1px solid var(--line);padding-top:18px}.field{display:block;margin-bottom:13px;font-size:11px;color:var(--muted)}.field input,.field select{display:block;width:100%;margin-top:6px;background:#0f1d27;color:var(--ink);border:1px solid var(--line);border-radius:8px;min-height:40px;padding:8px 10px;font-size:13px;outline-offset:1px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fields .field{margin:0 0 12px}.inspector .btn{width:100%;margin-top:5px}.block-panel{margin-top:18px;padding-top:16px;border-top:1px dashed var(--line)}.block-panel.solo{margin-top:0;padding-top:0;border-top:0}.block-panel .section-title{color:#ff9aa5}.block-panel .btn{width:100%;margin-top:6px}.small-note{font-size:10px;color:var(--muted);line-height:1.6}.footer{display:flex;gap:15px;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--line);background:#14232c;flex-shrink:0}.footer-actions{display:flex;gap:8px}.message{font-size:12px;color:var(--muted);line-height:1.5}.message.error{color:#ffa5ae}.message.success{color:var(--accent)}.shortcut{color:#718997;font-size:10px}.snap-select{background:#142630;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:8px;font-size:11px;min-height:38px}.count-pill{font-size:10px;padding:3px 7px;border-radius:20px;background:#233945;color:var(--muted)}
@media(max-width:760px){:host{height:auto}ha-card{height:auto;display:block;margin:0;border-radius:16px}header{padding:16px}h1{font-size:20px}.subtitle{font-size:10px}.main{grid-template-columns:1fr;display:block;flex:none;overflow:visible}.canvas-panel{display:block;overflow:visible}.sidebar{border-left:0;border-top:1px solid var(--line);padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px;overflow:visible}.inspector{padding-top:0;border-top:0}.map-wrap{flex:none;height:52vh;min-height:340px;max-height:520px}.toolbar{padding:10px;flex-wrap:wrap}.toolbar .btn{padding:8px 10px}.legend{padding:12px;font-size:10px}.footer{padding:12px 16px;align-items:flex-start;flex-direction:column}.footer-actions{align-self:flex-end}.live{padding:7px 9px;font-size:10px}.shortcut,.legend .shortcut{display:none}}
@media(max-width:420px){.sidebar{grid-template-columns:1fr}.zone-list{display:grid;grid-template-columns:1fr 1fr}.inspector{border-top:1px solid var(--line);padding-top:16px}.map-wrap{min-height:320px}.toolbar-group{gap:4px}.btn{font-size:11px}.subtitle{max-width:225px;line-height:1.5}.live{max-width:116px;white-space:normal}}
`;

export class FP400ZoneCard extends (globalThis.HTMLElement ?? class {}) {
    constructor(){
        super();this.attachShadow({mode:'open'});this.saved={};this.drafts={};this.base={};this.dirty=new Set();this.loaded=new Set();this.selected=null;this.mode='select';this.snap=50;this.view={x:-300,y:-50,width:600,height:600};this.saving=false;this.pendingBlocks=[];this.pendingClear=false;this.uid=`fp${Math.random().toString(36).slice(2)}`;
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
        const keys=[['sensor','targets_xy'],['sensor','tracking_status'],['sensor','tracking_last_update'],['sensor','interference_mask_hex'],['text','interference_mask_hex'],['text','interference_zone_add'],['text','interference_clear']];
        for(let i=1;i<=8;i++)keys.push(['text',`software_zone_${i}_config`],['binary_sensor',`software_zone_${i}_occupancy`],['binary_sensor',`software_zone_${i}_available`]);
        return keys.map(([domain,key])=>this.entity(domain,key));
    }
    get hass(){return this._hass;}
    connectedCallback(){this.clock??=setInterval(()=>{if(this.mounted)this.renderLive();},1000);if(this.mounted)this.resizeObs?.observe(this.svg);}
    disconnectedCallback(){clearInterval(this.clock);this.clock=null;this.resizeObs?.disconnect();}
    entity(domain,key){return `${domain}.${this.device}_${key}`;}
    state(domain,key){return this._hass?.states?.[this.entity(domain,key)]?.state;}
    mount(){
        this.shadowRoot.innerHTML=`<style>${STYLE}</style><ha-card>
<header><div><div class="eyebrow">AQARA FP400 · SPATIAL CONTROL</div><h1>Room zones</h1><div class="subtitle">Draw your room. Give every space its own presence sensor.</div></div><div class="live" id="live"><i></i><span>Connecting</span></div></header>
<div class="main"><section class="canvas-panel"><div class="toolbar"><div class="toolbar-group"><button class="btn" data-action="draw">＋ Draw zone</button><button class="btn" data-action="block">⊘ Block area</button></div><div class="toolbar-group"><label><span class="shortcut">Snap </span><select class="snap-select" id="snap" aria-label="Grid snap"><option value="50">0.5 m grid</option><option value="10">0.1 m grid</option><option value="0">Free draw</option></select></label><button class="btn icon" data-action="zoom-in" aria-label="Zoom in">＋</button><button class="btn icon" data-action="zoom-out" aria-label="Zoom out">−</button><button class="btn" data-action="fit">Fit</button></div></div>
<div class="map-wrap"><div class="map-canvas"><svg class="map" tabindex="0" aria-label="Room map. Drag empty space to pan, wheel to zoom, drag a zone to move it, drag corners to resize." role="img"><defs><pattern id="${this.uid}-small" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#2a3c48" stroke-width=".6" vector-effect="non-scaling-stroke"/></pattern><pattern id="${this.uid}-large" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#${this.uid}-small)"/><path d="M 100 0 L 0 0 0 100" fill="none" stroke="#38505c" stroke-width=".7" vector-effect="non-scaling-stroke"/></pattern><pattern id="${this.uid}-block" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" stroke="#ff6b78" stroke-width="2" vector-effect="non-scaling-stroke"/></pattern></defs><rect x="-2000" y="-2000" width="4000" height="4000" fill="#101d27"/><rect x="-400" y="-1000" width="800" height="1050" fill="url(#${this.uid}-large)"/><path d="M 0 0 L -400 -700 M 0 0 L 400 -700" stroke="#67e4b819" fill="none" stroke-dasharray="5 7" vector-effect="non-scaling-stroke"/><g id="blocks"></g><g id="zones"></g><g id="sensor"></g><g id="targets"></g><g id="pending-blocks"></g></svg></div><div class="ruler-y" id="ruler-y"></div><div class="ruler-x" id="ruler-x"></div><div class="ruler-corner"></div></div>
<div class="legend"><span><i></i>Live target positions</span><span id="map-hint">Drag the grid to pan · wheel to zoom · click a zone to select</span><span class="shortcut">Arrow keys nudge · Esc cancels</span></div></section>
<aside class="sidebar"><section><h2 class="section-title">YOUR ZONES <span id="zone-count">0 / 8</span></h2><div class="zone-list" id="zone-list"></div></section><section class="inspector" id="inspector"></section></aside></div>
<footer class="footer"><div class="message" id="message" role="status" aria-live="polite">Loading your saved zones…</div><div class="footer-actions"><button class="btn" data-action="discard" disabled>Discard</button><button class="btn primary" data-action="save" disabled>Save zones</button></div></footer></ha-card>`;
        this.mounted=true;this.svg=this.shadowRoot.querySelector('svg');
        this.shadowRoot.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)this.action(b.dataset.action);const row=e.target.closest('[data-zone]');if(row&&!this.saving){this.selected=Number(row.dataset.zone);this.mode='select';this.render();}});
        this.shadowRoot.querySelector('#snap').addEventListener('change',e=>{this.snap=Number(e.target.value);});
        this.shadowRoot.querySelector('#inspector').addEventListener('change',e=>this.editField(e));
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
        if(!this.firstFit && this.loaded.size===8){this.firstFit=true;this.view=fitView(this.drafts);this.selected=Number(Object.keys(this.drafts).find(id=>this.drafts[id]))||null;changed=true;this.notice('All changes are saved.');}
        const mask=this.maskHex()??'';
        if(mask!==this.lastMask){this.lastMask=mask;changed=true;}
        if(changed&&!this.drag){this.renderList();if(!this.shadowRoot.querySelector('#inspector').contains(this.shadowRoot.activeElement))this.renderInspector();}
        this.renderMap();this.renderLive();this.renderButtons();
    }
    targets(){return parseTargets(this.state('sensor','targets_xy'));}
    fresh(){const time=Date.parse(this.state('sensor','tracking_last_update'));return this.state('sensor','tracking_status')==='valid' && Number.isFinite(time) && Date.now()-time<30000;}
    notice(text,type=''){if(!this.mounted)return;const el=this.shadowRoot.querySelector('#message');el.textContent=text;el.className=`message ${type}`;}
    mark(id,z){if(!this.dirty.has(id))this.base[id]=clone(this.saved[id]);this.drafts[id]=z;if(sameZone(z,this.saved[id])){this.dirty.delete(id);delete this.base[id];}else this.dirty.add(id);this.notice(this.dirty.size?`${this.dirty.size} zone${this.dirty.size===1?'':'s'} with unsaved changes.`:'All changes are saved.');}
    action(action){
        if(this.saving)return;
        if(action==='save'){this.save();return;}
        if(action==='discard'){for(const id of this.dirty)this.drafts[id]=clone(this.saved[id]);this.dirty.clear();this.base={};this.pendingBlocks=[];this.pendingClear=false;this.mode='select';this.notice('Changes discarded.');}
        else if(action==='draw'){if(this.mode==='draw'){this.mode='select';this.render();return;}if(this.loaded.size!==8){this.notice('Wait for all eight zone controls to connect.','error');return;}if(this.freeId()===null){this.notice('All eight zones are in use. Delete a zone to make room.','error');return;}this.mode='draw';this.notice('Drag across the grid to draw a zone. Nothing changes until you save.');}
        else if(action==='block'){
            if(this.mode==='block'){this.cancelBlocks();return;}
            if(!this.blocksAvailable()){this.notice('Interference controls are missing. Update the FP400 converter in Zigbee2MQTT.','error');return;}
            this.mode='block';this.selected=null;this.notice('Drag over a spot that shows fake targets. Click a dashed block to remove it. Nothing changes until you save.');
        }
        else if(action==='clear-blocks'){this.pendingClear=!this.pendingClear;this.notice(this.pendingClear?'Every red cell will be cleared when you save.':'Clear undone.');}
        else if(action==='fit')this.view=fitView([...Object.values(this.drafts),...this.pendingBlocks,...this.interferenceCells().map(c=>({x_min:c.x,x_max:c.x+c.w,y_min:c.y,y_max:c.y+c.h}))],this.fresh()?this.targets():[]);
        else if(action==='zoom-in'||action==='zoom-out')this.zoomAt(action==='zoom-in'?.8:1.25);
        else if(action==='delete'&&this.selected){this.mark(this.selected,null);this.notice('Zone marked for removal. Save to apply, or Discard to undo.');}
        this.render();
    }
    cancelBlocks(){
        const n=this.pendingBlocks.length;this.pendingBlocks=[];this.mode='select';
        this.notice(n?`${n} unsaved block${n===1?'':'s'} removed.`:'Block drawing cancelled.');this.render();
    }
    blocksAvailable(){return ['interference_zone_add','interference_clear'].every(k=>!['unavailable',undefined].includes(this.state('text',k)));}
    freeId(){for(let id=1;id<=8;id++)if(this.loaded.has(id)&&!this.drafts[id])return id;return null;}
    point(event){const p=this.svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const m=this.svg.getScreenCTM();if(!m)return {x:0,y:0};const v=p.matrixTransform(m.inverse());return {x:v.x,y:-v.y};}
    pointerDown(event){
        // A second finger (or a palm) must not take over a drag that is already running.
        if(this.saving||event.button>0||(this.drag&&this.drag.pointer!==event.pointerId))return;
        const p=this.point(event),handle=event.target.closest('[data-handle]'),zone=event.target.closest('[data-map-zone]');
        if(this.mode==='draw'){
            const id=this.freeId();if(id===null)return;this.drag={kind:'draw',id,start:p,original:clone(this.drafts[id]),prevSelected:this.selected,pointer:event.pointerId};this.selected=id;
        }else if(this.mode==='block'){
            const hit=event.target.closest('[data-pending]');
            this.drag={kind:'block-draw',start:p,rect:null,hit:hit?Number(hit.dataset.pending):null,clientStart:{x:event.clientX,y:event.clientY},moved:false,pointer:event.pointerId};
        }else if(zone){
            const id=Number(zone.dataset.mapZone);this.selected=id;this.drag={kind:handle?'resize':'move',corner:handle?.dataset.handle,id,start:p,original:clone(this.drafts[id]),pointer:event.pointerId};
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
        if(d.kind==='block-draw'){
            if(Math.abs(event.clientX-d.clientStart.x)+Math.abs(event.clientY-d.clientStart.y)>4)d.moved=true;
            d.rect=d.moved?clampBlock(rectangleFromPoints(d.start,p,50)):null;
            this.renderBlocks();return;
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
        if(d.kind==='pan'){if(!d.moved && this.selected!==null){this.selected=null;this.render();}return;}
        if(d.kind==='block-draw'){
            if(!cancel&&d.rect)this.pendingBlocks.push(d.rect);
            else if(!cancel&&!d.moved&&d.hit!==null)this.pendingBlocks.splice(d.hit,1);
            else {this.render();return;}
            const n=this.pendingBlocks.length;
            this.notice(n?`${n} unsaved block${n===1?'':'s'}. Save to apply, or Cancel block to drop ${n===1?'it':'them'}.`:'No unsaved blocks.');
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
            if(this.mode==='block'){this.cancelBlocks();return;}
            this.mode='select';this.render();return;
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
    render(){if(!this.mounted)return;this.renderMap();this.renderList();this.renderInspector();this.renderLive();this.renderButtons();}
    renderMap(){
        if(!this.mounted)return;
        const v=this.view,scale=v.width/700,fs=12*scale,handle=8*scale;
        this.svg.setAttribute('viewBox',`${v.x} ${-v.y-v.height} ${v.width} ${v.height}`);this.svg.classList.toggle('draw',this.mode==='draw');this.svg.classList.toggle('block',this.mode==='block');
        const shapes=Object.entries(this.drafts).filter(([,z])=>z).map(([id,z])=>{
            const selected=Number(id)===this.selected,c=COLORS[id-1],dirty=this.dirty.has(Number(id)),occupied=!dirty&&this.state('binary_sensor',`software_zone_${id}_occupancy`)==='on'&&this.fresh();
            const w=z.x_max-z.x_min,h=z.y_max-z.y_min;
            const handles=selected?[[z.x_min,-z.y_max,'nw'],[z.x_max,-z.y_max,'ne'],[z.x_min,-z.y_min,'sw'],[z.x_max,-z.y_min,'se']].map(([x,y,corner])=>`<rect class="handle" data-handle="${corner}" x="${x-handle/2}" y="${y-handle/2}" width="${handle}" height="${handle}" rx="${1.5*scale}" fill="${c}" stroke="#10212a" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join(''):'';
            return `<g data-map-zone="${id}"><rect class="zone-shape" x="${z.x_min}" y="${-z.y_max}" width="${w}" height="${h}" rx="${4*scale}" fill="${c}" fill-opacity="${occupied?.23:.11}" stroke="${c}" stroke-width="${selected?2:1.3}" ${dirty?'stroke-dasharray="5 4"':''} vector-effect="non-scaling-stroke"/><text x="${z.x_min+10*scale}" y="${-z.y_max+19*scale}" fill="${c}" font-size="${fs}" font-weight="650">${escapeHTML(z.name.length>18?z.name.slice(0,17)+'…':z.name)}</text><text x="${z.x_min+10*scale}" y="${-z.y_max+34*scale}" fill="${c}" opacity=".7" font-size="${fs*.77}">${(w/100).toFixed(1)} × ${(h/100).toFixed(1)} m${dirty?' · unsaved':''}</text>${handles}</g>`;
        }).join('');
        setHtml(this.shadowRoot.querySelector('#zones'),shapes);
        setHtml(this.shadowRoot.querySelector('#sensor'),`<g><circle cx="0" cy="0" r="${17*scale}" fill="#162d36" stroke="#67e4b870" vector-effect="non-scaling-stroke"/><path d="M ${-6*scale} ${4*scale} L 0 ${-8*scale} L ${6*scale} ${4*scale} Z" fill="#67e4b8"/><text x="${24*scale}" y="${4*scale}" fill="#91b4bd" font-size="${fs*.8}" letter-spacing="${scale}">FP400</text></g>`);
        this.renderBlocks();
        this.renderRulers();
    }
    maskHex(){return this.state('sensor','interference_mask_hex')??this.state('text','interference_mask_hex');}
    interferenceCells(){
        const bits=maskBits(this.maskHex());
        return bits?[...bits].map(bit=>({x:350-(bit&15)*50,y:(bit>>4)*50,w:50,h:50})):[];
    }
    renderBlocks(){
        const fade=this.pendingClear?' opacity=".25"':'';
        setHtml(this.shadowRoot.querySelector('#blocks'),this.interferenceCells().map(c=>`<rect class="block-cell" x="${c.x}" y="${-(c.y+c.h)}" width="${c.w}" height="${c.h}" fill="url(#${this.uid}-block)"${fade} stroke="#ff6b7855" stroke-width=".7" vector-effect="non-scaling-stroke"/>`).join(''));
        const rect=(r,attrs)=>`<rect ${attrs} x="${r.x_min}" y="${-r.y_max}" width="${r.x_max-r.x_min}" height="${r.y_max-r.y_min}" fill="url(#${this.uid}-block)" fill-opacity=".6" stroke="#ff6b78" stroke-width="1.6" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`;
        let html=(this.pendingBlocks??[]).map((r,i)=>rect(r,`class="block-pending" data-pending="${i}"`)).join('');
        if(this.drag?.kind==='block-draw'&&this.drag.rect)html+=rect(this.drag.rect,'class="block-preview"');
        setHtml(this.shadowRoot.querySelector('#pending-blocks'),html);
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
        const scale=this.view.width/700;
        setHtml(this.shadowRoot.querySelector('#targets'),targets.map(t=>`<g class="target"><circle cx="${t.x}" cy="${-t.y}" r="${15*scale}" fill="#ffffff12"/><circle cx="${t.x}" cy="${-t.y}" r="${6*scale}" fill="#f6fbff" stroke="#142731" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="${t.x+11*scale}" y="${-t.y-11*scale}" fill="#fff" font-size="${10*scale}">${t.id+1}</text></g>`).join(''));
        if(!this.drag)this.renderList();
    }
    renderList(){
        let count=0;
        const rows=[];for(let id=1;id<=8;id++){
            const z=this.drafts[id],removed=!z&&this.dirty.has(id)&&this.saved[id];if(!z&&!removed)continue;if(z)count++;
            const dirty=this.dirty.has(id),fresh=this.fresh()&&this.state('binary_sensor',`software_zone_${id}_available`)==='on',on=this.state('binary_sensor',`software_zone_${id}_occupancy`)==='on';
            const status=removed?'Will be removed':dirty?'Unsaved changes':!fresh?'Waiting for positions':on?'Occupied':'Empty';
            rows.push(`<button class="zone-row ${id===this.selected?'selected':''}" style="--zone-color:${COLORS[id-1]}" data-zone="${id}" ${this.saving?'disabled':''}><span class="swatch"></span><span class="zone-info"><strong>${escapeHTML((z||removed).name)}</strong><small>${status}</small></span>${!dirty&&fresh&&on?'<span class="dot"></span>':''}</button>`);
        }
        setHtml(this.shadowRoot.querySelector('#zone-list'),rows.join('')||'<div class="empty">Your room is a blank canvas.<br>Choose <b>Draw zone</b> to add your first area.</div>');
        this.shadowRoot.querySelector('#zone-count').textContent=`${count} / 8`;
    }
    renderInspector(){
        const el=this.shadowRoot.querySelector('#inspector'),blocking=this.mode==='block';
        const cells=this.interferenceCells().length,pending=this.pendingBlocks?.length??0;
        const pill=`${cells} cell${cells===1?'':'s'}${this.pendingClear?' · clearing':''}${pending?` · +${pending} new`:''}`;
        const blockPanel=`<div class="block-panel${blocking?' solo':''}"><h2 class="section-title">INTERFERENCE <span class="count-pill">${pill}</span></h2><p class="small-note">${blocking?'Drag over a spot that shows fake targets (curtain, fan, TV). Click a dashed block to remove it. Nothing changes until you save.':'Red cells are spots the sensor ignores. Use <b>Block area</b> to add one.'}</p><button class="btn danger" data-action="clear-blocks" ${this.saving||!this.blocksAvailable()||(!cells&&!this.pendingClear)?'disabled':''}>${this.pendingClear?'Undo clear':'Clear all blocks'}</button></div>`;
        const z=this.drafts[this.selected];
        const input=(label,key,value,type='number',extra='')=>`<label class="field">${label}<input data-field="${key}" data-for="${this.selected}" type="${type}" value="${escapeHTML(value)}" ${extra} ${this.saving?'disabled':''}/></label>`;
        const html=blocking?blockPanel:!z?`<h2 class="section-title">ZONE DETAILS</h2><div class="empty">${this.selected&&this.dirty.has(this.selected)?'This zone will be removed when you save.':'Select a zone to adjust its size, position and empty delay.'}</div><p class="small-note">Draw up to eight rectangles. Drag a zone to move it; drag a corner to resize it.</p>${blockPanel}`
            :`<h2 class="section-title">ZONE DETAILS <span class="count-pill">${this.selected}</span></h2>${input('Name','name',z.name,'text','maxlength="32"')}<div class="fields">${input('Width · m','width',((z.x_max-z.x_min)/100).toFixed(2),'number','min="0.1" max="8" step="0.1"')}${input('Depth · m','depth',((z.y_max-z.y_min)/100).toFixed(2),'number','min="0.1" max="10" step="0.1"')}${input('Centre X · m','x',((z.x_min+z.x_max)/200).toFixed(2),'number','step="0.1"')}${input('Centre Y · m','y',((z.y_min+z.y_max)/200).toFixed(2),'number','step="0.1"')}</div>${input('Empty delay · seconds','absence_timeout',z.absence_timeout,'number','min="0" max="300" step="1"')}<p class="small-note">Wait this long after a target leaves before marking the zone empty.</p><button class="btn danger" data-action="delete" ${this.saving?'disabled':''}>Delete zone</button>${blockPanel}`;
        setHtml(el,html);
    }
    renderButtons(){
        const blockChanges=(this.pendingBlocks?.length??0)>0||Boolean(this.pendingClear);
        const hasChanges=this.dirty.size>0||blockChanges;
        const missing=[...this.dirty].some(id=>['unknown','unavailable',undefined].includes(this.state('text',`software_zone_${id}_config`)))||(blockChanges&&!this.blocksAvailable());
        const save=this.shadowRoot.querySelector('[data-action="save"]');
        save.disabled=this.saving||!hasChanges||missing;
        save.textContent=this.saving?'Saving…':this.dirty.size&&blockChanges?'Save all':blockChanges?'Save blocks':'Save zones';
        this.shadowRoot.querySelector('[data-action="discard"]').disabled=this.saving||!hasChanges;
        const drawBtn=this.shadowRoot.querySelector('[data-action="draw"]');
        drawBtn.classList.toggle('active',this.mode==='draw');
        drawBtn.disabled=this.saving||this.loaded.size!==8||(this.mode!=='draw'&&this.freeId()===null);
        drawBtn.textContent=this.mode==='draw'?'✕ Cancel draw':'＋ Draw zone';
        const blockBtn=this.shadowRoot.querySelector('[data-action="block"]');
        blockBtn.classList.toggle('active',this.mode==='block');
        blockBtn.disabled=this.saving||(this.mode!=='block'&&!this.blocksAvailable());
        blockBtn.textContent=this.mode==='block'?'✕ Cancel block':'⊘ Block area';
        this.shadowRoot.querySelector('#map-hint').textContent=
            this.mode==='draw'?'Drag across the grid to draw a new zone':
            this.mode==='block'?'Drag to block a spot (0.5 m cells) · click a dashed block to remove it':
            this.selected?'Drag zone to move · corners to resize · wheel to zoom':
            'Drag empty space to pan · wheel to zoom · click a zone to select';
    }
    async waitUntil(test,message,timeout=15000){
        const until=Date.now()+timeout;
        while(Date.now()<until){if(test())return;await new Promise(resolve=>setTimeout(resolve,150));}
        throw new Error(message);
    }
    confirm(id,expected,timeout){return this.waitUntil(()=>this.loaded.has(id)&&sameZone(this.saved[id],expected),`Zone ${id} was not confirmed. Its unsaved edit is kept; check the connection and retry.`,timeout);}
    waitForMask(test,message,timeout){return this.waitUntil(()=>{const bits=maskBits(this.maskHex());return Boolean(bits&&test(bits));},message,timeout);}
    async save(){
        this.pendingBlocks??=[];
        if(this.saving||(!this.dirty.size&&!this.pendingBlocks.length&&!this.pendingClear))return;
        const ids=[...this.dirty].sort(),completed=[];let blocksDone=0,cleared=false;
        try{
            for(const id of ids){normalizeZone(this.drafts[id]);if(!sameZone(this.saved[id],this.base[id]))throw new Error(`Zone ${id} changed elsewhere. Discard these edits, then try again.`);}
            this.saving=true;this.render();
            for(const id of ids){
                const z=clone(this.drafts[id]);this.notice(`Saving ${z?z.name:`zone ${id} removal`}…`);
                await this._hass.callService('text','set_value',{entity_id:this.entity('text',`software_zone_${id}_config`),value:z?JSON.stringify(z):'clear'});
                await this.confirm(id,z);
                this.dirty.delete(id);delete this.base[id];completed.push(id);
                if(z&&this._hass.user?.is_admin && this._hass.callWS){
                    for(const [domain,suffix,name,device_class] of [['binary_sensor','occupancy',`${z.name} occupancy`,'occupancy'],['binary_sensor','available',`${z.name} tracking available`,undefined],['text','config',`${z.name} zone configuration`,undefined]]){
                        try{await this._hass.callWS({type:'config/entity_registry/update',entity_id:this.entity(domain,`software_zone_${id}_${suffix}`),name,...(device_class?{device_class}:{})});}catch {/* A display-name restriction does not undo a confirmed zone. */}
                    }
                }
            }
            if(this.pendingClear){
                this.notice('Clearing every red cell…');
                await this._hass.callService('text','set_value',{entity_id:this.entity('text','interference_clear'),value:'confirm'});
                await this.waitForMask(bits=>bits.size===0,'The sensor did not confirm the clear. Nothing else was sent; press Save to retry.');
                this.pendingClear=false;cleared=true;
            }
            // The converter edits the mask with read-modify-write, so each block must land before the next is sent.
            const total=this.pendingBlocks.length;
            while(this.pendingBlocks.length){
                const r=this.pendingBlocks[0],need=rectBits(r),have=maskBits(this.maskHex());
                if(!have||!need.every(bit=>have.has(bit))){
                    this.notice(`Saving block ${blocksDone+1} of ${total}…`);
                    await this._hass.callService('text','set_value',{entity_id:this.entity('text','interference_zone_add'),value:JSON.stringify({x_min:r.x_min,x_max:r.x_max,y_min:r.y_min,y_max:r.y_max})});
                    await this.waitForMask(bits=>need.every(bit=>bits.has(bit)),`Block ${blocksDone+1} was not confirmed by the sensor. It is still unsaved; press Save to retry.`);
                }
                this.pendingBlocks.shift();blocksDone++;
            }
            this.notice(blocksDone||cleared?'Saved. Red cells are the spots the sensor now ignores.':'Saved. Your zones are active in Home Assistant.','success');
        }catch(error){
            const done=completed.length+blocksDone+(cleared?1:0);
            this.notice(`${done?`${done} saved. `:''}${error.message ?? 'Could not save. Your edits are kept.'}`,'error');
        }
        finally{this.saving=false;this.mode='select';this.render();}
    }
}
if(globalThis.customElements&&!customElements.get('fp400-zone-card')){
    customElements.define('fp400-zone-card',FP400ZoneCard);
    window.customCards=window.customCards||[];
    window.customCards.push({type:'fp400-zone-card',name:'Aqara FP400 Zone Card',description:'Draw presence zones and interference blocks for an Aqara FP400 on Zigbee2MQTT.',preview:false,documentationURL:'https://github.com/bobtekkk/aqara-fp400-zone-card'});
    console.info(`%c FP400-ZONE-CARD %c ${VERSION} `,'color:#09261b;background:#67e4b8;font-weight:700','color:#67e4b8;background:#101b24');
}

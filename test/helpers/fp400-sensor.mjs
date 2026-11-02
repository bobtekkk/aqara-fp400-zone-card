// Deliberately model failure modes rather than the converter implementation.
// Synthetic values, not a recording of hardware. Reporting capacity is the observed FP400 limit.
export function fp400Sensor(ieeeAddr='simulated-fp400') {
    const factory=()=>new Map([
        ...[0,2,4,5,6,7,8,22,35,41,42,43,44,45,46,47].map(id=>[`1/aqaraFp400Config/${id}`,0]),
        ...[18,19,20].map(id=>[`1/aqaraFp400Config/${id}`,Buffer.alloc(40)]),
        ['1/aqaraFp400Config/16',[]],['1/128/0',1],['1/msOccupancySensing/3',10],['1/msOccupancySensing/occupancy',0],
    ]);
    let values=factory();const failures=new Map(),endpoints=new Map();
    const d={ieeeAddr,meta:{},calls:[],table:new Set(['1/msOccupancySensing']),saveFails:false,offline:false,
        save:async()=>{if(d.saveFails)throw new Error('Database write failed');},
        get:(ep,c,a)=>values.get(`${ep}/${c}/${a}`),put:(ep,c,a,v)=>values.set(`${ep}/${c}/${a}`,v),
        powerCut:()=>{values=factory();},
        fail:(op,path,count=1,error=new Error('Timeout'))=>failures.set(`${op}/${path}`,{count,error}),
        getEndpoint:id=>{
            if(!endpoints.has(id))endpoints.set(id,{ID:id,
                bind:async()=>{},
                read:async(cluster,attrs)=>{
                    if(d.offline)throw new Error('Timeout');
                    const result={};
                    for(const a of attrs){
                        const path=`${id}/${cluster}/${a}`;d.calls.push(`read/${path}`);
                        const failure=failures.get(`read/${path}`);if(failure && failure.count-->0)throw failure.error;
                        if(!values.has(path))throw Object.assign(new Error('Unsupported attribute'),{code:0x86});
                        const v=values.get(path);result[a]=Buffer.isBuffer(v)?Buffer.from(v):structuredClone(v);
                    }
                    return result;
                },
                write:async(cluster,data)=>{
                    if(d.offline)throw new Error('Timeout');
                    for(const [a,{value}] of Object.entries(data)){
                        const path=`${id}/${cluster}/${a}`;d.calls.push(`write/${path}`);
                        const failure=failures.get(`write/${path}`);if(failure && failure.count-->0)throw failure.error;
                        values.set(path,Buffer.isBuffer(value)?Buffer.from(value):value);
                    }
                },
                command:async(cluster,command,payload)=>{d.calls.push({cluster,command,payload});return {statusCode:0};},
                configureReporting:async(cluster,[entry])=>{
                    const key=`${id}/${cluster}`;
                    if(entry.maximumReportInterval===0xffff){d.table.delete(key);return;}
                    if(!d.table.has(key)&&d.table.size===5)throw Object.assign(new Error('INSUFFICIENT_SPACE'),{code:0x89});
                    d.table.add(key);
                },
            });
            return endpoints.get(id);
        },
    };
    return d;
}

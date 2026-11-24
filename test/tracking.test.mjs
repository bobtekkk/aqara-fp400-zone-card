import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeTrackingFrame,worldToGrid} from '../z2m/aqara-fp400.mjs';
// Published real 3-target frame, truncated on Ember (upstream issue #33146).
const truncated = Buffer.from('1c5f11758b00004c03000900200029220029150129000029000021a00f300030fe20000900200129cfff290402290000290b0021d007300030fe20000900200229beff29010029000029000021d00730','hex');
test('decode complete records including signed coordinates', () => {
    const complete = Buffer.from(truncated.subarray(0,60)); complete.writeUInt16LE(2,8);
    const {targets,reported}=decodeTrackingFrame(complete);
    assert.equal(targets.length,2);assert.equal(reported,2);
    assert.deepEqual(targets[1],{id:1,x:-49,y:516,moving_points:0,micro_points:11,moving:false,tracking_state:2000,type:'person',zone:0},'firmware 60: no moving points, so still');
});
test('valid empty report is an empty list',()=>assert.deepEqual(decodeTrackingFrame(Buffer.from('1c5f11758b00004c0000','hex')),{targets:[],reported:0}));
test('a report cut at 80 bytes keeps every position that arrived',()=>{
    const three=decodeTrackingFrame(truncated);
    assert.equal(three.reported,3);
    assert.deepEqual(three.targets.map(t=>[t.id,t.x,t.y,t.micro_points,t.moving]),[[0,34,277,0,false],[1,-49,516,11,false],[2,-66,1,0,false]],'the third record lost only its last 5 bytes');
    assert.equal(three.targets[2].tracking_state,2000);assert.equal(three.targets[2].type,undefined,'cut before its type');
    const four=Buffer.from(truncated);four.writeUInt16LE(4,8);
    assert.deepEqual([decodeTrackingFrame(four).reported,decodeTrackingFrame(four).targets.length],[4,3],'the fourth target is missing entirely');
    const header=Buffer.from(truncated.subarray(0,22));
    assert.deepEqual(decodeTrackingFrame(header),{targets:[],reported:3},'a cut before any position decodes nothing, but says 3 were there');
});
test('incorrect tags, duplicates, oversized lists and overlong reports throw',()=>{
    const cut=Buffer.from(truncated);cut[73]=0x28;assert.throws(()=>decodeTrackingFrame(cut),/record/,'a wrong tag in a cut record');
    const complete=Buffer.from(truncated.subarray(0,60));complete.writeUInt16LE(2,8);
    assert.throws(()=>decodeTrackingFrame(Buffer.concat([complete,Buffer.from([0])])),/Invalid tracking frame/);
    complete[38]=0;assert.throws(()=>decodeTrackingFrame(complete));
    complete[38]=1;complete[39]=0x20;assert.throws(()=>decodeTrackingFrame(complete));
    const empty=Buffer.from('1c5f11758b00004c0b00','hex');assert.throws(()=>decodeTrackingFrame(empty));
});
test('unrelated events and ordinary reports are ignored',()=>{
    assert.equal(decodeTrackingFrame(Buffer.from('1c5f11758b030000','hex')),undefined);
    assert.equal(decodeTrackingFrame(Buffer.from('1c5f11750a000000','hex')),undefined);
});
test('the sensor\'s own cell for a target matches our grid (record captured from a real FP400)',()=>{
 const rec=Buffer.from('0900200029e9ff290e012908052902002100003000307f2000','hex');rec.writeInt16LE(270,8);rec[22]=255;
 const [t]=decodeTrackingFrame(Buffer.concat([Buffer.from('1c5f113b8b00004c0100','hex'),rec])).targets;
 assert.deepEqual({x:t.x,y:t.y,row:t.cell>>8,col:t.cell&255,activity:t.activity,moving:t.moving,fall:t.fall,type:t.type},{x:-23,y:270,row:5,col:8,activity:2,moving:false,fall:0,type:'person'});
 const g=worldToGrid({x_min:t.x,x_max:t.x+1,y_min:t.y,y_max:t.y+1});
 assert.deepEqual([g.row_start,g.column_start],[5,8]);
});
// Records from the same sensor (0x54ef44100186a338) before and after its update from firmware 0051 to 0063.
const fw51=Buffer.from('1c5f113b8b00004c01000900200029e9ff290e012908052902002100003000307f2000','hex');
const fw63=Buffer.from('1c5f11008b00004c010009002000290600291301294d00295b0021a00f300030fe2000','hex');
test('firmware 0051 sends a cell and an activity (1 moving, 2 still), firmware 0060 and later the points that move',()=>{
    assert.deepEqual(decodeTrackingFrame(fw51,51).targets,[{id:0,x:-23,y:270,cell:0x0508,activity:2,moving:false,fall:0,type:'person',zone:0}]);
    assert.deepEqual(decodeTrackingFrame(fw63,63).targets,[{id:0,x:6,y:275,moving_points:77,micro_points:91,moving:true,tracking_state:4000,type:'person',zone:0}]);
    const moving=Buffer.from(fw51);moving.writeInt16LE(1,24);
    assert.equal(decodeTrackingFrame(moving,51).targets[0].moving,true,'activity 1');
    const odd=Buffer.from(fw51);odd.writeInt16LE(11,24);
    assert.equal('moving' in decodeTrackingFrame(odd,51).targets[0],false,'any other activity is unknown');
    const still=Buffer.from(fw63);still.writeInt16LE(0,21);
    assert.equal(decodeTrackingFrame(still,63).targets[0].moving,false,'0 moving points: only breathing');
});
test('the layout follows the firmware, and a tracker diagnostic shows the new one when the version is stale or unknown',()=>{
    assert.equal(decodeTrackingFrame(fw63).targets[0].moving_points,77,'no version: 4000 cannot be a fall flag');
    assert.equal(decodeTrackingFrame(fw63,51).targets[0].moving_points,77,'a version read before the update');
    assert.equal(decodeTrackingFrame(fw51).targets[0].cell,0x0508,'no version and a fall flag of 0: the old layout');
    const quiet=Buffer.from(fw63);quiet.writeUInt16LE(1,27);
    assert.equal(decodeTrackingFrame(quiet,63).targets[0].moving_points,77,'the version decides when the diagnostic says nothing');
});
test('target type and posture use Aqara\'s lists; unknown values are left out',()=>{
    const types=['person','not_person','fan','pet','curtain','plant','vacuum','air_purifier','child'];
    types.forEach((type,code)=>{const f=Buffer.from(fw63);f[30]=code;assert.equal(decodeTrackingFrame(f,63).targets[0].type,type);});
    const unknown=Buffer.from(fw63);unknown[30]=0xfe;assert.equal('type' in decodeTrackingFrame(unknown,63).targets[0],false);
    ['walk','sit','stand','lie','fall','suspected_fall'].forEach((posture,code)=>{const f=Buffer.from(fw63);f[32]=code;assert.equal(decodeTrackingFrame(f,63).targets[0].posture,posture);});
});

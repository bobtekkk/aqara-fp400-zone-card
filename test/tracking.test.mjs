import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeTrackingFrame,worldToGrid} from '../z2m/aqara-fp400.mjs';
// Published real 3-target frame, truncated on Ember (upstream issue #33146).
const truncated = Buffer.from('1c5f11758b00004c03000900200029220029150129000029000021a00f300030fe20000900200129cfff290402290000290b0021d007300030fe20000900200229beff29010029000029000021d00730','hex');
test('decode complete records including signed coordinates', () => {
    const complete = Buffer.from(truncated.subarray(0,60)); complete.writeUInt16LE(2,8);
    const {targets,reported}=decodeTrackingFrame(complete);
    assert.equal(targets.length,2);assert.equal(reported,2);
    assert.deepEqual(targets[1],{id:1,x:-49,y:516,cell:0,activity:11,fall:2000,posture:0,zone:254,in_zone:0});
});
test('valid empty report is an empty list',()=>assert.deepEqual(decodeTrackingFrame(Buffer.from('1c5f11758b00004c0000','hex')),{targets:[],reported:0}));
test('a report cut at 80 bytes keeps every position that arrived',()=>{
    const three=decodeTrackingFrame(truncated);
    assert.equal(three.reported,3);
    assert.deepEqual(three.targets.map(t=>[t.id,t.x,t.y,t.activity]),[[0,34,277,0],[1,-49,516,11],[2,-66,1,0]],'the third record lost only its last 5 bytes');
    assert.equal(three.targets[2].fall,undefined);
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
 assert.deepEqual({x:t.x,y:t.y,row:t.cell>>8,col:t.cell&255,activity:t.activity},{x:-23,y:270,row:5,col:8,activity:2});
 const g=worldToGrid({x_min:t.x,x_max:t.x+1,y_min:t.y,y_max:t.y+1});
 assert.deepEqual([g.row_start,g.column_start],[5,8]);
});

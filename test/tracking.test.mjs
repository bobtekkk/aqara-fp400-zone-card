import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeTrackingFrame} from '../z2m/aqara-fp400.mjs';
// Published real 3-target frame, truncated on Ember (upstream issue #33146).
const truncated = Buffer.from('1c5f11758b00004c03000900200029220029150129000029000021a00f300030fe20000900200129cfff290402290000290b0021d007300030fe20000900200229beff29010029000029000021d00730','hex');
test('decode complete records including signed coordinates', () => {
    const complete = Buffer.from(truncated.subarray(0,60)); complete.writeUInt16LE(2,8);
    const targets=decodeTrackingFrame(complete);
    assert.equal(targets.length,2);
    assert.deepEqual(targets[1],{id:1,x:-49,y:516,v3:0,v4:11,v5:2000,s1:0,s2:254,s3:0});
});
test('valid empty report is an empty list',()=>assert.deepEqual(decodeTrackingFrame(Buffer.from('1c5f11758b00004c0000','hex')),[]));
test('truncation, incorrect tags, duplicates, oversized lists never mean empty',()=>{
    assert.throws(()=>decodeTrackingFrame(truncated));
    const complete=Buffer.from(truncated.subarray(0,60));complete.writeUInt16LE(2,8);
    complete[38]=0;assert.throws(()=>decodeTrackingFrame(complete));
    complete[38]=1;complete[39]=0x20;assert.throws(()=>decodeTrackingFrame(complete));
    const empty=Buffer.from('1c5f11758b00004c0b00','hex');assert.throws(()=>decodeTrackingFrame(empty));
});
test('unrelated events and ordinary reports are ignored',()=>{
    assert.equal(decodeTrackingFrame(Buffer.from('1c5f11758b030000','hex')),undefined);
    assert.equal(decodeTrackingFrame(Buffer.from('1c5f11750a000000','hex')),undefined);
});

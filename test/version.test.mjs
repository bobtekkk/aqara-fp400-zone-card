import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import definition from '../z2m/aqara-fp400.mjs';

const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const card=readFileSync(new URL('../dist/fp400-zone-card.js',import.meta.url),'utf8');

test('the converter and the card carry the release version',()=>{
    assert.equal(definition.version,pkg.version,'z2m/aqara-fp400.mjs version');
    assert.equal(card.match(/const VERSION = '([^']+)'/)?.[1],pkg.version,'dist/fp400-zone-card.js VERSION');
});

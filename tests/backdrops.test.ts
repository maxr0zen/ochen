import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {BACKDROPS,backdropFor,backdropColors,backdropBounds} from '../src/backdrops.ts';
import {SCHEMES} from '../src/schemes.ts';import {settings} from '../src/core.ts';
test('all six backdrops preserve paths from the unmodified original S/L source exports',async()=>{
 assert.equal(BACKDROPS.length,6);
 for(const b of BACKDROPS){const original=await readFile(`source-library/source-${b.detail}.svg`,'utf8');assert.equal(createHash('sha256').update(original).digest('hex'),b.sourceHash);assert.equal(createHash('sha256').update(b.svg).digest('hex'),b.hash);for(const match of b.svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g))assert.ok(original.includes(`d="${match[1]}"`));assert.equal(b.width,b.detail==='S'?500:1000);assert.equal(b.sourceShapeCount,b.scheme==='peach'?4:10);}
});
test('S/L and palette select supplied background variants; custom schemes keep every paint in background roles',()=>{
 for(const detail of ['S','L'] as const)for(const [key,palette]of Object.entries(SCHEMES)){const b=backdropFor({width:1200,height:900,seed:42,layout:'focus',detail},palette);assert.equal(b.detail,detail);assert.equal(b.scheme,key);assert.ok(Object.values(backdropColors(b,palette)).every(c=>palette.backgroundColors!.includes(c)));assert.equal(backdropColors(b,palette)['#FFFFFF'],palette.backgroundColors![0]);}
 const custom={...SCHEMES.peach,backgroundColors:['#CCDDEE','#AABBCC','#8899AA','#111111'],colors:['#CCDDEE','#AABBCC','#8899AA','#111111',...SCHEMES.peach.objectColors!],background:'#AABBCC'};assert.ok(Object.values(backdropColors(BACKDROPS[0],custom)).every(c=>custom.backgroundColors.includes(c)));
});
test('backgrounds cover every canvas through one uniform scale and centered clipping',()=>{
 for(const source of BACKDROPS)for(const [w,h]of [[1080,1080],[1600,900],[900,1600],[128,8192]]){const fit=backdropBounds(w,h,source);assert.ok(source.width*fit.scale>=w-1e-6&&source.height*fit.scale>=h-1e-6);assert.ok(fit.x<=0&&fit.y<=0);assert.ok(Math.abs(fit.x*2+source.width*fit.scale-w)<1e-6);assert.ok(Math.abs(fit.y*2+source.height*fit.scale-h)<1e-6);}
});
test('background mode round-trips in scenes while legacy settings stay transparent',()=>{
 const cfg={width:1080,height:1080,seed:42,layout:'focus'};assert.equal(settings(cfg).backdrop,'none');for(const backdrop of ['source','solid','none'])assert.equal(settings({...cfg,backdrop}).backdrop,backdrop);assert.throws(()=>settings({...cfg,backdrop:'generated'}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {settings,eligibleAssets,resolveVariants,direct,metaphor,compose,validateScene,variant} from '../src/core.ts';
import type {Asset,Scene} from '../src/core.ts';
import {SCHEMES,scheme,allowedColors,roleColorTable} from '../src/schemes.ts';
const source=JSON.parse(readFileSync(new URL('../library/manifest.json',import.meta.url),'utf8'));
const assets:Asset[]=source.variants.map((v:any)=>({id:`${v.family}:${v.detail}:${v.state}`,nodeId:v.file,name:v.name,familyId:v.family,detail:v.detail,appearance:v.state,width:v.width,height:v.height,role:'support',tags:v.tags,synonyms:[v.family],metaphors:[],source:{illustrationId:`${v.detail}/${v.family}`,illustrationName:`${v.name} ${v.detail}`,nodeId:v.sourceSectionId,capturedAt:'2026-11-03'}}));
test('source catalogue contains 20 main illustrations and their 20 background counterparts; every file matches its source manifest hash',()=>{
 assert.equal(assets.length,40);assert.equal(new Set(assets.map(a=>a.familyId)).size,10);assert.equal(assets.filter(a=>a.appearance==='main').length,20);
 for(const a of assets)for(const detail of ['S','L']as const)for(const state of ['main','background']as const)assert.equal(variant(a,assets,detail,state).familyId,a.familyId);
 for(const v of source.variants){const raw=readFileSync(new URL('../library/'+v.file,import.meta.url));assert.equal(createHash('sha256').update(raw).digest('hex'),v.hash);assert.match(raw.toString(),/<svg/);assert.doesNotMatch(raw.toString(),/<(?:image|text|script)\b/);}
});
test('logical names resolve unambiguously in S and L and switch whole source variants by requested state',()=>{
 for(const detail of ['S','L']as const){const cfg=settings({width:1600,height:900,seed:1,layout:'balanced',detail,appearanceMode:'main'}),pool=eligibleAssets(assets,cfg);assert.equal(pool.length,10);
 const choices=resolveVariants(direct('лампа, книга (фон), монета × 2',pool),assets,cfg);
 assert.equal(choices.length,3);assert.equal(assets.find(a=>a.id===choices[0].assetId)!.detail,detail);assert.equal(assets.find(a=>a.id===choices[1].assetId)!.appearance,'background');assert.equal(choices[2].count,2);
 }
});
test('metaphor resolves to source families once, and background policies select permitted source states',()=>{
 for(const appearanceMode of ['main','mixed','background']as const){const cfg=settings({width:1080,height:1080,seed:42,layout:'focus',detail:'L',appearanceMode}),pool=eligibleAssets(assets,cfg),choices=resolveVariants(metaphor('Идеи для команды',pool),assets,cfg);assert.ok(choices.length>=2);assert.equal(new Set(choices.map(c=>assets.find(a=>a.id===c.assetId)!.familyId)).size,choices.length);
 const states=choices.map(c=>assets.find(a=>a.id===c.assetId)!.appearance);if(appearanceMode==='mixed')assert.ok(states.includes('background')&&states.includes('main'));else assert.ok(states.every(s=>s===appearanceMode));}
});
test('relative object sizes, including repeated coins, stay unchanged across layouts, detail levels, formats and seeds',()=>{
 for(const detail of ['S','L']as const)for(const layout of ['focus','balanced','diagonal']as const)for(const [width,height]of [[1080,1080],[1600,900],[900,1600]])for(const seed of [1,42,987]){
 const cfg=settings({width,height,seed,layout,detail,appearanceMode:'mixed'}),choices=resolveVariants(direct('книга, монета × 2, лампа, цветы',eligibleAssets(assets,cfg)),assets,cfg),placements=compose(choices,assets,cfg);assert.ok(placements.every(p=>p.scale===placements[0].scale));
 const scene:Scene={version:1,settings:cfg,query:'test',choices,placements,palette:SCHEMES.violet};const restored=validateScene(JSON.parse(JSON.stringify(scene)),assets);assert.deepEqual(restored.palette,SCHEMES.violet);assert.doesNotThrow(()=>scheme(restored.palette));
 assert.throws(()=>validateScene({...scene,placements:placements.map((p,i)=>i?{...p,scale:p.scale*.9}:p)},assets),/Пропорции/);
 }
});
test('approved palettes retain exact source slots, allow background colors in main objects, and forbid object-only colors in background objects',()=>{
 assert.deepEqual(SCHEMES.violet.backgroundColors,['#D7CDF5','#AA9BF0','#7864D7','#181817']);
 for(const raw of Object.values(SCHEMES)){const p=scheme(raw),main=allowedColors(p,'main'),background=allowedColors(p,'background');assert.ok(background.every(c=>main.includes(c)));assert.ok(p.objectColors!.every(c=>!background.includes(c)));
 const table=roleColorTable(p,'background');assert.equal(table['#D7CDF5'],p.backgroundColors![0]);assert.equal(table['#F9A3AA'],undefined);assert.equal(roleColorTable(p,'main')['#F9A3AA'],p.objectColors![1]);}
 assert.throws(()=>scheme({...SCHEMES.violet,background:'#F9A3AA'}),/только фоновые/);
 assert.throws(()=>scheme({...SCHEMES.violet,backgroundColors:['#FF0000','#00FF00','#0000FF','#181817']}),/монохром/);
 assert.throws(()=>scheme({...SCHEMES.violet,map:{'#D7CDF5':'#F9A3AA'}}),/вместо произвольной/);
 assert.throws(()=>scheme({name:'legacy',colors:['#000000','#FFFFFF']}),/backgroundColors/);
});
test('still life keeps repeated coins together and foreground props above the book',()=>{
 const cfg=settings({width:1080,height:1080,seed:42,layout:'focus',detail:'S',appearanceMode:'main'}),choices=resolveVariants(direct('книга, монета × 2, лампа',eligibleAssets(assets,cfg)),assets,cfg),scene=compose(choices,assets,cfg);
 const coins=scene.filter(p=>p.assetId.startsWith('coin:')),book=scene.find(p=>p.assetId.startsWith('book:'))!,lamp=scene.find(p=>p.assetId.startsWith('lamp:'))!,coin=assets.find(a=>a.id===coins[0].assetId)!;
 assert.ok(Math.hypot(coins[0].cx-coins[1].cx,coins[0].cy-coins[1].cy)<coin.width*coins[0].scale*1.2);
 assert.ok(lamp.z<book.z);assert.ok(coins.every(c=>c.z>book.z));
 assert.ok(scene.every(p=>p.rotation===0&&p.scale===scene[0].scale));
});
test('source still-life scenes fit all canvas formats without cropping or changing relative size',()=>{
 for(const [query,layout,mode]of [['книга, монета × 2, лампа','focus','main'],['лампа, цветы (фон), ручка, пазлы (фон)','focus','mixed'],['книга (фон), наушники (главный), телефон (главный)','diagonal','mixed']]as const){
  for(const detail of ['S','L']as const)for(const [width,height]of [[1080,1080],[1200,900],[900,1200],[1600,900],[900,1600]]){
   const cfg=settings({width,height,layout,appearanceMode:mode,detail,seed:42}),placements=compose(resolveVariants(direct(query,eligibleAssets(assets,cfg)),assets,cfg),assets,cfg);
   for(const p of placements){const a=assets.find(a=>a.id===p.assetId)!;assert.ok(p.cx-a.width*p.scale/2>=0&&p.cx+a.width*p.scale/2<=width);assert.ok(p.cy-a.height*p.scale/2>=0&&p.cy+a.height*p.scale/2<=height);assert.equal(p.scale,placements[0].scale);}
  }
 }
});

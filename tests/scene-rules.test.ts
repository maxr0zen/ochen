import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {compose,settings,direct,eligibleAssets,resolveVariants} from '../src/core.ts';import type {Asset,Settings} from '../src/core.ts';
import {inspectSceneRules,SCENE_RULES} from '../src/scene-rules.ts';
const assets:Asset[]=JSON.parse(readFileSync(new URL('../examples/v3/catalog.metadata.json',import.meta.url),'utf8'));
function scene(query:string,extra:Partial<Settings>={}){const cfg=settings({width:1080,height:1080,seed:42,layout:'focus',detail:'S',appearanceMode:'main',...extra});return{cfg,placements:compose(resolveVariants(direct(query,eligibleAssets(assets,cfg)),assets,cfg),assets,cfg)};}
test('lamp actually faces its target on all layouts, detail levels, formats and odd/even seeds',()=>{
 for(const detail of ['S','L']as const)for(const layout of ['focus','balanced','diagonal']as const)for(const seed of [1,2,42,43])for(const appearanceMode of ['main','mixed','background']as const)for(const [width,height]of [[1080,1080],[1600,900],[900,1600]]){
  const {placements}=scene('лампа, книга, монета × 2',{detail,layout,seed,width,height,appearanceMode}),lamp=placements.find(p=>p.assetId.startsWith('lamp:'))!,book=placements.find(p=>p.assetId.startsWith('book:'))!,a=assets.find(a=>a.id===lamp.assetId)!,b=assets.find(a=>a.id===book.assetId)!;
  const turn=(x:number,y:number,angle:number)=>{const r=angle*Math.PI/180;return{x:x*Math.cos(r)-y*Math.sin(r),y:x*Math.sin(r)+y*Math.cos(r)};};
  const emit=turn((SCENE_RULES.lamp.emitter.x-.5)*a.width*lamp.scale,(SCENE_RULES.lamp.emitter.y-.5)*a.height*lamp.scale,lamp.rotation),page=turn(.05*b.width*book.scale,-.10*b.height*book.scale,book.rotation),forward=turn(.84,.54,lamp.rotation);
  const dx=book.cx+page.x-lamp.cx-emit.x,dy=book.cy+page.y-lamp.cy-emit.y,cos=(dx*forward.x+dy*forward.y)/Math.hypot(dx,dy)/Math.hypot(forward.x,forward.y);
  assert.ok(cos>.99999,'The page must be in front of the actual lampshade, not a reflected arrangement.');
  assert.ok(inspectSceneRules(placements,assets).every(r=>r.ok));
  for(const p of placements){assert.equal(p.scale,placements[0].scale);const a=assets.find(a=>a.id===p.assetId)!,r=p.rotation*Math.PI/180,w=(a.width*Math.abs(Math.cos(r))+a.height*Math.abs(Math.sin(r)))*p.scale,h=(a.height*Math.abs(Math.cos(r))+a.width*Math.abs(Math.sin(r)))*p.scale;assert.ok(p.cx-w/2>=0&&p.cx+w/2<=width&&p.cy-h/2>=0&&p.cy+h/2<=height);}
 }
});
test('diagnostics detect a manually misplaced target and do not invent a target for a solo lamp',()=>{
 const {placements}=scene('лампа, книга'),edited=placements.map(p=>p.assetId.startsWith('book:')?{...p,cx:-2000,cy:-2000}:p);
 assert.equal(inspectSceneRules(edited,assets).find(r=>r.kind==='illuminates')!.ok,false);
 const solo=scene('лампа');assert.equal(solo.placements.length,1);const report=inspectSceneRules(solo.placements,assets);assert.equal(report[0].ok,false);assert.match(report[0].message,/нет цели/);
});
test('coins prefer wallets to books and distribute between multiple wallets',()=>{
 const {placements}=scene('кошелёк × 2, книга, монета × 4'),relations=inspectSceneRules(placements,assets).filter(r=>r.kind==='coins');assert.equal(relations.length,4);assert.ok(relations.every(r=>r.ok));assert.equal(new Set(relations.map(r=>r.targetId)).size,2);
 for(const r of relations){const target=placements.find(p=>p.instanceId===r.targetId)!;assert.ok(target.assetId.startsWith('wallet:'));}
});
test('pen points onto paper and the phone screen is outside the headphone silhouette',()=>{
 const {placements}=scene('книга (фон), ручка, телефон, наушники',{appearanceMode:'mixed'}),relations=inspectSceneRules(placements,assets);assert.ok(relations.some(r=>r.kind==='writing'&&r.ok));assert.ok(relations.some(r=>r.kind==='audio'&&r.ok));
 const phone=placements.find(p=>p.assetId.startsWith('phone:'))!,h=placements.find(p=>p.assetId.startsWith('headphones:'))!,a=assets.find(a=>a.id===phone.assetId)!,b=assets.find(a=>a.id===h.assetId)!,screen={x:phone.cx,y:phone.cy-a.height*phone.scale*.1};
 assert.ok(Math.abs(screen.x-h.cx)>b.width*h.scale/2||Math.abs(screen.y-h.cy)>b.height*h.scale/2);
});
test('multiple lamps keep independent targets and solving never mutates source assets or changes the requested count',()=>{
 const before=JSON.stringify(assets),{placements}=scene('книга × 2, лампа × 2, монета × 3',{layout:'balanced'}),lights=inspectSceneRules(placements,assets).filter(r=>r.kind==='illuminates');
 assert.equal(placements.length,7);assert.equal(lights.length,2);assert.ok(lights.every(r=>r.ok));assert.equal(new Set(lights.map(r=>r.targetId)).size,2);assert.equal(JSON.stringify(assets),before);
});
test('rule-based variants differ in geometry placement while keeping lamp targeting valid',()=>{
 const a=scene('лампа, книга, монета × 2',{seed:42}).placements,b=scene('лампа, книга, монета × 2',{seed:43}).placements;
 assert.notDeepEqual(a.map(p=>[p.cx,p.cy,p.scale]),b.map(p=>[p.cx,p.cy,p.scale]));assert.ok(inspectSceneRules(a,assets).every(r=>r.ok));assert.ok(inspectSceneRules(b,assets).every(r=>r.ok));
});

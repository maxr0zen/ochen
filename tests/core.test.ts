import test from 'node:test';
import assert from 'node:assert/strict';
import {direct,metaphor,compose,palette,colorTable,settings,validateChoices,validateScene,rotatedBounds} from '../src/core.ts';
import type { Asset,Scene } from '../src/core.ts';
// Synthetic metadata for technical tests, NOT the customer's illustration library.
const asset=(id:string,name:string,width=100,height=120,extra:Partial<Asset>={}):Asset=>({id,nodeId:id,name,width,height,synonyms:[],tags:[],metaphors:[],role:'support',source:{illustrationId:'test',illustrationName:'TEST ONLY',nodeId:id,capturedAt:'2026-11-03'},...extra});
const assets=[asset('person','Человек',100,180,{synonyms:['персонаж'],tags:['команда','люди']}),asset('ladder','Лестница',80,220,{tags:['рост','развитие'],role:'hero'}),asset('cloud','Облако',180,80,{tags:['мечта','будущее']})];
test('direct search resolves synonyms and quantity, preserves every requested item',()=>{
  const choices=direct('персонаж, лестница × 2, облако',assets);
  assert.deepEqual(choices.map(c=>[c.assetId,c.count]),[['person',1],['ladder',2],['cloud',1]]);
});
test('unknown, empty and ambiguous names are explicit errors',()=>{
  assert.throws(()=>direct('Самолёт',assets),/не найдено/);
  assert.throws(()=>direct(' ',assets),/Введите/);
  assert.throws(()=>direct('облако',[...assets,asset('c2','Облако')]),/неоднозначно/);
  assert.equal(direct('c2',[...assets,asset('c2','Облако')])[0].assetId,'c2');
});
test('quantity and hallucinated plans cannot escape the catalog',()=>{
  for(const count of [0,1.5,13,Infinity])assert.throws(()=>validateChoices({choices:[{assetId:'person',count}]},assets));
  assert.throws(()=>direct('человек × 8, лестница × 6',assets),/Не более 12/);
  assert.throws(()=>validateChoices({choices:[{assetId:'new-object',count:1}]},assets),/нет в библиотеке/);
  assert.throws(()=>validateChoices({svg:'<path />'},assets),/choices/);
});
test('local metaphor matching explains evidence and rejects unrelated queries',()=>{
  const result=metaphor('Развитие бизнеса',assets);
  assert.equal(result[0].assetId,'ladder');assert.match(result[0].reason,/рост|развит/);
  assert.throws(()=>metaphor('квантовая телепортация',assets),/нет подходящих/);
});
test('Russian idea inflections resolve to lamp and team to puzzle; filler words do not add candidates',()=>{
  const catalog=[asset('lamp','Лампа'),asset('puzzle','Пазлы'),asset('irrelevant','Объект',100,120,{metaphors:['для']})];
  for(const query of ['идея для команды','идеи для команды'])assert.deepEqual(metaphor(query,catalog).map(c=>c.assetId).sort(),['lamp','puzzle']);
});
test('settings reject malformed dimensions and seeds',()=>{
  for(const bad of [NaN,Infinity,0,-128,9000])assert.throws(()=>settings({width:bad,height:1080,seed:0,layout:'focus'}));
  assert.throws(()=>settings({width:1080,height:1080,seed:-1,layout:'focus'}));
  assert.throws(()=>settings({width:1080,height:1080,seed:0,layout:'unknown'}));
});
test('layout deterministic, seed changes variants, source metadata unchanged',()=>{
  const choices=direct('человек, лестница, облако',assets),cfg={width:1080,height:1080,seed:42,layout:'focus' as const},before=JSON.stringify(assets);
  assert.deepEqual(compose(choices,assets,cfg),compose(choices,assets,cfg));
  assert.notDeepEqual(compose(choices,assets,cfg),compose(choices,assets,{...cfg,seed:43}));
  assert.equal(JSON.stringify(assets),before);
});
test('all schemes stay within canvas after rotation, 1–12 objects and three formats',()=>{
  for(const layout of ['focus','balanced','diagonal']as const)for(const [width,height]of [[1080,1080],[1600,900],[900,1600]])for(let count=1;count<=12;count++){
    const objects=Array.from({length:count},(_,i)=>asset(String(i),String(i),80+i*9,90+i*17));
    const placements=compose(objects.map(a=>({assetId:a.id,count:1,reason:'test'})),objects,{width,height,seed:123,layout});
    assert.equal(placements.length,count);
    for(const p of placements){const a=objects.find(a=>a.id===p.assetId)!,b=rotatedBounds(a.width*p.scale,a.height*p.scale,p.rotation);assert.ok(p.cx-b.width/2>=0&&p.cy-b.height/2>=0);assert.ok(p.cx+b.width/2<=width&&p.cy+b.height/2<=height);}
  }
});
test('balanced group has no overlapping bounding boxes',()=>{
  const choices=direct('человек × 4, лестница × 4, облако × 4',assets),placements=compose(choices,assets,{width:1600,height:900,seed:42,layout:'balanced'});
  for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
    const a=placements[i],b=placements[j],aa=assets.find(x=>x.id===a.assetId)!,bb=assets.find(x=>x.id===b.assetId)!;
    const ab=rotatedBounds(aa.width*a.scale,aa.height*a.scale,a.rotation),ba=rotatedBounds(bb.width*b.scale,bb.height*b.scale,b.rotation);
    assert.ok(Math.abs(a.cx-b.cx)>=(ab.width+ba.width)/2||Math.abs(a.cy-b.cy)>=(ab.height+ba.height)/2);
  }
});
test('palette validates colors and uses stable luminance mapping with explicit overrides',()=>{
  assert.throws(()=>palette({name:'bad',colors:['red','#000000']}));
  assert.throws(()=>palette({colors:['#000000']}));
  const p=palette({colors:['#EEEEEE','#222222'],map:{'#000000':'#123456'}});
  const result=colorTable(['#FFFFFF','#000000','#808080'],p);
  assert.equal(result['#000000'],'#123456');assert.equal(result['#FFFFFF'],'#EEEEEE');
  assert.deepEqual(result,colorTable(['#808080','#000000','#FFFFFF','#FFFFFF'],p));
});
test('scene restore validates version, duplicate instance IDs and actual catalog',()=>{
  const choices=direct('человек, лестница',assets),cfg=settings({width:1080,height:1080,seed:42,layout:'focus'});
  const scene:Scene={version:1,settings:cfg,query:'test',choices,placements:compose(choices,assets,cfg),palette:null};
  assert.deepEqual(validateScene(JSON.parse(JSON.stringify(scene)),assets),scene);
  assert.throws(()=>validateScene({...scene,version:2},assets));
  assert.throws(()=>validateScene({...scene,placements:[scene.placements[0],scene.placements[0]]},assets),/повторный/);
  assert.throws(()=>validateScene(scene,[]),/библиотеке/);
  assert.throws(()=>validateScene({...scene,placements:[scene.placements[0]]},assets),/не совпадают/);
});

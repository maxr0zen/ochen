import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {aiScene} from '../src/ai-plan.ts';import {settings,direct,eligibleAssets,resolveVariants} from '../src/core.ts';import type {Asset} from '../src/core.ts';import {SCHEMES} from '../src/schemes.ts';
import {callProvider,createAiServer} from '../server/ai-server.ts';import type {AIConfig} from '../server/ai-server.ts';
const variants=JSON.parse(readFileSync(new URL('../library/manifest.json',import.meta.url),'utf8')).variants;
const assets:Asset[]=variants.map((v:any)=>({id:`${v.family}:${v.detail}:${v.state}`,nodeId:v.sourceSectionId,name:v.name,familyId:v.family,detail:v.detail,appearance:v.state,width:v.width,height:v.height,role:'support',tags:v.tags,synonyms:[v.family],metaphors:[],source:{illustrationId:v.family,illustrationName:v.name,nodeId:v.sourceSectionId,capturedAt:'2026-11-03'}}));
const cfg=settings({width:1080,height:1080,seed:42,layout:'focus',detail:'S',appearanceMode:'main'});
const plan={summary:'Книга впереди, лампа позади справа.',items:[{assetId:'lamp:S:main',x:.7,y:-.4,rotation:0,z:0},{assetId:'book:S:main',x:0,y:0,rotation:0,z:1}]};
test('AI layout preserves requested subjects, common scale and canvas bounds',()=>{
 const required=resolveVariants(direct('книга, лампа',eligibleAssets(assets,cfg)),assets,cfg),result=aiScene(plan,assets,cfg,'книга, лампа',SCHEMES.violet,required);
 assert.equal(result.scene.placements.length,2);assert.equal(result.scene.placements[0].scale,result.scene.placements[1].scale);
 for(const p of result.scene.placements){const a=assets.find(a=>a.id===p.assetId)!;assert.ok(p.cx-a.width*p.scale/2>=0&&p.cx+a.width*p.scale/2<=1080);assert.ok(p.cy-a.height*p.scale/2>=0&&p.cy+a.height*p.scale/2<=1080);}
 assert.deepEqual(result.scene.palette,SCHEMES.violet);
});
test('AI cannot invent assets, change detail, mutate shapes or change requested quantities',()=>{
 for(const extra of [{assetId:'invented'},{assetId:'book:L:main'},{scale:2},{svg:'<path/>'},{x:NaN},{rotation:90}])assert.throws(()=>aiScene({...plan,items:[{...plan.items[0],...extra},plan.items[1]]},assets,cfg,'test',SCHEMES.violet));
 const required=resolveVariants(direct('книга, лампа × 2',eligibleAssets(assets,cfg)),assets,cfg);assert.throws(()=>aiScene(plan,assets,cfg,'test',SCHEMES.violet,required),/количество/);
});
test('AI rejects hidden subjects, inverted background order and invalid mixed policies',()=>{
 assert.throws(()=>aiScene({summary:'test',items:[{assetId:'coin:S:main',x:0,y:0,rotation:0,z:0},{assetId:'book:S:main',x:0,y:0,rotation:0,z:1}]},assets,cfg,'test',SCHEMES.violet),/перекрыла/);
 assert.throws(()=>aiScene(plan,assets,{...cfg,appearanceMode:'mixed'},'test',SCHEMES.violet),/смешанный/);
 assert.throws(()=>aiScene({...plan,items:[plan.items[0],{...plan.items[1],assetId:'book:S:background'}]},assets,{...cfg,appearanceMode:'mixed'},'test',SCHEMES.violet),/перед главным/);
});
test('provider adapters send structured JSON and Gemini images, never include keys in the prompt',async()=>{
 for(const provider of ['gemini','groq']as const){let calls=0;const config:AIConfig={provider,model:provider==='gemini'?'gemini-3.1-flash-lite':'openai/gpt-oss-120b',apiKey:'test-provider-key',token:'local-test-connection-token'};
 const fake:typeof fetch=async(url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.ok(!String(init?.body).includes(config.apiKey));assert.ok(String(url).startsWith(provider==='gemini'?'https://generativelanguage.googleapis.com/':'https://api.groq.com/'));
  if(provider==='gemini'){assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/png');}else{assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.reasoning_effort,'low');}
  return Response.json(provider==='gemini'?{candidates:[{content:{parts:[{text:JSON.stringify(plan)}]}}]}:{choices:[{message:{content:JSON.stringify(plan)}}]});};
 assert.deepEqual(await callProvider(config,{query:'test'},assets.map(a=>a.id),provider==='gemini'?['data:image/png;base64,aGVsbG8=']:[],fake),plan);assert.equal(calls,1);
 }
});
test('provider failures and malformed JSON do not leak upstream error bodies or keys',async()=>{
 const config:AIConfig={provider:'groq',model:'openai/gpt-oss-120b',apiKey:'secret-marker',token:'local-test-connection-token'};
 const limited:typeof fetch=async()=>new Response('secret-marker',{status:429});await assert.rejects(callProvider(config,{},[],[],limited),error=>/квота/.test(String(error))&&!String(error).includes('secret-marker'));
 const invalid:typeof fetch=async()=>Response.json({choices:[{message:{content:'invalid'}}]});await assert.rejects(callProvider(config,{},[],[],invalid),/JSON/);
});
test('local server requires its separate token and makes no upstream calls without an API key',async()=>{
 let calls=0;const fake:typeof fetch=async()=>{calls++;throw new Error('Unexpected upstream call');};
 const server=await createAiServer({provider:'gemini',model:'gemini-3.1-flash-lite',token:'test-local-connection-token',apiKey:''},fake);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address()as {port:number},url=`http://127.0.0.1:${address.port}`,headers={Authorization:'Bearer test-local-connection-token','Content-Type':'application/json'};
  assert.equal((await fetch(url+'/health')).status,401);const health=await fetch(url+'/health',{headers});assert.deepEqual(await health.json(),{provider:'gemini',model:'gemini-3.1-flash-lite',configured:false,vision:true});
  const response=await fetch(url+'/plan',{method:'POST',headers,body:'{}'});assert.equal(response.status,503);assert.equal(calls,0);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test('local HTTP planning validates actual upstream output and preserves component requests',async()=>{
 let calls=0;let upstreamPlan=plan;const fake:typeof fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(upstreamPlan)}}]});};
 const server=await createAiServer({provider:'groq',model:'openai/gpt-oss-120b',token:'test-local-connection-token',apiKey:'fake-key'},fake);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address()as {port:number},url=`http://127.0.0.1:${address.port}/plan`,headers={Authorization:'Bearer test-local-connection-token','Content-Type':'application/json'};
  const good=await fetch(url,{method:'POST',headers,body:JSON.stringify({settings:cfg,query:'книга, лампа',mode:'components',palette:SCHEMES.violet})});assert.equal(good.status,200);assert.deepEqual((await good.json()).plan,plan);
  const bad=await fetch(url,{method:'POST',headers,body:JSON.stringify({settings:cfg,query:'книга, лампа × 2',mode:'components',palette:SCHEMES.violet})});assert.equal(bad.status,400);assert.match((await bad.json()).error,/количество/);assert.equal(calls,2);
  upstreamPlan={summary:'Фоновая книга и главная лампа.',items:[{assetId:'book:S:background',x:0,y:0,rotation:0,z:0},{assetId:'lamp:S:main',x:.7,y:-.4,rotation:0,z:1}]};
  const explicit=await fetch(url,{method:'POST',headers,body:JSON.stringify({settings:{...cfg,appearanceMode:'background'},query:'книга, лампа (главный)',mode:'components',palette:SCHEMES.violet})});assert.equal(explicit.status,200);assert.equal((await explicit.json()).settings.appearanceMode,'mixed');
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

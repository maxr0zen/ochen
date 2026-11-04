import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir,readFile} from 'node:fs/promises';
import {SCHEMES} from '../../src/schemes.ts';
import {compose,settings,direct,eligibleAssets,resolveVariants} from '../../src/core.ts';import type {Asset} from '../../src/core.ts';

test('connected host state enables actual scene actions and exposes state switching for real catalogue metadata',async({page})=>{
 const bundle=JSON.parse(await readFile('library/bundle.json','utf8'));
 const assets=bundle.variants.map((v:any)=>({id:`${v.family}:${v.detail}:${v.state}`,nodeId:v.file??v.family,name:v.name,role:'support',width:v.width,height:v.height,familyId:v.family,detail:v.detail,appearance:v.state,tags:v.tags,synonyms:[v.family],metaphors:[],thumbnail:v.svg,source:{illustrationId:`${v.detail}/${v.family}`,illustrationName:v.name,nodeId:v.sourceSectionId,capturedAt:'2026-11-03'}}));
 await page.goto('/');await page.evaluate(()=>{const iframe=document.createElement('iframe');iframe.id='host-test';iframe.src='/';iframe.style.cssText='width:480px;height:780px';document.body.replaceChildren(iframe);});
 const frame=page.frameLocator('#host-test');await expect(frame.locator('#compose')).toBeVisible();
 const selected=assets.filter((a:any)=>a.detail==='S'&&a.appearance==='main').slice(0,3),choices=selected.map((a:any)=>({assetId:a.id,count:1,reason:'Contract test'}));
 await page.evaluate(({assets,choices})=>{const iframe=document.querySelector<HTMLIFrameElement>('#host-test')!;iframe.contentWindow!.postMessage({pluginMessage:{type:'state',assets,selection:1,hasScene:true,illustrations:20,instances:choices.map((c:any,i:number)=>({id:`instance-${i}`,assetId:c.assetId})),scene:{choices}}},'*');},{assets,choices});
 await expect(frame.locator('#export-svg')).toBeEnabled();await expect(frame.locator('#choices li')).toHaveCount(3);await expect(frame.locator('#count')).toHaveText('10');
 const cfg=settings({width:1080,height:1080,seed:42,layout:'focus',detail:'S',appearanceMode:'main'}),required=resolveVariants(direct('лампа, книга',eligibleAssets(assets as Asset[],cfg)),assets as Asset[],cfg),scene={settings:cfg,choices:required,placements:compose(required,assets as Asset[],cfg)};
 await page.evaluate(scene=>{document.querySelector<HTMLIFrameElement>('#host-test')!.contentWindow!.postMessage({pluginMessage:{type:'state',selection:1,hasScene:true,illustrations:20,instances:scene.choices.map((c,i)=>({id:`new-${i}`,assetId:c.assetId})),scene}},'*');},scene);
 await expect(frame.locator('#scene-rules')).toBeVisible();await expect(frame.locator('#scene-rule-list')).toContainText('Лампа → Книга');await expect(frame.locator('#scene-rule-list .rule-warning')).toHaveCount(0);
 await frame.locator('#detail').selectOption('L');await frame.locator('#appearance-mode').selectOption('mixed');
 await expect(frame.locator('#status')).not.toHaveClass('error');
});
test('standalone panel is honest, navigable and adapts to plugin and narrow viewports',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#preview-notice')).toContainText('Документ Figma не подключён');
  await expect(page.locator('#compose')).toBeDisabled();
  await page.getByRole('button',{name:'Из компонентов',exact:true}).click();await expect(page.locator('#query-label')).toHaveText('Названия компонентов через запятую');
  await page.getByRole('button',{name:'Портрет',exact:true}).click();await expect(page.locator('#width')).toHaveValue('900');await expect(page.locator('#height')).toHaveValue('1600');
  await page.locator('#detail').selectOption('L');await expect(page.locator('#detail')).toHaveValue('L');
  await page.locator('#appearance-mode').selectOption('mixed');
  await page.locator('#palette').selectOption('peach');await expect(page.locator('.swatch')).toHaveCount(8);
  await page.getByRole('button',{name:'Открыть библиотеку',exact:true}).click();await expect(page.locator('#library-panel')).toBeVisible();
  await expect(page.locator('#library-panel')).toContainText('40 вариантов');await expect(page.locator('#add-selection')).toBeHidden();
  await page.getByRole('button',{name:'Композиция',exact:true}).click();
  await mkdir('output/playwright',{recursive:true});
  for(const width of [480,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`output/playwright/panel-${width}.png`,fullPage:true});}
  expect(errors).toEqual([]);
});

test('AI preview uses local proxy, sends no source contours, and applies only after review',async({page})=>{
 const bundle=JSON.parse(await readFile('library/bundle.json','utf8'));
 const assets=bundle.variants.map((v:any)=>({id:`${v.family}:${v.detail}:${v.state}`,nodeId:v.family,name:v.name,role:'support',width:v.width,height:v.height,familyId:v.family,detail:v.detail,appearance:v.state,tags:v.tags,synonyms:[v.family],metaphors:[],thumbnail:v.svg,source:{illustrationId:v.family,illustrationName:v.name,nodeId:v.sourceSectionId,capturedAt:'2026-11-03'}}));
 let requests=0;
 const plan={summary:'Книга впереди, лампа позади.',items:[{assetId:'lamp:S:main',x:.7,y:-.4,rotation:0,z:0},{assetId:'book:S:main',x:0,y:0,rotation:0,z:1}]};
 await page.route('http://localhost:4174/**',async route=>{const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  expect(route.request().headers().authorization).toBe('Bearer test-local-connection-token');
  if(route.request().url().endsWith('/health')){await route.fulfill({headers,contentType:'application/json',body:JSON.stringify({provider:'gemini',model:'mock-model',configured:true,vision:true})});return;}
  requests++;const payload=route.request().postDataJSON();if(requests===1)expect(payload.images).toEqual([]);else{expect(payload.images).toHaveLength(2);expect(payload.images.every((s:string)=>s.startsWith('data:image/png;base64,'))).toBe(true);expect(payload.feedback).toBe('Плотнее');}expect(JSON.stringify(payload)).not.toContain('<svg');expect(payload.catalog[0]).not.toHaveProperty('thumbnail');
  await route.fulfill({headers,contentType:'application/json',body:JSON.stringify({plan,settings:payload.settings,provider:'gemini',model:'mock-model'})});
 });
 await page.goto('/');await page.evaluate(()=>{(window as any).hostMessages=[];window.addEventListener('message',e=>{if(e.data?.pluginMessage)(window as any).hostMessages.push(e.data.pluginMessage);});const iframe=document.createElement('iframe');iframe.id='ai-host';iframe.src='/';iframe.style.cssText='width:480px;height:780px';document.body.replaceChildren(iframe);});
 const frame=page.frameLocator('#ai-host');await expect(frame.locator('#compose')).toBeVisible();
 await page.evaluate(assets=>{document.querySelector<HTMLIFrameElement>('#ai-host')!.contentWindow!.postMessage({pluginMessage:{type:'state',assets,selection:0,hasScene:false,illustrations:20}},'*');},assets);
 await frame.locator('[data-mode=components]').click();await frame.locator('#appearance-mode').selectOption('main');await frame.locator('#query').fill('книга, лампа');await frame.locator('#ai-panel summary').click();await frame.locator('#ai-token').fill('test-local-connection-token');await frame.locator('#ai-connect').click();await expect(frame.locator('#ai-connection')).toContainText('mock-model');
 await frame.locator('#ai-generate').click();await expect(frame.locator('#ai-result')).toBeVisible();await expect(frame.locator('#ai-summary')).toHaveText(plan.summary);
 await expect.poll(()=>page.evaluate(()=>(window as any).hostMessages.some((m:any)=>m.type==='apply-ai-scene'))).toBe(false);
 await frame.locator('#ai-apply').click();await expect.poll(()=>page.evaluate(()=>(window as any).hostMessages.some((m:any)=>m.type==='apply-ai-scene'))).toBe(true);
 await frame.locator('#ai-images').check();await frame.locator('#ai-feedback').fill('Плотнее');await frame.locator('#ai-refine').click();await expect.poll(()=>requests).toBe(2);await expect(frame.locator('#ai-summary')).toHaveText(plan.summary);
 await frame.locator('#query').fill('другой запрос');await frame.locator('#ai-apply').click();await expect(frame.locator('#status')).toContainText('Параметры изменились');expect(await page.evaluate(()=>(window as any).hostMessages.filter((m:any)=>m.type==='apply-ai-scene').length)).toBe(1);
});
test('custom palette file validates before changing UI state',async({page})=>{
  await page.goto('/');
  await page.locator('#palette-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'bad',colors:['red']}))});
  await expect(page.locator('#status')).toHaveClass('error');await expect(page.locator('#palette')).toHaveValue('violet');
  await page.locator('#palette-file').setInputFiles({name:'palette.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'Custom test',backgroundColors:['#D7CDF5','#AA9BF0','#7864D7','#181817'],objectColors:['#F9ECB0','#F9A3AA','#FFE3E1','#FFFFFF']}))});
  await expect(page.locator('#palette')).toHaveValue('custom');await expect(page.locator('.swatch')).toHaveCount(8);
});
test('SVG parser accepts vector defs and rejects raster, script, broken or conflicting references',async({page})=>{
  await page.goto('/');
  const bundled=await build({entryPoints:['src/svg.ts'],bundle:true,write:false,format:'iife',globalName:'SvgTest'});
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  const valid='<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#000"/></linearGradient><clipPath id="c"><rect width="10" height="10"/></clipPath></defs><g clip-path="url(#c)"><path fill="url(#g)" d="M0 0L10 10"/></g></svg>';
  const unsafe=[
    '<svg><image href="data:image/png;base64,AAAA"/></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><path onclick="alert(1)"/></svg>',
    '<svg><use href="https://example.com/x.svg"/></svg>',
    '<svg><path fill="url(#missing)"/></svg>',
    '<svg><g id="duplicate"/><g id="duplicate"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x "x">]><svg/>',
    '<svg><foreignObject/></svg>',
    '<svg><path style="fill:url(https://example.com/x)"/></svg>',
    '<svg><filter/></svg>',
    '<svg><path></svg>',
  ];
  const validate=async(svg:string)=>page.evaluate(s=>{try{(window as unknown as {SvgTest:{validateSvg:(s:string)=>void}}).SvgTest.validateSvg(s);return true;}catch{return false;}},svg);
  expect(await validate(valid)).toBe(true);for(const svg of unsafe)expect(await validate(svg),svg).toBe(false);
});

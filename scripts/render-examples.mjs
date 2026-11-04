import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {zipSync,strToU8} from 'fflate';
import {compose,settings,direct,metaphor,eligibleAssets,resolveVariants,validateScene} from '../src/core.ts';
import {SCHEMES,roleColorTable} from '../src/schemes.ts';
import {inspectSceneRules} from '../src/scene-rules.ts';
const assets=JSON.parse(await readFile('examples/v3/catalog.metadata.json','utf8'));
const bundle=JSON.parse(await readFile('library/bundle.json','utf8'));
const specs=[
 {query:'книга, монета × 2, лампа',width:1080,height:1080,detail:'S',appearanceMode:'main',backdrop:'source',layout:'focus',palette:'violet'},
 {query:'Идеи для команды',width:1200,height:900,detail:'L',appearanceMode:'mixed',backdrop:'source',layout:'focus',palette:'peach',metaphor:true},
 {query:'книга (фон), наушники (главный), телефон (главный)',width:900,height:1200,detail:'S',appearanceMode:'mixed',backdrop:'source',layout:'diagonal',palette:'turquoise'}
];
await mkdir('examples/v3',{recursive:true});await mkdir('output/composition-v3',{recursive:true});
const renderer=await build({entryPoints:['src/scene-svg.ts'],bundle:true,write:false,format:'iife',globalName:'SceneRenderer'});
const sourceAssets=assets.map(a=>({...a,thumbnail:bundle.variants.find(v=>v.family===a.familyId&&v.detail===a.detail&&v.state===a.appearance).svg}));
const browser=await chromium.launch({channel:'chrome',headless:true}),files={},manifest=[];
try{for(const [index,spec]of specs.entries()){
 const cfg=settings({...spec,seed:42}),pool=eligibleAssets(assets,cfg),choices=resolveVariants(spec.metaphor?metaphor(spec.query,pool):direct(spec.query,pool),assets,cfg);
 const scene=validateScene({version:1,settings:cfg,query:spec.query,choices,placements:compose(choices,assets,cfg),palette:SCHEMES[spec.palette]},assets);
 const page=await browser.newPage({viewport:{width:cfg.width,height:cfg.height},deviceScaleFactor:1});await page.addScriptTag({content:renderer.outputFiles[0].text});
 const result=await page.evaluate(({scene,assets})=>SceneRenderer.sceneSvg(scene,assets),{scene,assets:sourceAssets});
 const name=String(index+1).padStart(2,'0');await writeFile(`examples/v3/${name}.svg`,result);await writeFile(`examples/v3/${name}.scene.json`,JSON.stringify(scene,null,2));files[`${name}.svg`]=strToU8(result);files[`${name}.scene.json`]=strToU8(JSON.stringify(scene,null,2));
 await page.setContent(`<html><body style="margin:0;background:white">${result}</body></html>`);const png=await page.screenshot({path:`examples/v3/${name}.preview.png`});await writeFile(`output/composition-v3/${name}.png`,png);files[`${name}.preview.png`]=new Uint8Array(png);await page.close();
 const rules=inspectSceneRules(scene.placements,assets);if(rules.some(r=>!r.ok))throw new Error('Example failed scene relationship rules.');
 manifest.push({name:spec.query,svg:`${name}.svg`,scene:`${name}.scene.json`,settings:cfg,palette:scene.palette,rules,renderedBy:'approved-source-svg / shared plugin composition engine'});
}
files['manifest.json']=strToU8(JSON.stringify(manifest,null,2));files['catalog.metadata.json']=strToU8(JSON.stringify(assets,null,2));
files['README.txt']=strToU8('Композиции v3. Объекты взяты из утверждённых исходных SVG, их геометрия не менялась. Расположение рассчитано тем же компоновщиком, который используется в плагине Figma. Это локальная SVG-сборка, а не повторный нативный экспорт Figma. JSON можно открыть в плагине с подготовленной библиотекой.');
await writeFile('examples/v3/manifest.json',JSON.stringify(manifest,null,2));await writeFile('examples/v3/catalog.metadata.json',JSON.stringify(assets,null,2));await writeFile('examples/v3/compositions.zip',zipSync(files));
await writeFile('output/composition-v3/rules-validation.json',JSON.stringify(manifest.map(m=>({file:m.svg,rules:m.rules})),null,2));
const titles=['Из компонентов','Идеи для команды','Учиться где удобно'];
const contact=`<!doctype html><html lang="ru"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#f1f4ef;color:#24342a;font:15px system-ui}main{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}figure{margin:0;background:white;border:1px solid #d8e0d4;border-radius:8px;overflow:hidden}img{display:block;width:100%;height:450px;object-fit:contain}figcaption{padding:16px;border-top:1px solid #e6ebe3}strong{font-size:16px}p{margin:5px 0 0;color:#62705f;font-size:13px}</style><main>${manifest.map((m,i)=>`<figure><img src="../../examples/v3/${m.svg}"><figcaption><strong>${titles[i]}</strong><p>${m.settings.width} × ${m.settings.height} · ${m.settings.detail}</p></figcaption></figure>`).join('')}</main></html>`;
await writeFile('output/composition-v3/contact.html',contact);const contactPage=await browser.newPage({viewport:{width:1540,height:600}});await contactPage.goto(pathToFileURL(resolve('output/composition-v3/contact.html')).href);await contactPage.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));await contactPage.screenshot({path:'output/composition-v3/contact.png',fullPage:true});await contactPage.close();
console.log('Rendered three vector scenes from unchanged approved SVGs using the plugin composition engine.');
await import('./build-demo.mjs');
}finally{await browser.close();}

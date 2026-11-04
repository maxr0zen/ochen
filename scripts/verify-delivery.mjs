import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';import {validateScene} from '../src/core.ts';
import {inspectSceneRules} from '../src/scene-rules.ts';
const readJson=async p=>JSON.parse(await readFile(p,'utf8'));
const proof=await readJson('output/native-v2-acceptance.json');
if(proof.variantsPassed!==40||proof.passed!==54||!['colorGuard','relativeGuard','sceneScale','manualOperations','originalsUnchanged'].every(k=>proof[k]===true))throw new Error('Native Figma evidence failed.');
const assets=await readJson('examples/v3/catalog.metadata.json'),examples=[];
for(const name of ['01','02','03']){
 const scene=validateScene(await readJson(`examples/v3/${name}.scene.json`),assets);
 if(inspectSceneRules(scene.placements,assets).some(r=>!r.ok))throw new Error(`Scene rules failed for example ${name}.`);
 examples.push({name,detail:scene.settings.detail,appearance:scene.settings.appearanceMode,objects:scene.placements.length,commonScale:scene.placements[0].scale});
}
const svg=await readJson('output/exports/validation.json');
if(svg.length!==3||svg.some(s=>!s.valid||s.images!==0||s.paths<1))throw new Error('SVG evidence incomplete.');
const geometry=await readJson('output/composition-v3/geometry-validation.json');
if(geometry.length!==3||geometry.some(s=>!s.sourceGeometryIdentical||!s.paletteValid))throw new Error('New source geometry evidence failed.');
await mkdir('output/demo',{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(resolve('demo/index.html')).href);
 const previews=page.locator('img[data-preview]');if(await previews.count()!==3)throw new Error('Missing example previews.');
 await previews.evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
 const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.href));for(const href of links)if(href.startsWith('file:'))await access(fileURLToPath(href));
 await page.screenshot({path:'output/demo/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:900});if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw new Error('Demo overflows narrow viewport.');
 await page.screenshot({path:'output/demo/mobile.png',fullPage:true});if(errors.length)throw new Error(errors.join('\n'));
 const report={createdAt:new Date().toISOString(),nativeEvidenceScope:'v2 source library and balanced layout; not a new native run of v3 scenes',nativeVariants:proof.variantsPassed,nativeCombinations:proof.passed,geometry,examples,svg:svg.map(s=>({file:s.file,paths:s.paths,groups:s.groups,images:s.images})),demo:{examples:3,localLinksChecked:true,viewports:[1280,390],errors}};
 await writeFile('output/delivery-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}

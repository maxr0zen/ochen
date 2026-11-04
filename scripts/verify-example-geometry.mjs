import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {backdropFor,backdropBounds} from '../src/backdrops.ts';
const bundle=JSON.parse(await readFile('library/bundle.json','utf8')),assets=JSON.parse(await readFile('examples/v3/catalog.metadata.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
try{for(const name of ['01','02','03']){
 const scene=JSON.parse(await readFile(`examples/v3/${name}.scene.json`,'utf8')),svg=await readFile(`examples/v3/${name}.svg`,'utf8');
 scene.placements.sort((a,b)=>a.z-b.z);
 const sources=scene.placements.map(p=>{const a=assets.find(a=>a.id===p.assetId);return{appearance:a.appearance,width:a.width,height:a.height,svg:bundle.variants.find(v=>v.family===a.familyId&&v.detail===a.detail&&v.state===a.appearance).svg};});
 const background=backdropFor(scene.settings,scene.palette),fit=backdropBounds(scene.settings.width,scene.settings.height,background);
 const page=await browser.newPage(),result=await page.evaluate(({svg,sources,scene,background,fit})=>{
  const parse=s=>new DOMParser().parseFromString(s,'image/svg+xml'),doc=parse(svg),[layer,...objects]=doc.documentElement.children;
  const keys=['d','x','y','cx','cy','r','rx','ry','width','height','x1','y1','x2','y2','points','transform','viewBox'];
  const geometry=root=>JSON.stringify([...root.querySelectorAll('*')].map(n=>({type:n.localName,geometry:Object.fromEntries(keys.filter(k=>n.hasAttribute(k)).map(k=>[k,n.getAttribute(k)]))})));
  const original=parse(background.svg).documentElement,actual=layer?.firstElementChild;
  if(layer?.id!=='scene-background'||layer.getAttribute('data-source')!==background.id||layer.getAttribute('transform')!==`translate(${fit.x} ${fit.y}) scale(${fit.scale})`||!actual||actual.getAttribute('viewBox')!==original.getAttribute('viewBox')||geometry(actual)!==geometry(original))throw new Error('Original backdrop geometry or placement changed.');
  for(const n of actual.querySelectorAll('[fill],[stroke]'))if(!n.closest('defs,mask,clipPath'))for(const key of ['fill','stroke']){const color=n.getAttribute(key);if(color&&color!=='none'&&!scene.palette.backgroundColors.includes(color))throw new Error(`Forbidden backdrop paint ${color}.`);}
  if(objects.length!==sources.length)throw new Error('Unexpected scene objects.');let paths=0;
  for(const [i,object]of objects.entries()){
   const expected=parse(sources[i].svg).documentElement,actual=object.firstElementChild;
   const p=scene.placements[i],a=sources[i],transform=`translate(${p.cx} ${p.cy}) rotate(${p.rotation}) scale(${p.scale}) translate(${-a.width/2} ${-a.height/2})`;
   if(object.getAttribute('transform')!==transform)throw new Error(`SVG placement differs from scene JSON for object ${i}.`);
   if(geometry(expected)!==geometry(actual))throw new Error(`Source geometry changed in object ${i}.`);
   paths+=actual.querySelectorAll('path').length;
   const allowed=new Set(sources[i].appearance==='background'?scene.palette.backgroundColors:scene.palette.colors);
   for(const n of [actual,...actual.querySelectorAll('*')])if(!n.closest('mask,clipPath,defs'))for(const key of ['fill','stroke','stop-color']){
    let value=n.getAttribute(key);if(!value||value==='none'||value.startsWith('url('))continue;value=value==='white'?'#FFFFFF':value.toUpperCase();if(!allowed.has(value))throw new Error(`Forbidden paint ${value}.`);
   }
  }
  return{objects:objects.length,paths,background:background.id,sourceGeometryIdentical:true,paletteValid:true};
 },{svg,sources,scene,background,fit});report.push({file:`examples/v3/${name}.svg`,...result});await page.close();
}await writeFile('output/composition-v3/geometry-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}finally{await browser.close();}

import {chromium} from '@playwright/test';import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {basename} from 'node:path';
const files=process.argv.slice(2);if(!files.length)throw new Error('Укажите пути SVG-файлов.');
const bundled=await build({entryPoints:['src/svg.ts'],bundle:true,write:false,format:'iife',globalName:'SvgValidation'});
const browser=await chromium.launch({channel:'chrome',headless:true});const report=[];
try{for(const file of files){const page=await browser.newPage({viewport:{width:1080,height:1080},deviceScaleFactor:1});
  await page.setContent('<!doctype html><html><body style="margin:0;background:white"><main id="scene"></main></body></html>');await page.addScriptTag({content:bundled.outputFiles[0].text});
  const svg=await readFile(file,'utf8');const metrics=await page.evaluate(raw=>{
    const doc=window.SvgValidation.validateSvg(raw);document.getElementById('scene').append(document.importNode(doc.documentElement,true));
    const root=document.querySelector('svg');root.style.maxWidth='100vw';root.style.maxHeight='100vh';root.style.display='block';root.style.width='100%';root.style.height='100%';
    return{width:root.getAttribute('width'),height:root.getAttribute('height'),viewBox:root.getAttribute('viewBox'),groups:root.querySelectorAll('g').length,paths:root.querySelectorAll('path').length,images:root.querySelectorAll('image').length,gradients:root.querySelectorAll('linearGradient,radialGradient').length};
  },svg);
  await mkdir('output/exports',{recursive:true});const screenshot=`output/exports/${basename(file,'.svg')}.png`;await page.screenshot({path:screenshot});report.push({file,bytes:Buffer.byteLength(svg),...metrics,screenshot,valid:true});await page.close();
}await writeFile('output/exports/validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}finally{await browser.close();}

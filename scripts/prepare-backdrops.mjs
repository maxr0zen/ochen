import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true}),variants=[];
try{for(const detail of ['S','L']){
 const source=await readFile(`source-library/source-${detail}.svg`,'utf8'),page=await browser.newPage();await page.setContent(source);
 const extracted=await page.evaluate(detail=>{
  const root=document.querySelector('svg'),size=detail==='S'?500:1000,colors={violet:'#D7CDF5',peach:'#FDD7B9',turquoise:'#BEEBEB'};
  return Object.entries(colors).map(([scheme,color])=>{
   const canvases=[...root.querySelectorAll('rect')].filter(n=>!n.closest('defs')&&Number(n.getAttribute('width'))===size&&Number(n.getAttribute('height'))===size);
   const canvas=canvases.find(n=>n.getAttribute('fill')===color);if(!canvas)throw new Error(`Missing original backdrop ${detail}/${scheme}`);
   const bounds=canvas.getBBox(),matrix=root.getCTM().inverse().multiply(canvas.getCTM()),origin=new DOMPoint(bounds.x,bounds.y).matrixTransform(matrix),nodes=[];
   if(canvas.parentElement!==root)nodes.push(canvas.parentElement);
   else for(let n=canvas;n;n=n.nextElementSibling){if(n!==canvas&&(canvases.includes(n)||canvases.some(c=>n.contains(c))))break;nodes.push(n);}
   const count=nodes.reduce((sum,n)=>sum+(n.matches('path,rect,line')?1:0)+n.querySelectorAll('path,rect,line').length,0);
   if(count!==(scheme==='peach'?4:10))throw new Error(`Unexpected source span ${detail}/${scheme}: ${count}`);
   const svg=document.createElementNS(root.namespaceURI,'svg');svg.setAttribute('xmlns',root.namespaceURI);svg.setAttribute('width',String(size));svg.setAttribute('height',String(size));svg.setAttribute('viewBox',`${origin.x} ${origin.y} ${size} ${size}`);svg.setAttribute('fill','none');
   for(const defs of root.querySelectorAll(':scope > defs'))svg.append(defs.cloneNode(true));for(const n of nodes)svg.append(n.cloneNode(true));
   return{id:`backdrop:${scheme}:${detail}`,scheme,detail,width:size,height:size,sourceShapeCount:count,sourceBounds:{x:origin.x,y:origin.y,width:size,height:size},svg:new XMLSerializer().serializeToString(svg)};
  });
 },detail);
 for(const v of extracted)variants.push({...v,sourceFileKey:'4MCFttsSoP7hgQh29zq5G3',sourceSectionId:detail==='S'?'21:25859':'21:25788',sourceHash:createHash('sha256').update(source).digest('hex'),hash:createHash('sha256').update(v.svg).digest('hex')});await page.close();
}await mkdir('library/backdrops',{recursive:true});for(const v of variants)await writeFile(`library/backdrops/${v.scheme}-${v.detail}.svg`,v.svg);await writeFile('library/backdrops.json',JSON.stringify({version:1,variants},null,2));console.log(`Extracted ${variants.length} original backdrops without rewriting their geometry.`);
}finally{await browser.close();}

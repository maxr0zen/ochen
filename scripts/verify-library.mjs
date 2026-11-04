import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const manifest=JSON.parse(await readFile('library/manifest.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 const data=await Promise.all(manifest.variants.map(async v=>({...v,svg:await readFile('library/'+v.file,'utf8')})));
 await page.setContent('<style>body{margin:0;background:#f5f5f3;font:14px system-ui}.grid{display:grid;grid-template-columns:repeat(4,1fr)}figure{margin:8px;padding:8px;background:white}img{width:100%;height:190px;object-fit:contain}figcaption{padding:6px}</style><div class="grid"></div>');
 await page.evaluate(async data=>{const grid=document.querySelector('.grid');const order=[...data].sort((a,b)=>a.family.localeCompare(b.family)||a.detail.localeCompare(b.detail)||(a.state==='main'?-1:1));for(const v of order){const figure=document.createElement('figure'),img=new Image(),caption=document.createElement('figcaption');img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(v.svg);caption.textContent=`${v.name} · ${v.detail} · ${v.state}`;figure.append(img,caption);grid.append(figure);await img.decode();}},data);
 await mkdir('output/library',{recursive:true});await page.screenshot({path:'output/library/contact-sheet.png',fullPage:true});
 // Independent whole-object Figma copies are gold references for complex groups.
 const comparisons=[];
 for(const [gold,family,state]of [['L-01','flowers','background'],['L-02','flowers','main'],['L-03','coin','background'],['L-04','coin','main'],['L-05','folder','background']]){
  const actual=await readFile(`library/assets/${family}-L-${state}.svg`,'utf8'),expected=await readFile(`source-library/${gold}.svg`,'utf8');
  const metrics=await page.evaluate(async([actual,expected])=>{
   async function pixels(raw){const holder=document.createElement('div');holder.innerHTML=raw;document.body.append(holder);const svg=holder.querySelector('svg'),rootTransform=svg.getCTM().inverse();const elements=[...svg.querySelectorAll('path,rect,circle,ellipse,line,polygon,polyline')].filter(n=>!n.closest('defs,mask,clipPath'));const boxes=elements.map(n=>{const b=n.getBBox(),t=rootTransform.multiply(n.getCTM()),p=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(t));return{x:Math.min(...p.map(q=>q.x)),y:Math.min(...p.map(q=>q.y)),right:Math.max(...p.map(q=>q.x)),bottom:Math.max(...p.map(q=>q.y))};});const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.right)),bottom=Math.max(...boxes.map(b=>b.bottom));svg.setAttribute('viewBox',`${x-3} ${y-3} ${right-x+6} ${bottom-y+6}`);svg.setAttribute('width','512');svg.setAttribute('height','512');const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));await img.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,512,512);ctx.drawImage(img,0,0);holder.remove();return{data:ctx.getImageData(0,0,512,512).data,shapes:elements.length};}
   const a=await pixels(actual),b=await pixels(expected);let sum=0,different=0;for(let i=0;i<a.data.length;i+=4){let max=0;for(let c=0;c<3;c++){const d=Math.abs(a.data[i+c]-b.data[i+c]);sum+=d;max=Math.max(max,d);}if(max>20)different++;}return{extractedShapes:a.shapes,referenceShapes:b.shapes,meanChannelDifference:sum/(512*512*3),differentPixelFraction:different/(512*512)};
  },[actual,expected]);
  comparisons.push({gold,family,state,...metrics});
  if(metrics.differentPixelFraction>.015||metrics.meanChannelDifference>2||metrics.extractedShapes!==metrics.referenceShapes)throw Error(`Source reference mismatch: ${JSON.stringify(comparisons.at(-1))}`);
 }
 await writeFile('output/library/validation.json',JSON.stringify({variants:data.length,comparisons},null,2));console.log(JSON.stringify({variants:data.length,comparisons},null,2));
}finally{await browser.close();}

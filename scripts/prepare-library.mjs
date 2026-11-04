import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Source files are unmodified Figma “Copy as SVG” exports of the two library sections.
// Recover whole, spatially separated objects; copy original SVG nodes without rewriting paths.
const families=[
 ['book','Книга',['чтение','знания','обучение','образование','исследование'],[170,640],[220,800]],
 ['phone','Телефон',['связь','общение','коммуникация','контакт','цифровой'],[410,650],[490,790]],
 ['puzzle','Пазлы',['команда','сотрудничество','вместе','партнерство','решение'],[565,650],[675,800]],
 ['coin','Монета',['деньги','финансы','оплата','инвестиции','бюджет'],[707,653],[830,805]],
 ['headphones','Наушники',['музыка','общение','слушать','поддержка','коммуникация'],[165,840],[180,1020]],
 ['lamp','Лампа',['идея','идеи','вдохновение','творчество','решение','свет'],[390,850],[450,1000]],
 ['flowers','Цветы',['рост','забота','развитие','благодарность','вдохновение'],[570,870],[665,1020]],
 ['wallet','Кошелёк',['деньги','финансы','сбережения','бюджет','капитал'],[700,910],[830,1060]],
 ['folder','Папка',['документы','порядок','работа','организация','управление'],[155,1080],[200,1250]],
 ['pen','Ручка',['письмо','творчество','идея','план','договор'],[390,1080],[410,1260]],
];
const browser=await chromium.launch({channel:'chrome',headless:true});
const variants=[];
try{
 for(const detail of ['S','L']){
  const source=await readFile(`source-library/source-${detail}.svg`,'utf8');
  const page=await browser.newPage();await page.setContent(source);
  const extracted=await page.evaluate(({detail,families})=>{
   const root=document.querySelector('svg'),W=root.viewBox.baseVal.width,H=root.viewBox.baseVal.height;
   const inverse=root.getCTM().inverse();
   const raw=[...root.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')].filter(n=>!n.closest('defs,clipPath,mask')).map(n=>{
    const b=n.getBBox(),t=inverse.multiply(n.getCTM());
    const points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(t));
    const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
    return{n,b:{x,y,w:Math.max(...points.map(p=>p.x))-x,h:Math.max(...points.map(p=>p.y))-y}};
   }).filter(({b})=>b.w*b.h<W*H*.45&&b.w>0&&b.h>0);
   raw.forEach((item,index)=>item.index=index);
   const parent=raw.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
   const touch=(a,b)=>a.x<=b.x+b.w+15&&b.x<=a.x+a.w+15&&a.y<=b.y+b.h+15&&b.y<=a.y+a.h+15;
   for(let i=0;i<raw.length;i++)for(let j=0;j<i;j++)if(touch(raw[i].b,raw[j].b))parent[find(i)]=find(j);
   const clusters=new Map();for(let i=0;i<raw.length;i++){const id=find(i);if(!clusters.has(id))clusters.set(id,[]);clusters.get(id).push(raw[i]);}
   // Figma serializes each original object's paths consecutively. If bounding
   // rectangles of two separate objects touch, their disjoint source runs split them.
   const runs=[];for(const items of clusters.values()){let run=[];for(const item of items){if(run.length&&item.index!==run.at(-1).index+1){runs.push(run);run=[];}run.push(item);}if(run.length)runs.push(run);}
   const bounds=items=>{const x=Math.min(...items.map(i=>i.b.x)),y=Math.min(...items.map(i=>i.b.y)),right=Math.max(...items.map(i=>i.b.x+i.b.w)),bottom=Math.max(...items.map(i=>i.b.y+i.b.h));return{items,x,y,w:right-x,h:bottom-y};};
   const groups=runs.map(bounds);
   // Coin faces/shadows may be emitted in separate runs with nearly coincident
   // bounds. Rejoin those, while keeping touching book/lamp bounds separate.
   for(let i=0;i<groups.length;i++)for(let j=groups.length-1;j>i;j--){const a=groups[i],b=groups[j],intersection=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));if(intersection/(a.w*a.h+b.w*b.h-intersection)>.5){groups[i]=bounds([...a.items,...b.items].sort((a,b)=>a.index-b.index));groups.splice(j,1);}}
   const bands=detail==='S'?{main:[1900,4200],background:[5100,7300]}:{main:[3400,6700],background:[7400,10800]};
   const used=new Set(),result=[];
   for(const [state,band]of Object.entries(bands)){
    const candidates=groups.filter(g=>g.w>100&&g.h>30&&g.y+g.h/2>band[0]&&g.y+g.h/2<band[1]);
    if(candidates.length!==10)throw Error(`${detail}/${state}: expected 10 whole objects, got ${candidates.length}; ${JSON.stringify(candidates.map(({x,y,w,h})=>({x,y,w,h})))}`);
    for(const [family,name,tags,s,l]of families){
     const seed=(detail==='S'?s:l),baseY=seed[1]+(state==='background'?(detail==='S'?850:815):0);
     const sorted=[...candidates].sort((a,b)=>Math.hypot((a.x+a.w/2)*960/W-seed[0],(a.y+a.h/2)*960/W-baseY)-Math.hypot((b.x+b.w/2)*960/W-seed[0],(b.y+b.h/2)*960/W-baseY));
     const selected=sorted[0];if(used.has(selected))throw Error(`Ambiguous source family ${family}`);used.add(selected);
     // Retain detached details inside the original object's serialization span
     // (the supplied coin, for example, contains a tiny isolated lower stroke).
     const first=Math.min(...selected.items.map(i=>i.index)),last=Math.max(...selected.items.map(i=>i.index));
     const items=raw.slice(first,last+1),g=bounds(items);
     if(g.w>selected.w*1.5||g.h>selected.h*1.5)throw Error(`Source span crosses another object: ${family}/${detail}/${state}`);
     const padding=3,svg=document.createElementNS(root.namespaceURI,'svg');
     svg.setAttribute('xmlns',root.namespaceURI);svg.setAttribute('width',String(g.w+padding*2));svg.setAttribute('height',String(g.h+padding*2));svg.setAttribute('viewBox',`${g.x-padding} ${g.y-padding} ${g.w+padding*2} ${g.h+padding*2}`);svg.setAttribute('fill','none');
     for(const defs of root.querySelectorAll(':scope > defs'))svg.append(defs.cloneNode(true));
     for(const {n}of g.items){let copy=n.cloneNode(true),p=n.parentElement;while(p&&p!==root){const wrapper=p.cloneNode(false);wrapper.append(copy);copy=wrapper;p=p.parentElement;}svg.append(copy);}
     const paints=[...new Set([...svg.querySelectorAll('*')].filter(n=>!n.closest('defs,clipPath,mask')).flatMap(n=>['fill','stroke'].map(k=>n.getAttribute(k))).filter(Boolean))];
     result.push({family,name,tags,detail,state,width:g.w+padding*2,height:g.h+padding*2,svg:new XMLSerializer().serializeToString(svg),sourceShapeCount:g.items.length,paints,sourceBounds:{x:g.x,y:g.y,width:g.w,height:g.h}});
    }
   }
   return result;
  },{detail,families});
  for(const item of extracted){item.sourceSectionId=detail==='S'?'21:25859':'21:25788';item.sourceFileKey='4MCFttsSoP7hgQh29zq5G3';item.sourceHash=createHash('sha256').update(source).digest('hex');variants.push(item);}
  await page.close();
 }
 await mkdir('library/assets',{recursive:true});
 await writeFile('library/bundle.json',JSON.stringify({version:2,variants}));
 for(const v of variants){const file=`${v.family}-${v.detail}-${v.state}.svg`;await writeFile(`library/assets/${file}`,v.svg);v.file=`assets/${file}`;v.hash=createHash('sha256').update(v.svg).digest('hex');delete v.svg;}
 await writeFile('library/manifest.json',JSON.stringify({version:2,source:'Figma / Библиотека компонентов / Размер S и Размер L',variants},null,2));
 console.log(`Prepared ${variants.length} source variants: 10 families × S/L × main/background. Original SVG geometry copied without rewriting.`);
}finally{await browser.close();}

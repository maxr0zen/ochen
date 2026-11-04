import type {Asset,Placement,Settings} from './core.ts';

type Item={a:Asset;i:number;x:number;y:number;w:number;h:number};
/** Arrange whole subjects in source units, then fit the entire still life once. */
export function composeStage(expanded:Asset[],cfg:Settings):Placement[]{
 const items:Item[]=expanded.map((a,i)=>({a,i,x:0,y:0,w:a.width,h:a.height}));
 const one=(family:string)=>items.filter(p=>p.a.familyId===family);
 const book=one('book'),lamp=one('lamp'),coins=one('coin'),flowers=one('flowers'),pen=one('pen'),puzzle=one('puzzle'),phone=one('phone'),headphones=one('headphones');
 let staged=false;
 if(cfg.layout==='focus'&&book.length===1&&lamp.length===1&&book.length+lamp.length+coins.length===items.length){
  const b=book[0],l=lamp[0];b.x=-b.w*.18;b.y=l.h*.22;l.x=b.w*.52;l.y=-l.h*.28;
  coins.forEach((c,i)=>{c.x=b.x+b.w*.40+(i%3)*c.w*.9;c.y=b.y+b.h*.29+Math.floor(i/3)*c.h*.9-(i%3)*c.h*.18;});
  staged=true;
 }else if(cfg.layout==='focus'&&lamp.length===1&&flowers.length===1&&pen.length===1&&puzzle.length===1&&items.length===4){
  const l=lamp[0],f=flowers[0],p=pen[0],z=puzzle[0];
  l.x=-l.w*.45;l.y=-l.h*.05;f.x=l.w*.46;f.y=-l.h*.28;p.x=l.w*.14;p.y=l.h*.46;z.x=l.w*.48;z.y=l.h*.32;
  staged=true;
 }else if(cfg.layout==='diagonal'&&book.length===1&&phone.length===1&&headphones.length===1&&items.length===3){
  const b=book[0],p=phone[0],h=headphones[0];
  if(b.a.appearance==='background'){b.x=0;b.y=b.h*.24;h.x=-b.w*.15;h.y=-b.h*.14;p.x=b.w*.32;p.y=-b.h*.70;}
  else{b.x=b.w*.12;b.y=b.h*.18;h.x=-b.w*.24;h.y=-b.h*.62;p.x=b.w*.22;p.y=-b.h*1.02;}
  staged=true;
 }
 if(!staged){
  const ordered=[...items].sort((a,b)=>b.w*b.h-a.w*a.h),gap=Math.max(...items.map(p=>Math.max(p.w,p.h)))*.035;
  let best:Item[]=[];let bestScale=-1;
  // Size-aware shelves: small props occupy their actual footprint, never a full cell.
  for(let columns=1;columns<=items.length;columns++){
   const rows:Item[][]=[];for(let i=0;i<ordered.length;i+=columns)rows.push(ordered.slice(i,i+columns));
   const widths=rows.map(r=>r.reduce((sum,p)=>sum+p.w,0)+gap*(r.length-1)),height=rows.reduce((sum,r)=>sum+Math.max(...r.map(p=>p.h)),0)+gap*(rows.length-1);
   const width=Math.max(...widths),result:Item[]=[];let y=0;
   for(const [r,row]of rows.entries()){const rh=Math.max(...row.map(p=>p.h));let x=(width-widths[r])/2+(cfg.layout==='diagonal'?(r%2?1:-1)*width*.07:0);
    for(const p of row){result.push({...p,x:x+p.w/2,y:y+rh-p.h/2});x+=p.w+gap;}y+=rh+gap;
   }
   const box=bounds(result),scale=Math.min(cfg.width/box.w,cfg.height/box.h);
   if(scale>bestScale){bestScale=scale;best=result;}
  }
  for(const p of items){const placed=best.find(other=>other.i===p.i)!;p.x=placed.x;p.y=placed.y;}
 }
 // Alternate arrangements move subjects; their paths and orientation are unchanged.
 if(cfg.seed%2!==0)for(const p of items)p.x=-p.x;
 const box=bounds(items),inset=Math.min(cfg.width,cfg.height)*.085;
 const scale=Math.min((cfg.width-inset*2)/box.w,(cfg.height-inset*2)/box.h)*.98;
 const largest=Math.max(...items.map(p=>p.w*p.h));
 const order=[...items].sort((a,b)=>Number(b.a.appearance==='background')-Number(a.a.appearance==='background')||Number(a.w*a.h<largest*.12)-Number(b.w*b.h<largest*.12)||(a.y+a.h/2)-(b.y+b.h/2));
 return items.map(p=>({assetId:p.a.id,instanceId:`${cfg.seed}-${p.i}-${p.a.id}`,cx:cfg.width/2+(p.x-box.x)*scale,cy:cfg.height/2+(p.y-box.y)*scale,scale,rotation:0,z:order.indexOf(p)}));
}
function bounds(items:Item[]){const left=Math.min(...items.map(p=>p.x-p.w/2)),right=Math.max(...items.map(p=>p.x+p.w/2)),top=Math.min(...items.map(p=>p.y-p.h/2)),bottom=Math.max(...items.map(p=>p.y+p.h/2));return{x:(left+right)/2,y:(top+bottom)/2,w:right-left,h:bottom-top};}

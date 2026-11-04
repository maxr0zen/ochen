import type {Asset,Placement,Settings} from './core.ts';

type Point={x:number;y:number};
type Node={p:Placement;a:Asset;x:number;y:number};
export type SceneRelation={kind:'illuminates'|'coins'|'writing'|'audio';sourceId:string;targetId?:string;ok:boolean;message:string;angle?:number};
/** Hand-calibrated anchors in the existing S/L drawings; no paths are generated. */
export const SCENE_RULES={
 lamp:{emitter:{x:.81,y:.29},direction:{x:.84,y:.54},halfAngle:20,maxDistance:2,targets:['book','puzzle','folder','pen','wallet','coin','phone','headphones','flowers']},
 pen:{tip:{x:.95,y:.87},targets:['book','folder','puzzle']},
 coins:{targets:['wallet','book']},
 audio:{gapX:.72,gapY:.50}
} as const;
const surface:Record<string,Point>={book:{x:.55,y:.40},puzzle:{x:.5,y:.44},folder:{x:.55,y:.40},pen:{x:.6,y:.5},wallet:{x:.5,y:.45},coin:{x:.45,y:.45},phone:{x:.5,y:.4},headphones:{x:.5,y:.5},flowers:{x:.5,y:.45}};
function rotate(point:Point,degrees:number):Point{const r=degrees*Math.PI/180;return{x:point.x*Math.cos(r)-point.y*Math.sin(r),y:point.x*Math.sin(r)+point.y*Math.cos(r)};}
function offset(n:Node,anchor:Point){return rotate({x:(anchor.x-.5)*n.a.width,y:(anchor.y-.5)*n.a.height},n.p.rotation);}
function anchor(n:Node,at:Point){const d=offset(n,at);return{x:n.x+d.x,y:n.y+d.y};}
function sorted(nodes:Node[]){return [...nodes].sort((a,b)=>a.p.instanceId.localeCompare(b.p.instanceId));}
function targets(nodes:Node[],families:readonly string[]){return nodes.filter(n=>families.includes(n.a.familyId??'')).sort((a,b)=>families.indexOf(a.a.familyId!)-families.indexOf(b.a.familyId!)||a.p.instanceId.localeCompare(b.p.instanceId));}
function holdersFor(nodes:Node[]){const candidates=targets(nodes,SCENE_RULES.coins.targets);return candidates.filter(n=>n.a.familyId===candidates[0]?.a.familyId);}
function nodesFor(placements:Placement[],assets:Asset[],sourceUnits=false):Node[]{return placements.map(p=>{const a=assets.find(a=>a.id===p.assetId)!;return{p:{...p},a,x:sourceUnits?p.cx/p.scale:p.cx,y:sourceUnits?p.cy/p.scale:p.cy};});}
const family=(nodes:Node[],name:string)=>sorted(nodes.filter(n=>n.a.familyId===name));

/** Solve object relationships before fitting the entire group with one uniform scale. */
export function applySceneRules(placements:Placement[],assets:Asset[],cfg:Settings):Placement[]{
 const nodes=nodesFor(placements,assets,true);let changed=false;
 let hash=Math.imul(cfg.seed^0x9e3779b9,0x85ebca6b);hash^=hash>>>13;hash=Math.imul(hash,0xc2b2ae35);hash^=hash>>>16;const variation=(hash>>>0)/4294967296;
 const pens=family(nodes,'pen'),paper=targets(nodes,SCENE_RULES.pen.targets);
 for(const [i,pen]of pens.entries())if(paper.length){const base=paper[i%paper.length],at={x:.72-(i%2)*.18,y:.38+Math.floor(i/2)*.10},point=anchor(base,at),tip=offset(pen,SCENE_RULES.pen.tip);pen.x=point.x-tip.x;pen.y=point.y-tip.y;changed=true;}
 const phones=family(nodes,'phone'),headphones=family(nodes,'headphones');
 for(const [i,phone]of phones.entries())if(headphones.length){const h=headphones[i%headphones.length];phone.x=h.x+h.a.width*SCENE_RULES.audio.gapX+phone.a.width*.10;phone.y=h.y-h.a.height*SCENE_RULES.audio.gapY-i*phone.a.height*.55;changed=true;}
 const coins=family(nodes,'coin'),holders=holdersFor(nodes);
 if(coins.length&&(holders.length||coins.length>1)){
  const center={x:coins.reduce((s,n)=>s+n.x,0)/coins.length,y:coins.reduce((s,n)=>s+n.y,0)/coins.length};
  for(const [i,coin]of coins.entries()){const base=holders[i%holders.length],index=holders.length?Math.floor(i/holders.length):i,origin=base?{x:base.x+base.a.width*.40,y:base.y+base.a.height*.32}:center;coin.x=origin.x+(index%3)*coin.a.width*.94;coin.y=origin.y+Math.floor(index/3)*coin.a.height*.88-(index%3)*coin.a.height*.15;}changed=true;
 }
 const lamps=family(nodes,'lamp'),lit=targets(nodes,SCENE_RULES.lamp.targets);
 for(const [i,lamp]of lamps.entries())if(lit.length){const target=lit[i%lit.length],point=anchor(target,surface[target.a.familyId!]??{x:.5,y:.5}),emitter=offset(lamp,SCENE_RULES.lamp.emitter),d=rotate(SCENE_RULES.lamp.direction,lamp.p.rotation),length=Math.hypot(d.x,d.y),distance=lamp.a.height*(.68+variation*.18+Math.floor(i/lit.length)*.88)+target.a.height*.12;
  lamp.x=point.x-d.x/length*distance-emitter.x;lamp.y=point.y-d.y/length*distance-emitter.y;changed=true;
 }
 if(!changed)return placements;
 const rank=(n:Node)=>n.a.familyId==='lamp'?0:['book','folder','puzzle'].includes(n.a.familyId??'')?1:['pen','coin'].includes(n.a.familyId??'')?3:2;
 const order=[...nodes].sort((a,b)=>Number(b.a.appearance==='background')-Number(a.a.appearance==='background')||rank(a)-rank(b)||(a.y+a.a.height/2)-(b.y+b.a.height/2)||a.p.instanceId.localeCompare(b.p.instanceId));
 const rectangles=nodes.map(n=>{const r=n.p.rotation*Math.PI/180;return{n,w:Math.abs(Math.cos(r))*n.a.width+Math.abs(Math.sin(r))*n.a.height,h:Math.abs(Math.sin(r))*n.a.width+Math.abs(Math.cos(r))*n.a.height};});
 const left=Math.min(...rectangles.map(r=>r.n.x-r.w/2)),right=Math.max(...rectangles.map(r=>r.n.x+r.w/2)),top=Math.min(...rectangles.map(r=>r.n.y-r.h/2)),bottom=Math.max(...rectangles.map(r=>r.n.y+r.h/2)),margin=Math.min(cfg.width,cfg.height)*.085;
 const scale=Math.min((cfg.width-2*margin)/(right-left),(cfg.height-2*margin)/(bottom-top))*.98;
 return nodes.map(n=>({...n.p,cx:cfg.width/2+(n.x-(left+right)/2)*scale,cy:cfg.height/2+(n.y-(top+bottom)/2)*scale,scale,z:order.indexOf(n)}));
}

/** Independent diagnostics, also usable on manually edited placement data. */
export function inspectSceneRules(placements:Placement[],assets:Asset[]):SceneRelation[]{
 const nodes=nodesFor(placements,assets),result:SceneRelation[]=[];
 // Diagnostics use each object's actual scale, not the source-unit solver's values.
 for(const n of nodes){n.a={...n.a,width:n.a.width*n.p.scale,height:n.a.height*n.p.scale};}
 const lamps=family(nodes,'lamp'),lit=targets(nodes,SCENE_RULES.lamp.targets);
 for(const [i,lamp]of lamps.entries()){
  const target=lit[i%lit.length];if(!target){result.push({kind:'illuminates',sourceId:lamp.p.instanceId,ok:false,message:'У лампы нет цели. Добавьте книгу, пазлы или другой предмет; новые объекты автоматически не добавляются.'});continue;}
  const from=anchor(lamp,SCENE_RULES.lamp.emitter),to=anchor(target,surface[target.a.familyId!]??{x:.5,y:.5}),d=rotate(SCENE_RULES.lamp.direction,lamp.p.rotation),v={x:to.x-from.x,y:to.y-from.y},distance=Math.hypot(v.x,v.y),cos=distance>0?(d.x*v.x+d.y*v.y)/Math.hypot(d.x,d.y)/distance:-1,angle=Math.acos(Math.max(-1,Math.min(1,cos)))*180/Math.PI,ok=angle<=SCENE_RULES.lamp.halfAngle&&distance>lamp.a.height*.2;
  const reachable=ok&&distance<=lamp.a.height*(SCENE_RULES.lamp.maxDistance+Math.floor(i/lit.length)*.88);
  result.push({kind:'illuminates',sourceId:lamp.p.instanceId,targetId:target.p.instanceId,ok:reachable,angle,message:reachable?`Лампа → ${target.a.name}: цель находится перед плафоном, в направлении света.`:`Лампа → ${target.a.name}: предмет слишком далеко или вне направления света.`});
 }
 const coins=family(nodes,'coin'),holders=holdersFor(nodes);
 if(coins.length&&holders.length){for(const [i,c]of coins.entries()){const base=holders[i%holders.length],ok=Math.hypot(c.x-base.x,c.y-base.y)<Math.max(base.a.width,base.a.height)*1.5+c.a.width*.8;result.push({kind:'coins',sourceId:c.p.instanceId,targetId:base.p.instanceId,ok,message:ok?`Монеты → ${base.a.name}: сгруппированы рядом с предметом.`:`Монеты → ${base.a.name}: группа слишком далеко от предмета.`});}}
 else if(coins.length>1){const connected=new Set([coins[0]]);for(let pass=0;pass<coins.length;pass++)for(const c of coins)if([...connected].some(n=>Math.hypot(n.x-c.x,n.y-c.y)<=Math.max(n.a.width,c.a.width)*1.8))connected.add(c);const ok=connected.size===coins.length;result.push({kind:'coins',sourceId:coins[0].p.instanceId,targetId:coins[1].p.instanceId,ok,message:ok?'Монеты собраны в компактную группу.':'Монеты разнесены на отдельные группы.'});}
 const paper=targets(nodes,SCENE_RULES.pen.targets);for(const [i,pen]of family(nodes,'pen').entries())if(paper.length){const base=paper[i%paper.length],tip=anchor(pen,SCENE_RULES.pen.tip),ok=Math.hypot(tip.x-base.x,tip.y-base.y)<Math.max(base.a.width,base.a.height)*.65;result.push({kind:'writing',sourceId:pen.p.instanceId,targetId:base.p.instanceId,ok,message:ok?`Ручка → ${base.a.name}: наконечник направлен на рабочую поверхность.`:`Ручка → ${base.a.name}: наконечник вне рабочей поверхности.`});}
 const headphones=family(nodes,'headphones');for(const [i,phone]of family(nodes,'phone').entries())if(headphones.length){const h=headphones[i%headphones.length],ok=Math.hypot(phone.x-h.x,phone.y-h.y)<Math.max(h.a.width,phone.a.width)*1.5;result.push({kind:'audio',sourceId:phone.p.instanceId,targetId:h.p.instanceId,ok,message:ok?'Телефон и наушники расположены как связанная пара.':'Телефон слишком далеко от наушников.'});}
 return result;
}

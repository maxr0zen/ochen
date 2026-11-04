import {UserError,object,text,settings,validateScene,rotatedBounds} from './core.ts';
import type {Asset,Choice,Palette,Scene,Settings} from './core.ts';
export type AIItem={assetId:string;x:number;y:number;rotation:number;z:number};
export type AIPlan={summary:string;items:AIItem[]};
export function aiSchema(ids:string[]){return{type:'object',additionalProperties:false,required:['summary','items'],properties:{summary:{type:'string'},items:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,required:['assetId','x','y','rotation','z'],properties:{assetId:{type:'string',enum:ids},x:{type:'number'},y:{type:'number'},rotation:{type:'number'},z:{type:'integer'}}}}}};}
export function aiScene(raw:unknown,assets:Asset[],config:Settings,query:string,p:Palette,required:Choice[]=[]):{plan:AIPlan;scene:Scene}{
 const cfg=settings(config),value=object(raw),summary=text(value.summary,500);
 if(Object.keys(value).some(k=>!['summary','items'].includes(k)))throw new UserError('AI вернула неподдерживаемые параметры плана.');
 if(!summary||!Array.isArray(value.items)||value.items.length<1||value.items.length>12)throw new UserError('AI вернула пустой или слишком большой план.');
 const number=(v:unknown,min:number,max:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new UserError('AI вернула недопустимые координаты или поворот.');return v;};
 const items=value.items.map((item):AIItem=>{const v=object(item);if(Object.keys(v).some(k=>!['assetId','x','y','rotation','z'].includes(k)))throw new UserError('AI попыталась изменить параметры исходного объекта.');const id=text(v.assetId,120),a=assets.find(a=>a.id===id);
  if(!a||a.detail!==cfg.detail)throw new UserError('AI выбрала неизвестный объект или другую детализацию.');
  if(cfg.appearanceMode!=='mixed'&&a.appearance!==cfg.appearanceMode)throw new UserError('AI нарушила выбранные состояния объектов.');
  const z=number(v.z,0,11);if(!Number.isInteger(z))throw new UserError('AI вернула некорректный порядок слоёв.');
  return{assetId:id,x:number(v.x,-2,2),y:number(v.y,-2,2),rotation:number(v.rotation,-12,12),z};
 });
 if(new Set(items.map(i=>i.z)).size!==items.length)throw new UserError('AI повторила номера слоёв.');
 const counts=new Map<string,number>();for(const i of items)counts.set(i.assetId,(counts.get(i.assetId)??0)+1);
 if(required.length){const expected=new Map<string,number>();for(const c of required)expected.set(c.assetId,(expected.get(c.assetId)??0)+c.count);if(expected.size!==counts.size||[...expected].some(([id,n])=>counts.get(id)!==n))throw new UserError('AI изменила запрошенный состав или количество компонентов.');}
 if(cfg.appearanceMode==='mixed'&&items.length>1&&new Set(items.map(i=>assets.find(a=>a.id===i.assetId)!.appearance)).size<2)throw new UserError('AI не включила главные и фоновые объекты в смешанный режим.');
 const unit=Math.max(...items.map(i=>assets.find(a=>a.id===i.assetId)!.width));
 const rects=items.map(i=>{const a=assets.find(a=>a.id===i.assetId)!,b=rotatedBounds(a.width,a.height,i.rotation);return{i,a,x:i.x*unit,y:i.y*unit,w:b.width,h:b.height};});
 for(const back of rects)for(const front of rects){if(front.i.z<=back.i.z)continue;if(back.a.appearance==='main'&&front.a.appearance==='background')throw new UserError('AI поместила фоновый предмет перед главным.');
  const overlap=Math.max(0,Math.min(back.x+back.w/2,front.x+front.w/2)-Math.max(back.x-back.w/2,front.x-front.w/2))*Math.max(0,Math.min(back.y+back.h/2,front.y+front.h/2)-Math.max(back.y-back.h/2,front.y-front.h/2));
  if(overlap/(back.w*back.h)>(back.a.appearance==='background'?.92:.82))throw new UserError(`AI почти полностью перекрыла предмет «${back.a.name}». Разведите предметы.`);
 }
 const left=Math.min(...rects.map(r=>r.x-r.w/2)),right=Math.max(...rects.map(r=>r.x+r.w/2)),top=Math.min(...rects.map(r=>r.y-r.h/2)),bottom=Math.max(...rects.map(r=>r.y+r.h/2)),margin=Math.min(cfg.width,cfg.height)*.085;
 const scale=Math.min((cfg.width-2*margin)/(right-left),(cfg.height-2*margin)/(bottom-top));
 if(rects.some(r=>Math.min(r.a.width,r.a.height)*scale<8))throw new UserError('AI слишком далеко разнесла предметы: они станут слишком мелкими.');
 const placements=rects.map((r,i)=>({assetId:r.i.assetId,instanceId:`ai-${cfg.seed}-${i}`,cx:cfg.width/2+(r.x-(left+right)/2)*scale,cy:cfg.height/2+(r.y-(top+bottom)/2)*scale,rotation:r.i.rotation,scale,z:r.i.z}));
 const choices=[...counts].map(([assetId,count])=>({assetId,count,reason:summary}));
 return{plan:{summary,items},scene:validateScene({version:1,settings:cfg,query,choices,placements,palette:p},assets)};
}

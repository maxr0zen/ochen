import {aiScene} from './ai-plan.ts';import type {AIPlan} from './ai-plan.ts';
import {direct,eligibleAssets,resolveVariants} from './core.ts';import type {Asset,Palette,Settings} from './core.ts';
import {sceneSvg} from './scene-svg.ts';
type Input={assets:Asset[];settings:Settings;query:string;mode:string;palette:Palette};
export function initAI(read:()=>Input,send:(data:Record<string,unknown>)=>void,status:(message:string,kind?:string)=>void,busy:(value:boolean)=>void){
 const $=(id:string)=>document.getElementById(id)!;const input=(id:string)=>$(id)as HTMLInputElement;
 let configured=false,vision=false,pending:{data:Input;settings:Settings;plan:AIPlan;svg:string}|null=null,controller:AbortController|null=null;
 const signature=(data:Input)=>JSON.stringify([data.query,data.mode,data.settings,data.palette]);
 async function request(path:string,body?:unknown){const token=input('ai-token').value.trim();if(token.length<24)throw new Error('Вставьте код AI_CONNECTION_TOKEN из .env.local.');
  const response=await fetch(`http://localhost:4174${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller?AbortSignal.any([controller.signal,AbortSignal.timeout(70000)]):AbortSignal.timeout(70000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error??'Ошибка подключения к AI-серверу.');return result;
 }
 const image=async(svg:string)=>{const node=new Image();node.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await node.decode();return node;};
 async function png(svg:string){const node=await image(svg),canvas=document.createElement('canvas'),ratio=Math.min(1,900/Math.max(node.naturalWidth,node.naturalHeight));canvas.width=Math.max(1,Math.round(node.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(node.naturalHeight*ratio));const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(node,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');}
 async function catalogue(data:Input){const required=data.mode==='components'?resolveVariants(direct(data.query,eligibleAssets(data.assets,data.settings)),data.assets,data.settings):[];
  const list=data.assets.filter(a=>a.detail===data.settings.detail&&(data.settings.appearanceMode==='mixed'||a.appearance===data.settings.appearanceMode||required.some(c=>c.assetId===a.id))),canvas=document.createElement('canvas');canvas.width=1100;canvas.height=Math.ceil(list.length/5)*190;const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(const [i,a]of list.entries()){if(!a.thumbnail)continue;const node=await image(a.thumbnail),scale=Math.min(190/node.naturalWidth,140/node.naturalHeight),x=(i%5)*220,y=Math.floor(i/5)*190;ctx.drawImage(node,x+(220-node.naturalWidth*scale)/2,y+5,node.naturalWidth*scale,node.naturalHeight*scale);ctx.fillStyle='#202a25';ctx.font='13px sans-serif';ctx.fillText(a.id,x+6,y+160);ctx.fillText(`${Math.round(a.width)} × ${Math.round(a.height)}`,x+6,y+178);}
  return canvas.toDataURL('image/png');
 }
 const run=(fn:()=>Promise<void>)=>{void(async()=>{controller=new AbortController();busy(true);($('ai-cancel')as HTMLButtonElement).disabled=false;try{await fn();}catch(error){status(error instanceof DOMException&&error.name==='AbortError'?'AI-запрос отменён.':error instanceof TypeError?'Локальный AI-сервер недоступен. Запустите npm run ai.':error instanceof Error?error.message:'Ошибка AI-планирования.','error');}finally{controller=null;busy(false);($('ai-cancel')as HTMLButtonElement).disabled=true;}})();};
 $('ai-connect').onclick=()=>run(async()=>{const result=await request('/health');configured=result.configured;vision=result.vision;input('ai-images').disabled=!vision;if(!vision)input('ai-images').checked=false;$('ai-connection').textContent=`${result.provider} · ${result.model} · ${configured?'ключ указан, API ещё не проверен':'ключ не указан'}`;send({type:'ai-config',token:input('ai-token').value.trim()});status(configured?'Сервер подключён. Можно запросить AI-план.':'Сервер подключён. Добавьте API-ключ в .env.local, перезапустите сервер и проверьте подключение снова.');});
 async function generate(refine=false){
  if(!configured)throw new Error('Сначала подключите локальный сервер с указанным API-ключом.');
  if(refine&&pending&&signature(read())!==signature(pending.data))throw new Error('Параметры изменились. Запросите новый AI-план.');
  const data=refine&&pending?pending.data:read();if(!data.query.trim())throw new Error('Введите метафору или названия компонентов.');
  if(!refine){pending=null;$('ai-result').hidden=true;}
  const images:string[]=[];if(vision&&input('ai-images').checked){images.push(await catalogue(data));if(refine&&pending)images.push(await png(pending.svg));}
  status('AI предлагает расположение предметов…');
  const result=await request('/plan',{query:data.query,mode:data.mode,settings:data.settings,palette:data.palette,catalog:data.assets.map(a=>({id:a.id,name:a.name,tags:a.tags,synonyms:a.synonyms,metaphors:a.metaphors})),images,...(refine&&pending?{previousPlan:pending.plan,feedback:input('ai-feedback').value}:{})});
  const required=data.mode==='components'?resolveVariants(direct(data.query,eligibleAssets(data.assets,data.settings)),data.assets,data.settings):[];
  const checked=aiScene(result.plan,data.assets,result.settings,data.query,data.palette,required),svg=sceneSvg(checked.scene,data.assets);pending={data,settings:checked.scene.settings,plan:checked.plan,svg};
  ($('ai-preview')as HTMLImageElement).src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);$('ai-summary').textContent=checked.plan.summary;$('ai-result').hidden=false;($('ai-apply')as HTMLButtonElement).disabled=false;($('ai-refine')as HTMLButtonElement).disabled=false;
  status('AI-план проверен. Посмотрите предпросмотр и добавьте сцену в Figma.','success');
 }
 $('ai-generate').onclick=()=>run(()=>generate());$('ai-refine').onclick=()=>run(()=>generate(true));
 $('ai-cancel').onclick=()=>controller?.abort();
 $('ai-apply').onclick=()=>{if(pending){if(signature(read())!==signature(pending.data)){status('Параметры изменились. Запросите новый AI-план.','error');return;}send({type:'apply-ai-scene',plan:pending.plan,settings:pending.settings,requestSettings:pending.data.settings,mode:pending.data.mode,query:pending.data.query,palette:pending.data.palette});}};
 return{restore:(token:string)=>{input('ai-token').value=token;},controls:(disabled:boolean,hasAssets:boolean)=>{for(const id of ['ai-connect','ai-generate','ai-refine','ai-apply'])($(id)as HTMLButtonElement).disabled=disabled||(id==='ai-generate'&&!hasAssets)||((id==='ai-refine'||id==='ai-apply')&&!pending);}};
}

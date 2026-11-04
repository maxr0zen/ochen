import {composeStage} from './composition.ts';
import {applySceneRules} from './scene-rules.ts';
export type Role = 'hero' | 'support' | 'detail';
export type Detail = 'S' | 'L';
export type Appearance = 'main' | 'background';
export type Asset = {
  id: string; nodeId: string; name: string; synonyms: string[]; tags: string[]; metaphors: string[];
  role: Role; width: number; height: number;
  familyId?:string;detail?:Detail;appearance?:Appearance;
  source: { illustrationId: string; illustrationName: string; nodeId: string; capturedAt: string };
  thumbnail?: string;
};
export type Palette = { name: string; colors: string[]; map?: Record<string, string>; background?: string; backgroundColors?:string[];objectColors?:string[] };
export type LayoutKind = 'focus' | 'diagonal' | 'balanced';
export type Settings = { width: number; height: number; seed: number; layout: LayoutKind;detail?:Detail;appearanceMode?:'main'|'mixed'|'background';backdrop?:'none'|'source'|'solid' };
export type Choice = { assetId: string; count: number; reason: string;appearance?:Appearance };
export type Placement = { assetId: string; instanceId: string; cx: number; cy: number; scale: number; rotation: number; z: number };
export type Scene = { version: 1; settings: Settings; query: string; choices: Choice[]; placements: Placement[]; palette: Palette | null };
export class UserError extends Error {}
export const normalize = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UserError('Ожидался JSON-объект.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) throw new UserError(`Ожидался текст до ${max} символов.`);
  return value.trim();
}
export function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new UserError(`Число должно быть от ${min} до ${max}.`);
  return value;
}
export function settings(value: unknown): Settings {
  const v = object(value);
  if (!['focus','diagonal','balanced'].includes(String(v.layout))) throw new UserError('Неизвестная схема композиции.');
  if(v.detail!==undefined&&!['S','L'].includes(String(v.detail)))throw new UserError('Детализация должна быть S или L.');
  if(v.appearanceMode!==undefined&&!['main','mixed','background'].includes(String(v.appearanceMode)))throw new UserError('Неизвестный режим фоновых объектов.');
  if(v.backdrop!==undefined&&!['none','source','solid'].includes(String(v.backdrop)))throw new UserError('Неизвестный режим фона холста.');
  return { width: number(v.width, 128, 8192), height: number(v.height, 128, 8192), seed: Math.trunc(number(v.seed, 0, 2147483647)), layout: v.layout as LayoutKind,detail:(v.detail??'S') as Detail,appearanceMode:(v.appearanceMode??'main') as Settings['appearanceMode'],backdrop:(v.backdrop??'none') as Settings['backdrop'] };
}
export function hex(value: unknown): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) throw new UserError('Цвет должен иметь формат #RRGGBB.');
  return value.toUpperCase();
}
export function palette(value: unknown): Palette {
  const v = object(value);
  if (!Array.isArray(v.colors) || v.colors.length < 2 || v.colors.length > 12) throw new UserError('Палитра должна содержать от 2 до 12 цветов.');
  const result: Palette = { name: text(v.name || 'Своя палитра', 80), colors: v.colors.map(hex) };
  if(v.backgroundColors!==undefined||v.objectColors!==undefined){
    if(!Array.isArray(v.backgroundColors)||v.backgroundColors.length!==4||!Array.isArray(v.objectColors)||v.objectColors.length!==4)throw new UserError('Нужны четыре фоновых и четыре объектных цветовых роли.');
    result.backgroundColors=v.backgroundColors.map(hex);result.objectColors=v.objectColors.map(hex);result.colors=[...new Set([...result.backgroundColors,...result.objectColors])];
  }
  if (v.background !== undefined) result.background = hex(v.background);
  if (v.map !== undefined) {
    result.map = {};
    for (const [from,to] of Object.entries(object(v.map))) result.map[hex(from)] = hex(to);
  }
  return result;
}
export function validateChoices(value: unknown, assets: Asset[]): Choice[] {
  const v = object(value);
  if (!Array.isArray(v.choices) || !v.choices.length || v.choices.length > 12) throw new UserError('План должен содержать от 1 до 12 позиций choices.');
  let total = 0;
  const choices = v.choices.map(raw => {
    const c = object(raw), assetId = text(c.assetId, 120), count = number(c.count, 1, 12);
    if (!Number.isInteger(count)) throw new UserError('Количество должно быть целым.');
    if (!assets.some(a => a.id === assetId)) throw new UserError(`Объекта ${assetId} нет в библиотеке.`);
    total += count;
    const result:Choice={ assetId, count, reason: text(c.reason || 'Выбран из каталога', 500) };
    if(c.appearance!==undefined){if(!['main','background'].includes(String(c.appearance)))throw new UserError('Неизвестное состояние объекта.');result.appearance=c.appearance as Appearance;}
    return result;
  });
  if (total > 12) throw new UserError('Не более 12 объектов в одной композиции. Уменьшите количество.');
  return choices;
}
export function direct(query: string, assets: Asset[]): Choice[] {
  if (!query.trim()) throw new UserError('Введите названия компонентов через запятую.');
  const choices: Choice[] = [];
  for (const item of query.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)) {
    const state=item.match(/\((фон|фоновый|фоновая|главный|главная)\)/i),clean=item.replace(/\((фон|фоновый|фоновая|главный|главная)\)/ig,'').trim();
    const match = clean.match(/^(.+?)\s*[×x*]\s*(\d+)$/i);
    const name = normalize(match ? match[1] : clean), count = match ? Number(match[2]) : 1;
    const exact = assets.filter(a => [a.name, a.id, a.familyId??'', ...a.synonyms].some(s => normalize(s) === name));
    const candidates = exact.length ? exact : assets.filter(a => [a.name,...a.synonyms,...a.tags].some(s => normalize(s).includes(name)));
    if (!candidates.length) throw new UserError(`«${item}» не найдено. Доступны: ${assets.slice(0,8).map(a => a.name).join(', ') || 'библиотека пуста'}.`);
    if (candidates.length > 1) throw new UserError(`«${item}» неоднозначно: ${candidates.map(a => `${a.name} [${a.id}]`).join(', ')}. Введите точное имя или assetId.`);
    const choice:Choice={ assetId: candidates[0].id, count, reason: `Компонент: ${candidates[0].name}` };if(state)choice.appearance=/^фон/i.test(state[1])?'background':'main';choices.push(choice);
  }
  return validateChoices({ choices }, assets);
}
export function eligibleAssets(assets:Asset[],config:Settings):Asset[]{
 const cfg=settings(config),wanted=cfg.appearanceMode==='background'?'background':'main';
 return assets.filter(a=>!a.familyId||(a.detail===cfg.detail&&a.appearance===wanted));
}
export function variant(asset:Asset,assets:Asset[],detail:Detail,appearance:Appearance):Asset{
 if(!asset.familyId)return asset;
 const found=assets.find(a=>a.familyId===asset.familyId&&a.detail===detail&&a.appearance===appearance);
 if(!found)throw new UserError(`Нет варианта «${asset.name}»: ${detail}, ${appearance==='main'?'главный':'фоновый'}.`);
 return found;
}
export function resolveVariants(choices:Choice[],assets:Asset[],config:Settings,preserve=false):Choice[]{
 const cfg=settings(config),result:Choice[]=[];
 for(const [i,c]of choices.entries()){
  const original=assets.find(a=>a.id===c.assetId);if(!original)throw new UserError('Объект отсутствует в каталоге.');
  const state=c.appearance??(preserve?original.appearance:undefined)??(cfg.appearanceMode==='background'||cfg.appearanceMode==='mixed'&&i%2===1?'background':'main');
  const target=variant(original,assets,cfg.detail!,state),previous=result.find(r=>r.assetId===target.id);
  if(previous)previous.count+=c.count;else result.push({assetId:target.id,count:c.count,reason:c.reason});
 }
 return validateChoices({choices:result},assets);
}
const concepts = [
  ['рост','развит','прогресс','успех','раст','growth','лестниц','ступен','дерев','росток','ракета'],
  ['команд','сотруднич','вместе','партнер','team','человек','люди','руки','мост','пазл'],
  ['иде','творче','вдохнов','решени','idea','ламп','мозг','карандаш'],
  ['врем','срок','дедлайн','time','час','календар'],
  ['защит','безопас','надеж','security','щит','замок','зонт'],
  ['путь','цель','движ','путешеств','goal','дорог','стрел','компас','флаг'],
  ['баланс','равновес','balance','весы'],
  ['финанс','деньг','сбереж','инвест','капитал','бюджет','кошелек','монет'],
  ['связ','общени','коммуникац','контакт','телефон','наушник'],
];
const stopWords=new Set(['для','или','как','над','под','при','это','что','все','его','она','они','наш','вам','the','and','with','from','your']);
const words = (s: string) => normalize(s).split(' ').filter(w => w.length > 2&&!stopWords.has(w));
const related = (a: string,b: string) => a === b || (Math.min(a.length,b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
export function metaphor(query: string, assets: Asset[]): Choice[] {
  const q = words(query);
  if (!q.length) throw new UserError('Введите метафору или заголовок.');
  const expanded = [...q];
  for (const group of concepts) if (q.some(w => group.some(g => related(w,g)))) expanded.push(...group);
  const ranked = assets.map(asset => {
    const corpus = words([asset.name,...asset.synonyms,...asset.tags,...asset.metaphors].join(' '));
    const hits = [...new Set(expanded.filter(w => corpus.some(c => related(w,c))))];
    return { asset, hits, score: hits.length + q.filter(w => corpus.some(c => related(w,c))).length * 3 };
  }).filter(r => r.score > 0).sort((a,b) => b.score-a.score || a.asset.id.localeCompare(b.asset.id));
  if (!ranked.length) throw new UserError('В библиотеке нет подходящих объектов. Добавьте теги и метафоры в карточках или уточните запрос.');
  return ranked.slice(0,5).map(r => ({ assetId:r.asset.id, count:1, reason:`Совпадения по смысловым тегам: ${r.hits.slice(0,4).join(', ')}` }));
}
export function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525,state)+1013904223)>>>0; return state/4294967296; };
}
export function rotatedBounds(width: number,height: number,degrees: number) {
  const r = degrees*Math.PI/180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { width:width*c+height*s, height:width*s+height*c };
}
export function compose(choices: Choice[], assets: Asset[], config: Settings): Placement[] {
  const cfg = settings(config), valid = validateChoices({choices},assets), random = rng(cfg.seed);
  const expanded = valid.flatMap(c => Array.from({length:c.count},() => assets.find(a=>a.id===c.assetId)!));
  if (cfg.layout === 'focus') expanded.sort((a,b)=>Number(a.appearance==='background')-Number(b.appearance==='background')||({hero:0,support:1,detail:2}[a.role])-({hero:0,support:1,detail:2}[b.role])||b.width*b.height-a.width*a.height);
  if(cfg.layout!=='balanced')return applySceneRules(composeStage(expanded,cfg),assets,cfg);
  const n=expanded.length, margin=Math.min(cfg.width,cfg.height)*0.07;
  const innerW=cfg.width-2*margin,innerH=cfg.height-2*margin;
  const rotated=expanded.map((a,i)=>{number(a.width,.01,1000000);number(a.height,.01,1000000);const rotation=cfg.layout==='diagonal'?(i%2===0?-8:8):Math.round((random()-.5)*8);return{a,i,rotation,b:rotatedBounds(a.width,a.height,rotation)};});
  const candidates=[];
  // Choose the cell arrangement which permits the largest shared scale. No object
  // is independently resized to fill its cell; original ratios remain invariant.
  for(let columns=1;columns<=n;columns++){
    const rows=Math.ceil(n/columns);
    const slots=rotated.map(r=>{
      let x=margin+(r.i%columns)*innerW/columns,y=margin+Math.floor(r.i/columns)*innerH/rows,w=innerW/columns,h=innerH/rows;
      return{...r,x,y,w,h};
    });
    candidates.push({slots,scale:Math.min(...slots.map(s=>Math.min(s.w/s.b.width,s.h/s.b.height)))});
  }
  candidates.sort((a,b)=>b.scale-a.scale);const{slots}=candidates[0],scale=candidates[0].scale*(.80+random()*.08);
  const paintOrder=[...rotated].sort((a,b)=>Number(b.a.appearance==='background')-Number(a.a.appearance==='background')||a.i-b.i).map(r=>r.i);
  const placements=slots.map(({a,i,x,y,w,h,rotation,b})=>{
    const diagonal=cfg.layout==='diagonal';
    if (scale<0.01 || Math.min(b.width*scale,b.height*scale)<8) throw new UserError('Объекты станут слишком мелкими. Уменьшите количество или увеличьте холст.');
    return { assetId:a.id,instanceId:`${cfg.seed}-${i}-${a.id}`,cx:x+w/2,cy:y+h/2+(diagonal?(i%2===0?-1:1)*h*0.04:0),scale,rotation,z:paintOrder.indexOf(i) };
  });
  return applySceneRules(placements,assets,cfg);
}
export function colorLuminance(color: string) {
  const s=hex(color).slice(1); const rgb=[0,2,4].map(i=>parseInt(s.slice(i,i+2),16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
export function colorTable(originals: string[], p: Palette): Record<string,string> {
  const colors=[...new Set(originals.map(hex))].sort((a,b)=>colorLuminance(a)-colorLuminance(b)||a.localeCompare(b));
  const target=[...p.colors].sort((a,b)=>colorLuminance(a)-colorLuminance(b));
  return Object.fromEntries(colors.map((c,i)=>[c,p.map?.[c]??target[Math.round((colors.length===1?0.5:i/(colors.length-1))*(target.length-1))]]));
}
export function validateScene(value: unknown, assets: Asset[]): Scene {
  const v=object(value); if(v.version!==1) throw new UserError('Неподдерживаемая версия сцены.');
  const cfg=settings(v.settings),choices=validateChoices({choices:v.choices},assets);
  if(!Array.isArray(v.placements)||!v.placements.length||v.placements.length>12) throw new UserError('Некорректные экземпляры сцены.');
  const ids=new Set<string>();
  const placements=v.placements.map(raw=>{
    const p=object(raw),assetId=text(p.assetId,120),instanceId=text(p.instanceId,200);
    if(!assets.some(a=>a.id===assetId)||ids.has(instanceId))throw new UserError('Неизвестный объект или повторный instanceId.');
    ids.add(instanceId);
    return {assetId,instanceId,cx:number(p.cx,-100000,100000),cy:number(p.cy,-100000,100000),scale:number(p.scale,0.01,1000),rotation:number(p.rotation,-360,360),z:number(p.z,0,100)};
  });
  const common=placements[0].scale;
  if(placements.some(p=>Math.abs(p.scale-common)>common*.002))throw new UserError('Масштаб объектов различается. Пропорции между объектами должны сохраняться. Пересоберите сцену.');
  if(placements.some(p=>{const a=assets.find(a=>a.id===p.assetId)!;return a.detail&&a.detail!==cfg.detail;}))throw new UserError('Сцена содержит объекты другой детализации.');
  const declared=new Map<string,number>(),actual=new Map<string,number>();
  for(const c of choices)declared.set(c.assetId,(declared.get(c.assetId)??0)+c.count);
  for(const p of placements)actual.set(p.assetId,(actual.get(p.assetId)??0)+1);
  if(declared.size!==actual.size||[...declared].some(([id,count])=>actual.get(id)!==count))throw new UserError('План и экземпляры сцены не совпадают.');
  return {version:1,settings:cfg,query:text(v.query),choices,placements,palette:v.palette===null?null:palette(v.palette)};
}

import { UserError, object, text, settings, palette, direct, metaphor, compose, validateChoices, validateScene, colorTable,eligibleAssets,resolveVariants,variant,rotatedBounds } from './core.ts';
import type { Asset, Palette, Scene, Settings } from './core.ts';
import {geometrySignature,sameGeometry,geometryData} from './geometry.ts';
import type {GeometryNode} from './geometry.ts';
import {SCHEMES,scheme,roleColorTable,allowedColors} from './schemes.ts';
import bundled from '../library/bundle.json';
import type {Detail,Appearance} from './core.ts';
import {aiScene} from './ai-plan.ts';
import {inspectSceneRules} from './scene-rules.ts';
import {BACKDROPS,backdropFor,backdropColors,backdropBounds} from './backdrops.ts';

declare const NATIVE_TEST_BUILD:boolean;
const TECHNICAL=figma.command==='technical-test'||NATIVE_TEST_BUILD;
const KEY=TECHNICAL?'composer:test-catalog:v1':'composer:catalog:v2', SCENE=TECHNICAL?'composer:test-scene:v2':'composer:scene:v2', INSTANCE='composer:instance:v1', ORIGINAL='composer:original-paints:v1';
let assets:Asset[]=[],activeId:string|null=null,busy=false,initialising=true,catalogDirty=true;
const sourceNodes=new Map<string,FrameNode>();
const backdropSources=new Map<string,FrameNode>();
const BACKDROP='composer:backdrop:v1';
const sceneChildren=(frame:FrameNode)=>frame.children.filter(c=>!c.getPluginData(BACKDROP));
let resolveUiReady:()=>void;
const uiReady=new Promise<void>(resolve=>{resolveUiReady=resolve;});
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const geometry=(n:SceneNode)=>geometrySignature(n as unknown as GeometryNode);
function walk(node:SceneNode,fn:(n:SceneNode,mask:boolean)=>void,mask=false){
  const masked=mask||('isMask'in node&&node.isMask); fn(node,masked);
  if('children'in node)for(const child of node.children)walk(child,fn,masked);
}
function audit(node:SceneNode){
  let issue='';
  walk(node,n=>{
    if(!['FRAME','GROUP','VECTOR','BOOLEAN_OPERATION','RECTANGLE','ELLIPSE','POLYGON','STAR','LINE','COMPONENT','INSTANCE'].includes(n.type))issue=`${n.name}: неподдерживаемый тип ${n.type}. Используйте векторный объект без текста.`;
    for(const key of ['fills','strokes'] as const){
      if(key in n){const paints=n[key as keyof typeof n] as readonly Paint[]|symbol;if(Array.isArray(paints)&&paints.some(p=>p.type==='IMAGE'||p.type==='VIDEO'))issue=`${n.name}: содержит растровую или видеозаливку.`;}
    }
    if('effects'in n&&n.effects.some(e=>e.visible))issue=`${n.name}: содержит эффекты. Подготовьте отдельную векторную версию без эффектов.`;
  });
  if(issue)throw new UserError(issue);
}
function sourceState(root:FrameNode){const paints:unknown[]=[];walk(root,n=>{paints.push({type:n.type,...('fills'in n?{fills:n.fills}:{}),...('strokes'in n?{strokes:n.strokes}:{}),...('blendMode'in n?{blendMode:n.blendMode}:{}),...('effects'in n?{effects:n.effects}:{})});});return JSON.stringify({geometry:geometryData(root as unknown as GeometryNode),transform:root.relativeTransform,paints});}
async function node(id:string){return await figma.getNodeByIdAsync(id);}
function persist(){figma.root.setPluginData(KEY,JSON.stringify(assets.map(({thumbnail,...a})=>a)));catalogDirty=true;}
function sceneOf(n:BaseNode|null):FrameNode|null{
  while(n&&n.type!=='DOCUMENT'&&n.type!=='PAGE'){if(n.type==='FRAME'&&n.getPluginData(SCENE))return n;n=n.parent;}
  return null;
}
async function active(){
  const selected=sceneOf(figma.currentPage.selection[0]??null);
  const frame=selected??(activeId?await node(activeId):null);
  if(!frame||frame.type!=='FRAME'||!frame.getPluginData(SCENE))throw new UserError('Сначала соберите композицию или выделите её фрейм.');
  if(frame.parent?.type==='PAGE'&&frame.parent!==figma.currentPage)throw new UserError('Откройте страницу с композицией.');
  activeId=frame.id; return frame;
}
async function sendState(){
  const exists=activeId?await node(activeId):null;
  const frame=exists&&exists.type==='FRAME'?exists:null;
  const instances=frame?.children.map(c=>{const saved=c.getPluginData(INSTANCE);return saved?{id:c.id,...JSON.parse(saved)}:null;}).filter(Boolean)??[];
  const scene=frame?.getPluginData(SCENE)?JSON.parse(frame.getPluginData(SCENE)):null;
  figma.ui.postMessage({type:'state',...(catalogDirty?{assets}:{}),selection:figma.currentPage.selection.length,hasScene:!!frame,illustrations:new Set(assets.map(a=>a.source.illustrationId)).size,instances,scene});catalogDirty=false;
}
async function prepareApprovedLibrary(){
 const page=await library();
 for(const item of bundled.variants){
  const id=`${item.family}:${item.detail}:${item.state}`,existing=assets.find(a=>a.id===id),saved=existing?await node(existing.nodeId):null;
  if(existing&&saved&&saved.type==='FRAME'){existing.thumbnail=item.svg;sourceNodes.set(id,saved);continue;}
  const imported=figma.createNodeFromSvg(item.svg);page.appendChild(imported);imported.name=`${item.name} · ${item.detail} · ${item.state==='main'?'главный':'фоновый'}`;imported.fills=[];imported.clipsContent=false;audit(imported);
  imported.x=(assets.length%8)*1600;imported.y=Math.floor(assets.length/8)*1700;imported.locked=true;
  imported.setPluginData('composer:source-geometry',geometry(imported));
  const asset:Asset={id,nodeId:imported.id,name:item.name,synonyms:[item.family,...(item.family==='wallet'?['кошелек']:[])],tags:item.tags,metaphors:[],role:['book','lamp','wallet'].includes(item.family)?'hero':'support',familyId:item.family,detail:item.detail as Detail,appearance:item.state as Appearance,width:imported.width,height:imported.height,source:{illustrationId:`${item.sourceFileKey}/${item.detail}/${item.family}`,illustrationName:`${item.name} · ${item.detail}`,nodeId:item.sourceSectionId,capturedAt:'2026-11-03'},thumbnail:item.svg};
  assets=assets.filter(a=>a.id!==id);assets.push(asset);sourceNodes.set(id,imported);persist();
 }
 if(assets.length!==40)throw new UserError('Каталог должен содержать ровно 40 утверждённых вариантов.');
 for(const [index,item]of BACKDROPS.entries()){
  let source=page.children.find(n=>n.type==='FRAME'&&n.getPluginData('composer:backdrop-source')===item.id) as FrameNode|undefined;
  if(!source){source=figma.createNodeFromSvg(item.svg);page.appendChild(source);source.name=`Фон · ${item.detail} · ${SCHEMES[item.scheme].name}`;source.fills=[];source.clipsContent=true;source.x=index%3*1800;source.y=15000+Math.floor(index/3)*1400;source.locked=true;source.setPluginData('composer:backdrop-source',item.id);source.setPluginData('composer:source-geometry',geometry(source));audit(source);}
  if(source.getPluginData('composer:source-geometry')!==geometry(source))throw new UserError('Исходный фон изменён. Восстановите библиотеку.');
  backdropSources.set(item.id,source);
 }
}
async function library(){
  const marker=TECHNICAL?'technical':'approved-v2';
  let page=figma.root.children.find(p=>p.getPluginData('composer:library')===marker);
  if(!page){page=figma.createPage();page.name=TECHNICAL?'TEST ONLY · копии объектов':'Сочетание · библиотека S–L';page.setPluginData('composer:library',marker);}
  await page.loadAsync();return page;
}
function top(n:SceneNode):BaseNode{let current:BaseNode=n;while(current.parent&&current.parent.type!=='PAGE'&&current.parent.type!=='DOCUMENT')current=current.parent;return current;}
function insideManaged(n:SceneNode){let current:BaseNode|null=n;while(current){if(current.getPluginData('composer:library')||current.getPluginData(SCENE))return true;current=current.parent;}return false;}
async function addSelection(supplied?:SceneNode[]){
  if(!TECHNICAL)throw new UserError('Используется утверждённая библиотека исходных 20 иллюстраций. Посторонние объекты не добавляются.');
  const selected=supplied??[...figma.currentPage.selection];
  if(!selected.length)throw new UserError('Выделите смысловые объекты на холсте Figma, затем добавьте их в библиотеку.');
  if(selected.length+assets.length>200)throw new UserError('Каталог ограничен 200 объектами.');
  // Validate the whole batch before changing the document.
  for(const s of selected){
    if(insideManaged(s))throw new UserError('Выберите исходники, а не библиотеку или готовую композицию.');
    if(assets.some(a=>a.source.nodeId===s.id))throw new UserError(`«${s.name}» уже в каталоге.`);
    if('isMask'in s&&s.isMask)throw new UserError('Добавляйте маску вместе со всей группой, которую она ограничивает.');
    if(s.parent&&'children'in s.parent){const siblings=s.parent.children;const i=siblings.findIndex(n=>n.id===s.id);if(siblings.slice(0,i).some(n=>'isMask'in n&&n.isMask))throw new UserError('Объект зависит от маски родителя. Выделите группу целиком.');}
    if(selected.some(other=>other!==s&&'findOne'in other&&other.findOne(n=>n.id===s.id)))throw new UserError('Не выбирайте одновременно группу и её вложенный объект.');
    audit(s);if(!('absoluteRenderBounds'in s)||!s.absoluteRenderBounds)throw new UserError(`${s.name}: нет видимых границ.`);
  }
  const page=await library(),created:FrameNode[]=[],added:Asset[]=[];
  try{
    for(const s of selected){
      if(!('absoluteRenderBounds'in s)||!s.absoluteRenderBounds)throw new UserError('Объект потерял видимые границы.');
      const b=s.absoluteRenderBounds,ancestor=top(s),transform=copy(s.absoluteTransform);
      const wrapper=figma.createFrame();created.push(wrapper);page.appendChild(wrapper);
      wrapper.name=s.name;wrapper.resize(Math.max(b.width,.01),Math.max(b.height,.01));wrapper.fills=[];wrapper.clipsContent=false;
      const c=s.clone();wrapper.appendChild(c);c.relativeTransform=[[transform[0][0],transform[0][1],transform[0][2]-b.x],[transform[1][0],transform[1][1],transform[1][2]-b.y]];
      wrapper.x=((assets.length+added.length)%8)*320;wrapper.y=Math.floor((assets.length+added.length)/8)*320;wrapper.locked=true;
      const asset:Asset={id:`asset-${wrapper.id.replace(/:/g,'-')}`,nodeId:wrapper.id,name:s.name,synonyms:[],tags:[],metaphors:[],role:added.length===0&&assets.length===0?'hero':'support',width:wrapper.width,height:wrapper.height,source:{illustrationId:ancestor.id,illustrationName:ancestor.name,nodeId:s.id,capturedAt:new Date().toISOString()}};
      wrapper.setPluginData('composer:source-geometry',geometry(wrapper));
      asset.thumbnail=await wrapper.exportAsync({format:'SVG_STRING',svgIdAttribute:true});added.push(asset);
    }
    assets.push(...added);persist();figma.commitUndo();await sendState();return `Добавлено объектов: ${added.length}. Дополните теги в библиотеке.`;
  }catch(e){for(const c of created)if(!c.removed)c.remove();throw e;}
}
function rgbHex(c:RGB){return '#'+[c.r,c.g,c.b].map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('').toUpperCase();}
function hexRgb(c:string):RGB{return{r:parseInt(c.slice(1,3),16)/255,g:parseInt(c.slice(3,5),16)/255,b:parseInt(c.slice(5,7),16)/255};}
type Paints={fills?:Paint[];strokes?:Paint[]};
function originalPaints(n:SceneNode):Paints{
  const saved=n.getPluginData(ORIGINAL);if(saved)return JSON.parse(saved);
  const p:Paints={};
  if('fills'in n&&Array.isArray(n.fills))p.fills=copy(n.fills);
  if('strokes'in n)p.strokes=copy([...n.strokes]);
  n.setPluginData(ORIGINAL,JSON.stringify(p));return p;
}
function syncBackdrop(frame:FrameNode,scene:Scene,p:Palette){
 for(const child of frame.children)if(child.getPluginData(BACKDROP))child.remove();
 if(scene.settings.backdrop!=='source')return;
 const source=backdropFor(scene.settings,p),original=backdropSources.get(source.id);if(!original)throw new UserError('Исходный фон не подготовлен. Перезапустите конструктор.');
 audit(original);if(original.getPluginData('composer:source-geometry')!==geometry(original))throw new UserError('Геометрия исходного фона изменена. Восстановите библиотеку.');
 const background=original.clone();background.locked=false;frame.insertChild(0,background);
 const bounds=backdropBounds(frame.width,frame.height,source);background.rescale(bounds.scale);background.x=bounds.x;background.y=bounds.y;background.name=`Фон · ${source.detail} · исходный SVG`;
 const table=backdropColors(source,p);
 walk(background,(n,mask)=>{const paints=originalPaints(n);if(mask)return;for(const key of ['fills','strokes']as const){const values=paints[key];if(!values)continue;const mapped=copy(values).map(paint=>{if(paint.visible===false)return paint;if(paint.type!=='SOLID')throw new UserError('Фон должен состоять из исходных векторных заливок.');const color=table[rgbHex(paint.color)];if(!color)throw new UserError('Неизвестный цвет исходного фона.');const result={...paint,color:hexRgb(color)};delete result.boundVariables;return result;});if(key==='fills'&&'fills'in n)n.fills=mapped;if(key==='strokes'&&'strokes'in n)n.strokes=mapped;}});
 background.setPluginData(BACKDROP,source.id);background.locked=true;frame.clipsContent=true;
}
function applyPalette(frame:FrameNode,p:Palette|null){
  if(!TECHNICAL){
    const target=scheme(p??SCHEMES.violet);
    for(const child of sceneChildren(frame)){
      const info=JSON.parse(child.getPluginData(INSTANCE)||'{}'),asset=assets.find(a=>a.id===info.assetId);if(!asset?.appearance)throw new UserError('Не определено состояние объекта.');
      const table=roleColorTable(target,asset.appearance);
      walk(child,(n,mask)=>{const original=originalPaints(n);for(const key of ['fills','strokes']as const){const paints=original[key];if(!paints)continue;
        const mapped=copy(paints).map(paint=>{if(mask||paint.visible===false)return paint;
          const convert=(color:RGB)=>{const result=table[rgbHex(color)];if(!result)throw new UserError(`Исходный цвет ${rgbHex(color)} не разрешён для ${asset.appearance==='main'?'главного':'фонового'} объекта.`);return hexRgb(result);};
          if(paint.type==='SOLID'){const result={...paint,color:convert(paint.color)};delete result.boundVariables;return result;}
          if('gradientStops'in paint)return{...paint,gradientStops:paint.gradientStops.map(stop=>({...stop,color:{...convert(stop.color),a:stop.color.a}}))};return paint;
        });
        if(key==='fills'&&'fills'in n)n.fills=mapped;if(key==='strokes'&&'strokes'in n)n.strokes=mapped;
      }});
    }
    const scene=JSON.parse(frame.getPluginData(SCENE)) as Scene;syncBackdrop(frame,scene,target);
    const color=target.background??(scene.settings.backdrop==='solid'?target.backgroundColors![0]:undefined);
    frame.fills=color?[{type:'SOLID',color:hexRgb(color)}]:[];return;
  }
  const nodes:{n:SceneNode;original:Paints;mask:boolean}[]=[],colors:string[]=[];
  for(const child of frame.children)walk(child,(n,mask)=>{
    const original=originalPaints(n);nodes.push({n,original,mask});if(mask)return;
    for(const paints of Object.values(original))for(const paint of paints as Paint[]){if(paint.visible===false)continue;if(paint.type==='SOLID')colors.push(rgbHex(paint.color));else if('gradientStops'in paint)for(const stop of paint.gradientStops)colors.push(rgbHex(stop.color));}
  });
  const table=p?colorTable(colors,p):{};
  for(const {n,original,mask}of nodes)for(const key of ['fills','strokes']as const){
    const paints=original[key];if(!paints)continue;
    const mapped=copy(paints).map(paint=>{
      if(!p||mask||paint.visible===false)return paint;
      if(paint.type==='SOLID'){const mapped={...paint,color:hexRgb(table[rgbHex(paint.color)])};delete mapped.boundVariables;return mapped;}
      if('gradientStops'in paint)return{...paint,gradientStops:paint.gradientStops.map(stop=>({...stop,color:{...hexRgb(table[rgbHex(stop.color)]),a:stop.color.a}}))};
      return paint;
    });
    if(key==='fills'&&'fills'in n)n.fills=mapped;
    if(key==='strokes'&&'strokes'in n)n.strokes=mapped;
  }
  frame.fills=p?.background?[{type:'SOLID',color:hexRgb(p.background)}]:[];
}
async function render(scene:Scene,focus=true,transient=false):Promise<FrameNode>{
  const resolved=new Map<string,FrameNode>();
  for(const p of scene.placements){const a=assets.find(a=>a.id===p.assetId)!;const n=await node(a.nodeId);if(!n||n.type!=='FRAME')throw new UserError(`Источник «${a.name}» удалён. Восстановите библиотеку.`);audit(n);if(n.getPluginData('composer:source-geometry')&&n.getPluginData('composer:source-geometry')!==geometry(n))throw new UserError(`Геометрия библиотечного объекта «${a.name}» изменена. Восстановите исходную копию.`);resolved.set(a.id,n);}
  if(!TECHNICAL&&!transient){
    let page=figma.root.children.find(p=>p.getPluginData('composer:output')==='1');
    if(!page){page=figma.createPage();page.name='Сочетание · композиции';page.setPluginData('composer:output','1');}
    if(figma.currentPage!==page)await figma.setCurrentPageAsync(page);
  }
  const frame=figma.createFrame(),baseName=`Сочетание · ${scene.query.slice(0,60)}`;let name=baseName,index=2;while(figma.currentPage.children.some(n=>n!==frame&&n.name===name))name=`${baseName} (${index++})`;frame.name=name;frame.resize(scene.settings.width,scene.settings.height);frame.fills=[];frame.clipsContent=false;
  try{
    const right=Math.max(0,...figma.currentPage.children.filter(n=>n!==frame).map(n=>n.x+n.width));frame.x=transient?0:right+120;frame.y=0;
    for(const p of [...scene.placements].sort((a,b)=>a.z-b.z)){
      const c=resolved.get(p.assetId)!.clone();c.locked=false;frame.appendChild(c);c.rescale(p.scale);
      const angle=p.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
      c.relativeTransform=[[cos,-sin,p.cx-cos*c.width/2+sin*c.height/2],[sin,cos,p.cy-sin*c.width/2-cos*c.height/2]];
      c.setPluginData(INSTANCE,JSON.stringify({assetId:p.assetId,instanceId:p.instanceId}));
      c.setPluginData('composer:instance-geometry',geometry(c));
    }
    frame.setPluginData(SCENE,JSON.stringify(scene));applyPalette(frame,scene.palette);if(focus){figma.currentPage.selection=[frame];activeId=frame.id;figma.viewport.scrollAndZoomIntoView([frame]);figma.commitUndo();}return frame;
  }catch(e){frame.remove();throw e;}
}
function snapshot(frame:FrameNode,checkPaints=true):Scene{
  const stored=validateScene(JSON.parse(frame.getPluginData(SCENE)),assets);
  if(!TECHNICAL&&checkPaints){const allowed=new Set(scheme(stored.palette??SCHEMES.violet).backgroundColors);if(Array.isArray(frame.fills)&&frame.fills.some(p=>p.visible!==false&&(p.type!=='SOLID'||!allowed.has(rgbHex(p.color)))))throw new UserError('Заливка холста нарушает фоновые цвета схемы.');}
  if(!TECHNICAL){
   const backgrounds=frame.children.filter(c=>c.getPluginData(BACKDROP));
   if(backgrounds.length!==(stored.settings.backdrop==='source'?1:0))throw new UserError('Исходный фон отсутствует или продублирован. Пересоберите композицию.');
   if(backgrounds.length){const bg=backgrounds[0] as FrameNode,p=scheme(stored.palette??SCHEMES.violet),source=backdropFor(stored.settings,p),original=backdropSources.get(source.id),bounds=backdropBounds(frame.width,frame.height,source);
    if(frame.children[0]!==bg||!original||!sameGeometry(bg as unknown as GeometryNode,original as unknown as GeometryNode)||Math.abs(bg.width-source.width*bounds.scale)>.2||Math.abs(bg.height-source.height*bounds.scale)>.2||Math.abs(bg.x-bounds.x)>.2||Math.abs(bg.y-bounds.y)>.2||Math.abs(bg.rotation)>.001)throw new UserError('Геометрия или порядок исходного фона изменены. Пересоберите композицию.');
    audit(bg);if(checkPaints){const allowed=new Set(p.backgroundColors);walk(bg,(n,mask)=>{if(mask)return;for(const key of ['fills','strokes']as const)if(key in n){const paints=n[key as keyof typeof n]as readonly Paint[];if(Array.isArray(paints)&&paints.some(paint=>paint.type==='SOLID'&&paint.visible!==false&&!allowed.has(rgbHex(paint.color))))throw new UserError('В фоне использован цвет главных объектов. Примените палитру повторно.');}});}
   }
  }
  const placements=sceneChildren(frame).map((c,z)=>{
    const info=c.getPluginData(INSTANCE);if(!info)throw new UserError('В сцене есть посторонний объект. Уберите его перед экспортом.');
    const data=object(JSON.parse(info)),asset=assets.find(a=>a.id===data.assetId);
    if(!asset)throw new UserError('Объект сцены отсутствует в каталоге.');
    audit(c);
    if(!TECHNICAL&&checkPaints){const p=scheme(stored.palette??SCHEMES.violet),allowed=new Set(allowedColors(p,asset.appearance!));walk(c,(n,mask)=>{if(mask)return;for(const key of ['fills','strokes']as const){if(!(key in n))continue;const paints=n[key as keyof typeof n]as readonly Paint[];if(!Array.isArray(paints))continue;for(const paint of paints as readonly Paint[]){if(paint.visible===false)continue;const colors=paint.type==='SOLID'?[paint.color]:'gradientStops'in paint?paint.gradientStops.map(s=>s.color):[];if(colors.some(color=>!allowed.has(rgbHex(color))))throw new UserError('Цвет объекта нарушает выбранную схему или правила фоновых цветов. Примените палитру повторно.');}}});}
    const source=sourceNodes.get(asset.id);
    const geometryValid=!TECHNICAL&&source?sameGeometry(c as unknown as GeometryNode,source as unknown as GeometryNode):!c.getPluginData('composer:instance-geometry')||c.getPluginData('composer:instance-geometry')===geometry(c);
    if(!geometryValid)throw new UserError('Внутренняя геометрия объекта изменена. Отмените изменение или соберите новый экземпляр из библиотеки.');
    const t=c.relativeTransform;
    const scaleX=Math.hypot(t[0][0],t[1][0])*c.width/asset.width,scaleY=Math.hypot(t[0][1],t[1][1])*c.height/asset.height;
    const dot=t[0][0]*t[0][1]+t[1][0]*t[1][1],det=t[0][0]*t[1][1]-t[0][1]*t[1][0];
    if(Math.abs(scaleX-scaleY)>Math.max(scaleX,scaleY)*.002||Math.abs(dot)>.002||det<=0)throw new UserError('Обнаружено растяжение, отражение или скос. Используйте равномерный Scale Tool.');
    return{assetId:asset.id,instanceId:`${String(data.instanceId)}:${c.id}`,cx:t[0][2]+t[0][0]*c.width/2+t[0][1]*c.height/2,cy:t[1][2]+t[1][0]*c.width/2+t[1][1]*c.height/2,scale:scaleX,rotation:Math.atan2(t[1][0],t[0][0])*180/Math.PI,z};
  });
  if(!placements.length||placements.length>12)throw new UserError('В композиции должно быть от 1 до 12 объектов.');
  const counts=new Map<string,number>();for(const p of placements)counts.set(p.assetId,(counts.get(p.assetId)??0)+1);
  return validateScene({...stored,settings:{...stored.settings,width:frame.width,height:frame.height},placements,choices:[...counts].map(([assetId,count])=>({assetId,count,reason:'Текущее состояние холста'}))},assets);
}
async function handle(raw:unknown){
  const m=object(raw),type=text(m.type,40);
  switch(type){
    case 'init':{resolveUiReady();catalogDirty=true;const token=await figma.clientStorage.getAsync('composer:ai-connection');if(typeof token==='string')figma.ui.postMessage({type:'ai-settings',token});if(!initialising)await sendState();return;}
    case 'ai-config':{const token=text(m.token,128);if(token.length<24)throw new UserError('Некорректный код подключения.');await figma.clientStorage.setAsync('composer:ai-connection',token);return;}
    case 'apply-ai-scene':{
      const cfg=settings(m.settings),requestCfg=settings(m.requestSettings),query=text(m.query),mode=text(m.mode,30);if(!['components','metaphor'].includes(mode))throw new UserError('Некорректный режим AI-плана.');
      const required=mode==='components'?resolveVariants(direct(query,eligibleAssets(assets,requestCfg)),assets,requestCfg):[];
      const checked=aiScene(m.plan,assets,cfg,query,scheme(m.palette??SCHEMES.violet),required);await render(checked.scene);await sendState();return 'AI-композиция создана из исходных векторных объектов.';
    }
    case 'close':figma.closePlugin();return;
    case 'acceptance':return await acceptance();
    case 'retry-acceptance':return await retryAcceptance();
    case 'create-examples':return await createExamples();
    case 'check-scene-rules':{const scene=snapshot(await active()),relations=inspectSceneRules(scene.placements,assets);figma.ui.postMessage({type:'scene-rules',relations});return relations.some(r=>!r.ok)?'Связи проверены: есть замечания, см. список.':'Связи предметов на холсте проверены.';}
    case 'add-selection':return await addSelection();
    case 'add-section':{
      const selected=figma.currentPage.selection;
      if(selected.length!==1||selected[0].type!=='SECTION')throw new UserError('Выделите один подготовленный раздел Figma с отдельными объектами на первом уровне.');
      const usable:SceneNode[]=[],skipped:string[]=[];
      for(const child of selected[0].children){try{audit(child);if(!('absoluteRenderBounds'in child)||!child.absoluteRenderBounds)throw new Error('нет границ');usable.push(child);}catch{skipped.push(child.name);}}
      if(!usable.length)throw new UserError('В разделе нет поддерживаемых векторных объектов первого уровня.');
      const result=await addSelection(usable);return `${result}${skipped.length?` Пропущены подписи/неподдерживаемые узлы: ${skipped.join(', ')}.`:''}`;
    }
    case 'update-asset':{
      const a=assets.find(a=>a.id===m.id);if(!a)throw new UserError('Объект не найден.');
      const fields=object(m.fields),role=text(fields.role,20);if(!['hero','support','detail'].includes(role))throw new UserError('Некорректная роль.');
      const list=(value:unknown)=>text(value,2000).split(/[,;\n]/).map(s=>s.trim()).filter(Boolean).slice(0,50);
      const name=text(fields.name,160);if(!name)throw new UserError('Укажите имя объекта.');
      for(const target of assets.filter(other=>a.familyId?other.familyId===a.familyId:other.id===a.id))Object.assign(target,{name,role,synonyms:list(fields.synonyms),tags:list(fields.tags),metaphors:list(fields.metaphors)});persist();await sendState();return 'Описание предмета сохранено для всех вариантов S/L и состояний.';
    }
    case 'compose':{
      const cfg=settings(m.settings),query=text(m.query),mode=text(m.mode,30);
      if(!assets.length)throw new UserError('Сначала добавьте объекты в библиотеку.');
      const pool=eligibleAssets(assets,cfg),requested=mode==='components'?direct(query,pool):mode==='metaphor'?metaphor(query,pool):mode==='plan'?validateChoices(JSON.parse(query),assets):(()=>{throw new UserError('Неизвестный режим.');})();
      const choices=resolveVariants(requested,assets,cfg);
      const scene:Scene={version:1,settings:cfg,query,choices,placements:compose(choices,assets,cfg),palette:TECHNICAL?(m.palette===null?null:palette(m.palette)):scheme(m.palette??SCHEMES.violet)};
      await render(scene);figma.ui.postMessage({type:'composed',choices});await sendState();return 'Композиция создана. Объекты доступны для редактирования на холсте.';
    }
    case 'reflow':{
      const frame=await active(),scene=snapshot(frame),cfg=settings(m.settings);
      const preserve=cfg.appearanceMode===scene.settings.appearanceMode,choices=resolveVariants(scene.choices,assets,cfg,preserve);
      await render({...scene,settings:cfg,choices,placements:compose(choices,assets,cfg),palette:cfg.backdrop==='none'&&scene.palette?{...scene.palette,background:undefined}:scene.palette});await sendState();return 'Новый формат и варианты S/L собраны рядом. Предыдущий вариант сохранён.';
    }
    case 'palette':{
      const frame=await active(),scene=snapshot(frame,false),p=TECHNICAL?(m.palette===null?null:palette(m.palette)):scheme(m.palette??SCHEMES.violet);
      if(m.backdrop!==undefined)scene.settings=settings({...scene.settings,backdrop:m.backdrop});
      if(m.preview===true){const temp=frame.clone();try{temp.setPluginData(SCENE,JSON.stringify({...scene,palette:p}));applyPalette(temp,p);figma.ui.postMessage({type:'preview',svg:await temp.exportAsync({format:'SVG_STRING',svgIdAttribute:true})});}finally{temp.remove();}return 'Предпросмотр палитры. Холст не изменён.';}
      frame.setPluginData(SCENE,JSON.stringify({...scene,palette:p}));
      applyPalette(frame,p);frame.setPluginData(SCENE,JSON.stringify({...scene,palette:p}));figma.commitUndo();return p?'Палитра применена.':'Исходные цвета восстановлены.';
    }
    case 'set-state':{
      const frame=await active(),scene=snapshot(frame),id=text(m.id,200),state=text(m.appearance,20);if(state!=='main'&&state!=='background')throw new UserError('Неизвестное состояние.');
      const index=sceneChildren(frame).findIndex(c=>c.id===id);if(index<0)throw new UserError('Экземпляр не найден.');
      const old=assets.find(a=>a.id===scene.placements[index].assetId)!,next=variant(old,assets,scene.settings.detail!,state);
      scene.placements[index].assetId=next.id;
      const counts=new Map<string,number>();for(const p of scene.placements)counts.set(p.assetId,(counts.get(p.assetId)??0)+1);
      scene.choices=[...counts].map(([assetId,count])=>({assetId,count,reason:'Выбранное состояние объекта'}));
      const states=new Set(scene.placements.map(p=>assets.find(a=>a.id===p.assetId)!.appearance));scene.settings.appearanceMode=states.size>1?'mixed':states.has('background')?'background':'main';
      await render(scene);await sendState();return 'Состояние изменено копированием соответствующего исходного варианта. Предыдущая сцена сохранена.';
    }
    case 'export-svg':
    case 'show-svg':{
      const frame=await active();snapshot(frame);
      figma.ui.postMessage({type:type==='show-svg'?'show-svg':'download-svg',svg:await frame.exportAsync({format:'SVG_STRING',svgIdAttribute:true,svgOutlineText:false}),filename:'composition.svg'});return;
    }
    case 'save-scene':{
      const frame=await active();figma.ui.postMessage({type:'download-json',data:snapshot(frame),filename:'composition.scene.json'});return 'Сцена сохранена с текущими правками.';
    }
    case 'load-scene':await render(validateScene(m.scene,assets));await sendState();return 'Сцена восстановлена.';
    case 'export-catalog':figma.ui.postMessage({type:'download-json',data:{version:1,assets:assets.map(({thumbnail,...a})=>a)},filename:'catalog.metadata.json'});return;
    case 'export-bundle':{
      const scenes:{name:string;svg:string;scene:Scene}[]=[];
      for(const page of figma.root.children){
        if(page.name.startsWith('TEST ONLY')||page.getPluginData('composer:library')||page.getSharedPluginData('composer','archive')==='v1')continue;
        await page.loadAsync();
        for(const child of page.children){
          if(child.type!=='FRAME'||!child.getPluginData(SCENE))continue;
          if(m.examplesOnly===true&&child.getPluginData('composer:example-batch')!==figma.root.getPluginData('composer:latest-examples'))continue;
          if(scenes.length>=20)throw new UserError('В архив можно включить до 20 композиций.');
          scenes.push({name:child.name,scene:snapshot(child),svg:await child.exportAsync({format:'SVG_STRING',svgIdAttribute:true})});
        }
      }
      if(!scenes.length)throw new UserError('Нет композиций для архива.');
      figma.ui.postMessage({type:'download-bundle',scenes,catalog:assets.map(({thumbnail,...a})=>a)});return;
    }
    case 'reimport':{
      const svg=text(m.svg,2000000),imported=figma.createNodeFromSvg(svg);
      try{
        audit(imported);
        let vectors=0,groups=0;
        walk(imported,n=>{if('children'in n)groups++;else vectors++;});
        if(!vectors)throw new UserError('После импорта SVG не осталось векторных объектов.');
        const exported=await imported.exportAsync({format:'SVG_STRING',svgIdAttribute:true});
        if(/<(?:image|text)\b/i.test(exported))throw new UserError('Повторный экспорт содержит растр или текст.');
        imported.setPluginData('composer:roundtrip-report',JSON.stringify({version:1,vectors,groups,width:imported.width,height:imported.height,reexportCharacters:exported.length,vectorOnly:true}));
        imported.name='Проверка SVG · повторный импорт';imported.x=figma.viewport.center.x+100;imported.y=figma.viewport.center.y;
        figma.currentPage.selection=[imported];figma.viewport.scrollAndZoomIntoView([imported]);figma.commitUndo();
        return `SVG повторно импортирован: ${vectors} векторных узлов, ${groups} групп. Растра и текста нет. Повторный SVG-экспорт выполнен.`;
      }catch(error){imported.remove();throw error;}
    }
    default:throw new UserError('Неизвестное действие.');
  }
}
figma.showUI(__html__,{width:480,height:780,themeColors:true});
figma.ui.onmessage=async(raw:unknown)=>{
  if(raw&&typeof raw==='object'&&'type'in raw&&raw.type==='close'){figma.closePlugin();return;}
  if(busy){figma.ui.postMessage({type:'error',message:'Дождитесь завершения текущей операции.'});return;}
  busy=true;figma.ui.postMessage({type:'busy',value:true});
  try{const message=await handle(raw);if(message)figma.ui.postMessage({type:'success',message});}
  catch(e){const message=e instanceof Error?e.message:'Не удалось выполнить действие.';figma.notify(message,{error:true,timeout:8000});figma.ui.postMessage({type:'error',message});}
  finally{busy=false;figma.ui.postMessage({type:'busy',value:false});}
};
figma.on('selectionchange',()=>{
  const selected=sceneOf(figma.currentPage.selection[0]??null);if(selected)activeId=selected.id;
  if(!busy&&!initialising)void sendState();
});
(async()=>{
  try{
    await uiReady;
    if(TECHNICAL){await nativeTests();initialising=false;return;}
    const saved=figma.root.getPluginData(KEY);assets=saved?JSON.parse(saved):[];
    await prepareApprovedLibrary();
    const selected=sceneOf(figma.currentPage.selection[0]??null);if(selected)activeId=selected.id;initialising=false;await sendState();
  }catch(e){const message=`Не удалось запустить плагин: ${e instanceof Error?e.message:'ошибка'}`;figma.notify(message,{error:true,timeout:12000});figma.ui.postMessage({type:'error',message});}
})();

async function acceptance(){
 if(TECHNICAL)throw new UserError('Откройте обычный конструктор для проверки исходной библиотеки.');
 const savedPage=figma.currentPage,savedSelection=[...savedPage.selection];
 const originals=await Promise.all(assets.map(async a=>{const n=await node(a.nodeId);if(!n||n.type!=='FRAME')throw new UserError('Исходный вариант удалён.');audit(n);return n;}));
 const originalState=sourceState;
 const before=originals.map(originalState);
 const exportSvg=async(frame:FrameNode)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([frame.exportAsync({format:'SVG_STRING'}),new Promise<string>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Figma не ответила на SVG-экспорт за 30 секунд. Повторите проверку.')),30000);})]);}finally{if(timer)clearTimeout(timer);}};
 let qa=figma.root.children.find(p=>p.getPluginData('composer:qa')==='v2');if(!qa){qa=figma.createPage();qa.name='Сочетание · проверка библиотеки';qa.setPluginData('composer:qa','v2');}
 await figma.setCurrentPageAsync(qa);
 const cases:{detail:string;appearanceMode:string;palette:string;width:number;height:number;ok:boolean;error?:string}[]=[];
 const variantFailures:{assetId:string;error:string}[]=[];let variantsPassed=0;
 const make=(detail:Detail,appearanceMode:Settings['appearanceMode'],width:number,height:number,p:Palette,query='лампа, книга, монета',layout:Settings['layout']='balanced',metaphorMode=false):Scene=>{const cfg=settings({detail,appearanceMode,width,height,seed:42,layout}),pool=eligibleAssets(assets,cfg),choices=resolveVariants(metaphorMode?metaphor(query,pool):direct(query,pool),assets,cfg);return{version:1,settings:cfg,query,choices,placements:compose(choices,assets,cfg),palette:scheme(p)};};
 let colorGuard=false,relativeGuard=false,sceneScale=false,manualOperations=false,guardError='';
 try{
  for(const asset of assets){
   let frame:FrameNode|undefined;
   try{const cfg=settings({detail:asset.detail,appearanceMode:asset.appearance,width:1080,height:1080,seed:42,layout:'balanced'}),choices=[{assetId:asset.id,count:1,reason:'Проверка исходного варианта'}];frame=await render({version:1,settings:cfg,query:asset.name,choices,placements:compose(choices,assets,cfg),palette:SCHEMES.violet},false,true);snapshot(frame);const svg=await exportSvg(frame);if(/<(?:image|text)\b/i.test(svg))throw new Error('Растр или текст в SVG.');variantsPassed++;}catch(e){variantFailures.push({assetId:asset.id,error:e instanceof Error?e.message:String(e)});}finally{frame?.remove();}
   figma.ui.postMessage({type:'progress',message:`Проверка каждого исходного варианта: ${variantsPassed+variantFailures.length}/40`});
  }
  for(const detail of ['S','L']as const)for(const appearanceMode of ['main','mixed','background']as const)for(const p of Object.values(SCHEMES))for(const [width,height]of [[1080,1080],[1600,900],[900,1600]]){
   let frame:FrameNode|undefined;const result={detail,appearanceMode,palette:p.name,width,height,ok:false,error:undefined as string|undefined};
   try{frame=await render(make(detail,appearanceMode,width,height,p),false,true);const state=snapshot(frame);if(!state.placements.length)throw new Error('Пустая сцена.');const svg=await exportSvg(frame);if(/<(?:image|text)\b/i.test(svg))throw new Error('Растр или текст в SVG.');result.ok=true;}catch(e){result.error=e instanceof Error?e.message:String(e);}finally{frame?.remove();}
   cases.push(result);figma.ui.postMessage({type:'progress',message:`Проверка исходных вариантов: ${cases.length}/54`});
  }
  const frame=await render(make('S','main',1600,900,SCHEMES.violet),false,true);
  try{
   let target:SceneNode|undefined;walk(frame,n=>{if(!target&&n.type==='VECTOR'&&Array.isArray(n.fills)&&n.fills.some(p=>p.type==='SOLID'))target=n;});
   if(!target||!('fills'in target))throw new Error('Нет векторной заливки для проверки.');
   const painted=target as VectorNode,paints=painted.fills;painted.fills=[{type:'SOLID',color:{r:1,g:0,b:0}}];try{snapshot(frame);}catch(e){colorGuard=/Цвет объекта/.test(String(e));}painted.fills=paints;
   const originalChild=frame.children[0] as FrameNode;originalChild.rescale(1.1);try{snapshot(frame);}catch{relativeGuard=true;}originalChild.rescale(1/1.1);
   frame.rescale(1.1);try{snapshot(frame);sceneScale=true;}catch{}
   const count=frame.children.length,c=frame.children[0] as FrameNode;c.rotation=12;c.x+=8;c.y+=8;const duplicate=c.clone();frame.insertChild(0,duplicate);const duplicated=snapshot(frame);duplicate.remove();const restored=snapshot(frame);manualOperations=duplicated.placements.length===count+1&&restored.placements.length===count;
  }catch(e){guardError=e instanceof Error?e.message:String(e);}finally{frame.remove();}
 }finally{await figma.setCurrentPageAsync(savedPage);savedPage.selection=savedSelection.filter(n=>!n.removed);}
 const after=originals.map(originalState),originalsUnchanged=before.every((state,i)=>state===after[i]);
 const report={version:2,createdAt:new Date().toISOString(),sourceIllustrations:new Set(assets.map(a=>a.source.illustrationId)).size,sourceVariants:assets.length,variantsPassed,variantFailures,cases:cases.length,passed:cases.filter(c=>c.ok).length,colorGuard,relativeGuard,sceneScale,manualOperations,guardError,originalsUnchanged,failures:cases.filter(c=>!c.ok)};
 figma.root.setPluginData('composer:acceptance:v2',JSON.stringify(report));figma.ui.postMessage({type:'acceptance-report',report});
 if(variantsPassed!==40||report.passed!==54||!colorGuard||!relativeGuard||!sceneScale||!manualOperations||!originalsUnchanged)throw new UserError('Комплексная проверка выявила несоответствие. См. отчёт проверки.');
 await createExamples();return 'Проверено 40 вариантов и 54/54 сочетаний. Исходники неизменны. Три итоговых примера готовы.';
}
async function createExamples(){
 const make=(detail:Detail,appearanceMode:Settings['appearanceMode'],width:number,height:number,p:Palette,query:string,layout:Settings['layout'],metaphorMode=false):Scene=>{const cfg=settings({detail,appearanceMode,width,height,seed:42,layout,backdrop:'source'}),pool=eligibleAssets(assets,cfg),choices=resolveVariants(metaphorMode?metaphor(query,pool):direct(query,pool),assets,cfg);return{version:1,settings:cfg,query,choices,placements:compose(choices,assets,cfg),palette:scheme(p)};};
 const batch=String(Date.now()),examples:FrameNode[]=[],backgroundBefore=BACKDROPS.map(b=>sourceState(backdropSources.get(b.id)!));
 for(const [i,scene]of [make('S','main',1080,1080,SCHEMES.violet,'книга, монета × 2, лампа','focus'),make('L','mixed',1200,900,SCHEMES.peach,'Идеи для команды','focus',true),make('S','mixed',900,1200,SCHEMES.turquoise,'книга (фон), наушники (главный), телефон (главный)','diagonal')].entries()){
  const frame=await render(scene,false);frame.name=`Пример ${String(i+1).padStart(2,'0')} · ${scene.query}`;frame.setPluginData('composer:example-batch',batch);examples.push(frame);
  snapshot(frame);
 }
 figma.root.setPluginData('composer:latest-examples',batch);activeId=examples[0].id;figma.currentPage.selection=[examples[0]];figma.viewport.scrollAndZoomIntoView(examples);figma.commitUndo();await sendState();
 figma.root.setSharedPluginData('composer','native-background-check',JSON.stringify({createdAt:new Date().toISOString(),version:'0.6.0',sources:BACKDROPS.length,backgroundSourcesUnchanged:BACKDROPS.every((b,i)=>backgroundBefore[i]===sourceState(backdropSources.get(b.id)!)),examples:examples.map(frame=>({id:frame.id,name:frame.name,objects:snapshot(frame).placements.length,backdrop:frame.children[0].getPluginData(BACKDROP),geometryAndPaletteValid:true}))}));
 figma.ui.postMessage({type:'examples-ready'});return 'Три итоговых примера готовы. Можно скачать архив.';
}
async function retryAcceptance(){
 const raw=figma.root.getPluginData('composer:acceptance:v2');if(!raw)throw new UserError('Сначала выполните полную проверку.');
 const report=JSON.parse(raw);
 if(report.variantsPassed!==40||report.cases!==54||!Array.isArray(report.failures)||!report.failures.length)throw new UserError('Нет неуспешных сочетаний для повторной проверки.');
 const savedPage=figma.currentPage,savedSelection=[...savedPage.selection],qa=figma.root.children.find(p=>p.getPluginData('composer:qa')==='v2');if(!qa)throw new UserError('Страница проверки отсутствует.');
 const before=assets.map(a=>sourceState(sourceNodes.get(a.id)!));
 const remaining:typeof report.failures=[],attempted=report.failures.length;let passed=0;
 try{await figma.setCurrentPageAsync(qa);for(const failure of report.failures){let frame:FrameNode|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  try{const cfg=settings({detail:failure.detail,appearanceMode:failure.appearanceMode,width:failure.width,height:failure.height,seed:42,layout:'balanced'}),p=Object.values(SCHEMES).find(p=>p.name===failure.palette);if(!p)throw new Error('Неизвестная схема.');
   const choices=resolveVariants(direct('лампа, книга, монета',eligibleAssets(assets,cfg)),assets,cfg);frame=await render({version:1,settings:cfg,query:'лампа, книга, монета',choices,placements:compose(choices,assets,cfg),palette:p},false,true);snapshot(frame);
   const svg=await Promise.race([frame.exportAsync({format:'SVG_STRING'}),new Promise<string>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Figma не ответила на SVG-экспорт за 30 секунд.')),30000);})]);if(/<(?:image|text)\b/i.test(svg))throw new Error('Растр или текст в SVG.');passed++;
  }catch(e){remaining.push({...failure,error:e instanceof Error?e.message:String(e)});}finally{if(timer)clearTimeout(timer);frame?.remove();}
 }}finally{await figma.setCurrentPageAsync(savedPage);savedPage.selection=savedSelection.filter(n=>!n.removed);}
 const unchanged=assets.every((a,i)=>before[i]===sourceState(sourceNodes.get(a.id)!));
 report.retryHistory=[...(report.retryHistory??[]),{createdAt:new Date().toISOString(),previousPassed:report.passed,attempted,passed,originalsUnchanged:unchanged}];report.passed+=passed;report.failures=remaining;report.originalsUnchanged=report.originalsUnchanged&&unchanged;report.createdAt=new Date().toISOString();
 figma.root.setPluginData('composer:acceptance:v2',JSON.stringify(report));figma.ui.postMessage({type:'acceptance-report',report});
 if(report.passed!==54||!report.originalsUnchanged)throw new UserError('Повторная проверка не прошла. См. отчёт.');
 await createExamples();return 'Все 54 сочетания проверены; история повторов сохранена. Три примера готовы.';
}

async function nativeTests(){
  const results:{name:string;ok:boolean;detail?:string}[]=[],exported:{name:string;svg:string}[]=[];
  const check=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
  const test=async(name:string,fn:()=>unknown|Promise<unknown>)=>{try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,detail:e instanceof Error?e.message:String(e)});}};
  const page=figma.root.children.find(p=>p.name==='TEST ONLY · проверка плагина')??figma.createPage();page.name='TEST ONLY · проверка плагина';page.setPluginData('composer:technical','1');await figma.setCurrentPageAsync(page);
  assets=[];persist();activeId=null;
  const originalSvg=[
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="180" viewBox="0 0 100 180"><g id="person"><circle cx="50" cy="28" r="23" fill="#D9A481"/><path d="M20 170 L20 80 Q20 55 50 55 Q80 55 80 80 L80 170 Z" fill="#315D85" stroke="#172A40" stroke-width="4"/></g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="200" viewBox="0 0 90 200"><defs><linearGradient id="g"><stop stop-color="#172A40"/><stop offset="1" stop-color="#89B9CB"/></linearGradient></defs><g id="ladder" stroke="url(#g)" stroke-width="7" fill="none"><path d="M12 196V4M78 196V4M12 35H78M12 70H78M12 105H78M12 140H78M12 175H78"/></g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100" viewBox="0 0 150 100"><defs><clipPath id="clip"><rect x="0" y="0" width="145" height="95" rx="10"/></clipPath></defs><g clip-path="url(#clip)"><path d="M24 78C0 78 0 35 30 35C30 0 90 0 99 36C140 18 156 79 120 79Z" fill="#89B9CB" fill-opacity="0.75" stroke="#172A40" stroke-width="3"/></g></svg>'
  ];
  const names=['TEST · Человек','TEST · Лестница','TEST · Облако'];
  const originals=originalSvg.map((svg,i)=>{const n=figma.createNodeFromSvg(svg);n.name=names[i];n.x=i*240;n.y=0;return n;});
  const before=await Promise.all(originals.map(n=>n.exportAsync({format:'SVG_STRING'})));
  await test('Регистрация трёх векторных объектов с происхождением',async()=>{figma.currentPage.selection=originals;await addSelection();check(assets.length===3,'Ожидались три объекта.');check(new Set(assets.map(a=>a.source.illustrationId)).size===3,'Потеряны источники.');});
  if(assets.length===3){
    for(let i=0;i<assets.length;i++){assets[i].name=names[i].replace('TEST · ','');assets[i].tags=i===0?['команда','сотрудничество']:i===1?['рост','развитие']:['мечта'];assets[i].role=i===1?'hero':'support';}persist();
    await test('Поиск компонентов, количества и сборка в Figma',async()=>{await handle({type:'compose',mode:'components',query:'Человек, Лестница × 2, Облако',settings:{width:1080,height:1080,seed:42,layout:'focus'},palette:null});const frame=await active();check(frame.children.length===4,'Потеряны экземпляры.');});
    await test('Повторный SVG с градиентами и обрезкой без растра',async()=>{const frame=await active();const svg=await frame.exportAsync({format:'SVG_STRING',svgIdAttribute:true});check(!/<image\b/i.test(svg),'Экспорт содержит растр.');const back=figma.createNodeFromSvg(svg);back.name='TEST · SVG после повторного импорта';back.x=frame.x;back.y=frame.y+frame.height+120;audit(back);check(back.children.length>0,'SVG пуст после импорта.');exported.push({name:'technical-components.svg',svg});});
    await test('Перекраска fills, strokes и gradient stops',async()=>{const frame=await active();const geometry=frame.children.map(c=>[c.width,c.height,copy(c.relativeTransform)]);await handle({type:'palette',palette:{name:'Test mint',colors:['#172A28','#3E756D','#A8D8CC','#EDF5F2'],background:'#FFFFFF'}});check(JSON.stringify(geometry)===JSON.stringify(frame.children.map(c=>[c.width,c.height,copy(c.relativeTransform)])),'Перекраска изменила размеры.');exported.push({name:'technical-recolored.svg',svg:await frame.exportAsync({format:'SVG_STRING',svgIdAttribute:true})});});
    await test('Восстановление исходных цветов',async()=>{const frame=await active();await handle({type:'palette',palette:null});const painted:string[]=[];for(const child of frame.children)walk(child,n=>{if('fills'in n&&Array.isArray(n.fills))for(const paint of n.fills)if(paint.type==='SOLID')painted.push(rgbHex(paint.color));});check(painted.includes('#315D85'),'Исходная синяя заливка не восстановилась.');});
    await test('Метафора «развитие бизнеса» и вертикальный формат',async()=>{await handle({type:'compose',mode:'metaphor',query:'развитие бизнеса',settings:{width:900,height:1600,seed:43,layout:'diagonal'},palette:null});const frame=await active();check(frame.children.length>0&&frame.height===1600,'Метафора не собрана.');exported.push({name:'technical-metaphor.svg',svg:await frame.exportAsync({format:'SVG_STRING',svgIdAttribute:true})});});
    await test('Ручной поворот, перемещение, дубль и порядок слоёв сохраняются',async()=>{const frame=await active(),c=frame.children[0];if(!('rotation'in c))throw new Error('Узел не поддерживает поворот.');c.rotation=12;c.x+=5;c.y+=10;const duplicate=c.clone();frame.appendChild(duplicate);duplicate.x+=100;frame.insertChild(0,duplicate);const state=snapshot(frame);check(state.placements.length===2,'Дубль не попал в сцену.');check(Math.abs(state.placements[1].rotation)>1,'Поворот потерян.');});
    await test('Сохранение и восстановление JSON-сцены',async()=>{const frame=await active(),saved=snapshot(frame);await handle({type:'load-scene',scene:JSON.parse(JSON.stringify(saved))});const restored=snapshot(await active());check(restored.placements.length===saved.placements.length,'Количество не восстановилось.');check(Math.abs(restored.placements[0].cx-saved.placements[0].cx)<.1,'Положение не восстановилось.');});
    await test('Исходники остались неизменными',async()=>{const after=await Promise.all(originals.map(n=>n.exportAsync({format:'SVG_STRING'})));check(JSON.stringify(before)===JSON.stringify(after),'Исходные SVG изменились.');});
  }
  const report={technicalFixturesOnly:true,figmaVersion:figma.apiVersion,createdAt:new Date().toISOString(),results,passed:results.filter(r=>r.ok).length,total:results.length};
  page.setPluginData('composer:technical-report',JSON.stringify(report));
  await sendState();figma.ui.postMessage({type:'native-test-report',report,exported});
  figma.ui.postMessage({type:report.passed===report.total?'success':'error',message:`Figma API: ${report.passed}/${report.total} проверок. Только технические фикстуры.`});
}

import { palette,settings,normalize,eligibleAssets } from './core.ts';
import {SCHEMES,scheme} from './schemes.ts';
import type { Asset,Palette,Settings } from './core.ts';
import { validateSvg } from './svg.ts';
import {zipSync,strToU8} from 'fflate';
import {initAI} from './ai-ui.ts';
import {inspectSceneRules} from './scene-rules.ts';
import type {SceneRelation} from './scene-rules.ts';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const input=(id:string)=>$(id) as HTMLInputElement;
let assets:Asset[]=[],mode='metaphor',hasScene=false,busy=false,lastSvg='',custom:Palette|null=null,examplesReady=false,aiBusy=false;
const connected=parent!==window;
const presets:Record<string,Palette>=SCHEMES;
const status=(message:string,kind='')=>{$('status').textContent=message;$('status').className=kind;};
function send(message:Record<string,unknown>){
  if(!connected){status('Документ Figma не подключён. Запустите плагин в Figma.','error');return;}
  if(busy){status('Дождитесь завершения текущей операции.');return;}
  parent.postMessage({pluginMessage:message},'*');
}
function run(action:()=>void|Promise<void>){void Promise.resolve().then(action).catch(e=>status(e instanceof Error?e.message:String(e),'error'));}
function cfg():Settings{return settings({width:Number(input('width').value),height:Number(input('height').value),seed:Number(input('seed').value),layout:input('layout').value,detail:input('detail').value,appearanceMode:input('appearance-mode').value,backdrop:input('backdrop').value});}
function currentPalette():Palette|null{const key=input('palette').value,p=key==='custom'?custom:presets[key];if(!p)return null;if(input('backdrop').value!=='none')return p;const {background,...transparent}=p;return transparent;}
function drawPalette(){
  const p=currentPalette(),container=$('swatches');container.replaceChildren();
  if(!p){const span=document.createElement('span');span.className='hint';span.textContent='Цвета объектов сохранятся';container.append(span);return;}
  for(const color of p.colors){const span=document.createElement('span');span.className='swatch';span.style.backgroundColor=color;span.title=color;span.setAttribute('aria-label',color);container.append(span);}
}
function tab(name:string){
  $('compose-panel').hidden=name!=='compose';$('library-panel').hidden=name!=='library';
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>{const selected=b.dataset.tab===name;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
}
function controls(){
  ai.controls(busy||aiBusy,assets.length>0);
  document.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{
    if(b.id==='export-examples'){b.disabled=busy||aiBusy||!examplesReady;return;}
    if(b.dataset.instanceAction){b.disabled=busy||aiBusy;return;}
    const action=['check-scene-rules','create-examples','retry-acceptance','acceptance','compose','variant','apply-plan','add-selection','add-section','export-svg','show-svg','export-bundle','save-scene','reflow','preview-palette','apply-palette','restore-palette','export-catalog'].includes(b.id);
    if(action)b.disabled=busy||aiBusy||(b.hasAttribute('data-scene')&&!hasScene)||((b.id==='compose'||b.id==='apply-plan')&&!assets.length);
  });
  $('empty').hidden=assets.length>0;
}
function renderAssets(){
  const filter=normalize(input('filter').value),list=$('asset-list');list.replaceChildren();
  const filtered=eligibleAssets(assets,cfg()).filter(a=>normalize([a.name,...a.tags,...a.metaphors,...a.synonyms].join(' ')).includes(filter));
  for(const a of filtered){
    const row=document.createElement('div');row.className='asset';
    if(a.thumbnail){const img=document.createElement('img');img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(a.thumbnail);img.alt='';row.append(img);}
    const description=document.createElement('div');description.className='asset-copy';const name=document.createElement('strong');name.textContent=a.name;
    const tags=document.createElement('small');tags.textContent=a.tags.length?a.tags.join(' · '):'Добавьте теги для смыслового поиска';
    const id=document.createElement('button');id.textContent=`${a.detail??'тест'} · ${a.appearance==='background'?'фоновый':'главный'} · добавить в запрос`;id.title='Добавить название предмета';id.onclick=()=>{setMode('components');input('query').value+=(input('query').value?', ':'')+a.name;tab('compose');};
    description.append(name,tags,id);const edit=document.createElement('button');edit.textContent='Описать';edit.className='secondary';edit.onclick=()=>editAsset(a);row.append(description,edit);list.append(row);
  }
  $('library-empty').hidden=filtered.length>0;$('library-empty').textContent=assets.length?'Нет совпадений. Измените поиск.':'Библиотека доступна после запуска плагина в Figma.';
}
function editAsset(a:Asset){
  $('asset-form').hidden=false;
  for(const key of ['id','name','synonyms','tags','metaphors','role']as const)input(`edit-${key}`).value=Array.isArray(a[key])?(a[key]as string[]).join(', '):String(a[key]);
  $('provenance').textContent=`Источник: ${a.source.illustrationName} · узел ${a.source.nodeId} · ${a.width.toFixed(0)} × ${a.height.toFixed(0)} px · ${a.source.capturedAt}`;
  $('asset-form').scrollIntoView({behavior:'auto',block:'start'});input('edit-name').focus();
}
function setMode(value:string){
  mode=value;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>{const selected=b.dataset.mode===value;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
  $('query-label').textContent=value==='metaphor'?'Метафора или заголовок':'Названия компонентов через запятую';
  input('query').placeholder=value==='metaphor'?'Например, «вместе к новым вершинам»':'Например, книга, лампа, монета × 2';
  $('search-hint').textContent=value==='metaphor'?'Локальный смысловой поиск по именам, тегам и метафорам. Без внешней AI-модели.':'Имена и синонимы из библиотеки. Количество: название × 2. Неоднозначности показываются явно.';
}
function download(data:BlobPart,filename:string,mime:string){const url=URL.createObjectURL(new Blob([data],{type:mime}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);}
function compose(){send({type:'compose',query:input('query').value,mode,settings:cfg(),palette:currentPalette()});}
function showRules(relations:SceneRelation[]){$('scene-rules').hidden=!relations.length;$('scene-rule-list').replaceChildren(...relations.map(r=>{const li=document.createElement('li');li.textContent=r.message;if(!r.ok)li.className='rule-warning';return li;}));}
const ai=initAI(()=>({assets,settings:cfg(),query:input('query').value,mode,palette:currentPalette()??SCHEMES.violet}),send,status,value=>{aiBusy=value;controls();});
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab!));
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode!));
document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(b=>b.onclick=()=>{
  const [width,height]=b.dataset.format!.split(',');input('width').value=width;input('height').value=height;
  document.querySelectorAll('[data-format]').forEach(btn=>{btn.classList.toggle('selected',btn===b);btn.setAttribute('aria-pressed',String(btn===b));});
});
for(const id of ['width','height'])input(id).oninput=()=>document.querySelectorAll('[data-format]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
$('compose').onclick=()=>run(compose);
$('check-scene-rules').onclick=()=>send({type:'check-scene-rules'});
$('variant').onclick=()=>run(()=>{input('seed').value=String((cfg().seed+1)%2147483648);compose();});
$('reflow').onclick=()=>run(()=>send({type:'reflow',settings:cfg()}));
$('apply-plan').onclick=()=>run(()=>{const query=input('plan').value;JSON.parse(query);send({type:'compose',mode:'plan',query,settings:cfg(),palette:currentPalette()});});
$('go-library').onclick=()=>tab('library');
$('add-selection').onclick=()=>send({type:'add-selection'});
$('add-section').onclick=()=>send({type:'add-section'});
input('filter').oninput=renderAssets;
$('asset-form').onsubmit=e=>{e.preventDefault();send({type:'update-asset',id:input('edit-id').value,fields:Object.fromEntries(['name','synonyms','tags','metaphors','role'].map(key=>[key,input(`edit-${key}`).value]))});};
$('close-edit').onclick=()=>{$('asset-form').hidden=true;};
input('palette').onchange=drawPalette;
$('palette-file-button').onclick=()=>input('palette-file').click();
input('palette-file').onchange=()=>run(async()=>{
  const file=input('palette-file').files?.[0];if(!file)return;if(file.size>100000)throw new Error('Файл палитры слишком большой.');
  const parsed=scheme(JSON.parse(await file.text()));custom=parsed;
  let option=document.querySelector<HTMLOptionElement>('option[value=custom]');if(!option){option=document.createElement('option');option.value='custom';$('palette').append(option);}option.textContent=parsed.name;input('palette').value='custom';drawPalette();status('Палитра загружена. Можно посмотреть и применить.','success');input('palette-file').value='';
});
$('preview-palette').onclick=()=>send({type:'palette',palette:currentPalette(),backdrop:input('backdrop').value,preview:true});
$('apply-palette').onclick=()=>send({type:'palette',palette:currentPalette(),backdrop:input('backdrop').value});
$('restore-palette').onclick=()=>{input('palette').value='violet';drawPalette();send({type:'palette',palette:currentPalette(),backdrop:input('backdrop').value});};
$('export-svg').onclick=()=>send({type:'export-svg'});
$('show-svg').onclick=()=>send({type:'show-svg'});
$('export-bundle').onclick=()=>send({type:'export-bundle'});
$('close-plugin').onclick=()=>send({type:'close'});
$('acceptance').onclick=()=>send({type:'acceptance'});
$('retry-acceptance').onclick=()=>send({type:'retry-acceptance'});
$('create-examples').onclick=()=>send({type:'create-examples'});
$('export-examples').onclick=()=>send({type:'export-bundle',examplesOnly:true});
input('detail').onchange=renderAssets;
input('appearance-mode').onchange=renderAssets;
$('select-svg').onclick=()=>{const area=$('raw-svg')as HTMLTextAreaElement;area.focus();area.select();};
$('save-scene').onclick=()=>send({type:'save-scene'});
$('export-catalog').onclick=()=>send({type:'export-catalog'});
$('load-scene-button').onclick=()=>input('scene-file').click();
input('scene-file').onchange=()=>run(async()=>{const file=input('scene-file').files?.[0];if(!file)return;if(file.size>1000000)throw new Error('Файл сцены слишком большой.');send({type:'load-scene',scene:JSON.parse(await file.text())});input('scene-file').value='';});
$('reimport').onclick=()=>run(()=>{validateSvg(lastSvg);send({type:'reimport',svg:lastSvg});});
window.onmessage=event=>{
  // Figma injects messages through a bridge; its source is not a stable WindowProxy.
  // Standalone previews do not accept host messages. The plugin has no network access.
  if(!connected)return;
  const message=event.data?.pluginMessage;if(!message||typeof message.type!=='string')return;
  run(()=>{
    switch(message.type){
      case 'ai-settings':if(typeof message.token==='string')ai.restore(message.token);break;
      case 'state':{
        if(Array.isArray(message.scene?.placements)){const catalogue=Array.isArray(message.assets)?message.assets:assets;showRules(inspectSceneRules(message.scene.placements,catalogue));}else $('scene-rules').hidden=true;
        if(Array.isArray(message.assets)){assets=message.assets;renderAssets();}hasScene=message.hasScene;$('count').textContent=String(new Set(assets.map(a=>a.familyId??a.id)).size);$('selection-count').textContent=String(message.selection);$('source-count').textContent=`${message.illustrations} иллюстраций`;controls();
        if(message.instances?.length){$('chosen').hidden=false;const list=$('choices');list.replaceChildren();for(const [index,instance]of message.instances.entries()){const asset=assets.find(a=>a.id===instance.assetId);if(!asset)continue;const row=document.createElement('li');row.textContent=`${asset.name} · ${asset.detail??'тест'} · ${asset.appearance==='background'?'фоновый':'главный'}`;const reason=document.createElement('small');reason.textContent=message.scene?.choices?.find((c:{assetId:string})=>c.assetId===asset.id)?.reason??'';row.append(reason);if(asset.familyId){const toggle=document.createElement('button');toggle.className='text-button';toggle.dataset.instanceAction='true';toggle.disabled=busy;toggle.setAttribute('aria-label',asset.name+', экземпляр '+(index+1)+': '+(asset.appearance==='background'?'сделать главным':'сделать фоновым'));toggle.textContent=asset.appearance==='background'?'Сделать главным':'Сделать фоновым';toggle.onclick=()=>send({type:'set-state',id:instance.id,appearance:asset.appearance==='background'?'main':'background'});row.append(toggle);}list.append(row);}}
        break;
      }
      case 'busy':busy=message.value;controls();if(busy)status('Выполняю…');else if($('status').textContent==='Выполняю…')status('Готово к работе');break;
      case 'scene-rules':if(Array.isArray(message.relations))showRules(message.relations);break;
      case 'success':status(message.message,'success');break;
      case 'progress':status(message.message);break;
      case 'examples-ready':examplesReady=true;controls();break;
      case 'acceptance-report':$('acceptance-report').hidden=false;$('acceptance-report').textContent=JSON.stringify(message.report,null,2);examplesReady=message.report.variantsPassed===40&&message.report.passed===54&&['originalsUnchanged','colorGuard','relativeGuard','sceneScale','manualOperations'].every(k=>message.report[k]===true);controls();break;
      case 'error':status(message.message,'error');break;
      case 'composed':{
        $('chosen').hidden=false;const list=$('choices');list.replaceChildren();
        for(const choice of message.choices){const li=document.createElement('li');li.textContent=`${assets.find(a=>a.id===choice.assetId)?.name??choice.assetId} × ${choice.count}`;const small=document.createElement('small');small.textContent=choice.reason;li.append(small);list.append(li);}break;
      }
      case 'preview':validateSvg(message.svg);$('palette-preview').hidden=false;($('preview-image')as HTMLImageElement).src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(message.svg);break;
      case 'download-svg':validateSvg(message.svg);lastSvg=message.svg;download(lastSvg,message.filename,'image/svg+xml');($('reimport')as HTMLButtonElement).disabled=false;status('SVG проверен: без растра, внешних ресурсов и оборванных ссылок.','success');break;
      case 'show-svg':validateSvg(message.svg);lastSvg=message.svg;$('svg-code').hidden=false;($('svg-code')as HTMLDetailsElement).open=true;input('raw-svg').value=lastSvg;($('reimport')as HTMLButtonElement).disabled=false;$('svg-code').scrollIntoView({block:'start'});status('SVG проверен. Можно выделить код и скопировать.','success');break;
      case 'download-json':download(JSON.stringify(message.data,null,2),message.filename,'application/json');break;
      case 'download-bundle':{
        const files:Record<string,Uint8Array>={};
        const manifest=[];
        for(const [index,item]of message.scenes.entries()){
          validateSvg(item.svg);const prefix=String(index+1).padStart(2,'0');
          files[`${prefix}.svg`]=strToU8(item.svg);files[`${prefix}.scene.json`]=strToU8(JSON.stringify(item.scene,null,2));
          manifest.push({name:item.name,svg:`${prefix}.svg`,scene:`${prefix}.scene.json`,query:item.scene.query,settings:item.scene.settings,palette:item.scene.palette});
        }
        files['manifest.json']=strToU8(JSON.stringify(manifest,null,2));files['catalog.metadata.json']=strToU8(JSON.stringify(message.catalog,null,2));
        files['README.txt']=strToU8('SVG — автономные векторные композиции. JSON — параметры и происхождение. Для восстановления JSON-сцен нужна библиотека в том же Figma-файле. Технические страницы TEST ONLY исключены.');
        const zipped=zipSync(files,{level:6});download(new Uint8Array(zipped).buffer,'compositions.zip','application/zip');status(`Архив подготовлен: ${manifest.length} композиций, SVG проверены.`,'success');break;
      }
      case 'native-test-report':{
        const report=document.createElement('section');report.style.cssText='padding:16px;border:1px solid #c7ceca;margin:12px 0;background:white';
        const heading=document.createElement('h2');heading.textContent=`Figma API · ${message.report.passed}/${message.report.total} проверок`;report.append(heading);
        const note=document.createElement('p');note.className='hint';note.textContent='Только технические фикстуры. Это не библиотека исходных 20 иллюстраций.';report.append(note);
        for(const result of message.report.results){const row=document.createElement('p');row.className='hint';row.textContent=`${result.ok?'PASS':'FAIL'} · ${result.name}${result.detail?' — '+result.detail:''}`;report.append(row);}
        const button=document.createElement('button');button.textContent='Скачать отчёт проверок';button.className='secondary';button.onclick=()=>download(JSON.stringify(message.report,null,2),'native-test-report.json','application/json');report.append(button);
        for(const item of message.exported){validateSvg(item.svg);const b=document.createElement('button');b.textContent=item.name;b.className='text-button';b.onclick=()=>download(item.svg,item.name,'image/svg+xml');report.append(b);}
        document.querySelector('main')!.prepend(report);break;
      }
    }
  });
};
if(!connected){$('preview-notice').hidden=false;status('Панель открыта отдельно от Figma.');}else send({type:'init'});
drawPalette();controls();

import {readFile,writeFile} from 'node:fs/promises';
const read=async name=>readFile('examples/v3/'+name),uri=(buffer,mime)=>'data:'+mime+';base64,'+buffer.toString('base64');
const manifest=JSON.parse(await read('manifest.json')),catalog=JSON.parse(await read('catalog.metadata.json'));
const descriptions=[
 'Лампа направлена на книгу, монеты собраны рядом. Все предметы — главные; позади расположен исходный сиреневый фон.',
 'Лампа и ручка — главные объекты, цветы и пазлы — монохромные фоновые. Под ними расположен исходный персиковый фон.',
 'Фоновая книга объединяет цветные наушники и телефон. Использован исходный бирюзовый фон; пропорции предметов сохранены.'
],titles=['Книга, монеты и лампа','Идеи для команды','Учиться где удобно'];
const examples=[];
for(const [i,m]of manifest.entries()){
 const name=String(i+1).padStart(2,'0'),svg=await read(m.svg),png=await read(name+'.preview.png'),scene=JSON.parse(await read(m.scene)),counts={main:0,background:0};
 for(const p of scene.placements)counts[catalog.find(a=>a.id===p.assetId).appearance]++;
 const paths=(svg.toString().match(/<path\b/g)||[]).length,images=(svg.toString().match(/<image\b/g)||[]).length;
 if(images)throw new Error('Raster image in final SVG');
 examples.push('<article class="example" id="example-'+name+'"><div><span class="number">ПРИМЕР '+name+'</span><h2>'+titles[i]+'</h2><p>'+descriptions[i]+'</p><dl><dt>Формат / детализация</dt><dd>'+m.settings.width+' × '+m.settings.height+' / '+m.settings.detail+'</dd><dt>Цветовая схема</dt><dd>'+m.palette.name+'</dd><dt>Главные / фоновые предметы</dt><dd>'+counts.main+' / '+counts.background+'</dd><dt>Пути / растр в SVG</dt><dd>'+paths+' / '+images+'</dd></dl><p><a class="button primary" data-kind="svg" href="'+uri(svg,'image/svg+xml')+'" download="'+name+'.svg">Скачать SVG</a></p><p class="downloads"><a data-kind="json" href="'+uri(await read(m.scene),'application/json')+'" download="'+name+'.scene.json">Параметры сцены</a><a data-kind="png" href="'+uri(png,'image/png')+'" download="'+name+'.preview.png">Превью PNG</a></p></div><figure><div class="stage"><img data-preview="'+name+'" src="'+uri(png,'image/png')+'" width="'+m.settings.width+'" height="'+m.settings.height+'" alt="'+titles[i]+'"></div><figcaption>Заранее сохранённое PNG-превью. Скачиваемый SVG остаётся векторным.</figcaption></figure></article>');
}
const zipUri=uri(await read('compositions.zip'),'application/zip');
const html=(await readFile('demo/template.html','utf8')).replace('__EXAMPLES__',()=>examples.join('\n')).replace('__ZIP__',()=>zipUri);
await writeFile('demo/index.html',html);await writeFile('demo/showcase.html',html);
console.log('Built static demo/showcase.html and index.html: three pregenerated embedded PNG previews, editable SVG downloads; no client JavaScript.');

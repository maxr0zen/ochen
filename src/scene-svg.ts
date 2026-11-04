import type {Asset,Scene} from './core.ts';
import {SCHEMES,roleColorTable} from './schemes.ts';
import {validateSvg} from './svg.ts';
import {backdropFor,backdropColors,backdropBounds} from './backdrops.ts';
/** Only containers and permitted paints change; all source geometry is copied verbatim. */
export function sceneSvg(scene:Scene,assets:Asset[]):string{
 const ns='http://www.w3.org/2000/svg',doc=document.implementation.createDocument(ns,'svg'),root=doc.documentElement,palette=scene.palette??SCHEMES.violet;
 root.setAttribute('xmlns',ns);root.setAttribute('width',String(scene.settings.width));root.setAttribute('height',String(scene.settings.height));root.setAttribute('viewBox',`0 0 ${scene.settings.width} ${scene.settings.height}`);root.setAttribute('overflow','hidden');
 function source(svg:string,prefix:string,table:Record<string,string>){
  const element=doc.importNode(validateSvg(svg).documentElement,true),ids=Array.from(element.querySelectorAll('[id]')).map(n=>n.id);
  for(const n of [element,...Array.from(element.querySelectorAll('*'))]){if(n.id)n.id=prefix+n.id;for(const attr of Array.from(n.attributes)){let value=attr.value;for(const id of ids){value=value.split('url(#'+id+')').join('url(#'+prefix+id+')');if(value==='#'+id)value='#'+prefix+id;}n.setAttribute(attr.name,value);}
   if(!n.closest('mask,clipPath'))for(const key of ['fill','stroke','stop-color']){const raw=n.getAttribute(key);if(!raw)continue;const color=raw.toLowerCase()==='white'?'#FFFFFF':raw.toUpperCase();if(table[color])n.setAttribute(key,table[color]);}
  }element.setAttribute('x','0');element.setAttribute('y','0');return element;
 }
 if(scene.settings.backdrop==='source'){
  const backdrop=backdropFor(scene.settings,palette),bounds=backdropBounds(scene.settings.width,scene.settings.height,backdrop),element=source(backdrop.svg,'background-',backdropColors(backdrop,palette)),group=doc.createElementNS(ns,'g');
  group.setAttribute('id','scene-background');group.setAttribute('data-source',backdrop.id);group.setAttribute('transform','translate('+bounds.x+' '+bounds.y+') scale('+bounds.scale+')');group.append(element);root.append(group);
 }else if(palette.background||scene.settings.backdrop==='solid'){
  const rect=doc.createElementNS(ns,'rect');rect.setAttribute('id','scene-background-solid');rect.setAttribute('width',String(scene.settings.width));rect.setAttribute('height',String(scene.settings.height));rect.setAttribute('fill',palette.background??palette.backgroundColors![0]);root.append(rect);
 }
 for(const [index,p]of [...scene.placements].sort((a,b)=>a.z-b.z).entries()){
  const a=assets.find(a=>a.id===p.assetId)!;if(!a.thumbnail)throw new Error('Нет исходного SVG для предпросмотра.');
  const element=source(a.thumbnail,'object-'+index+'-',roleColorTable(palette,a.appearance!));element.setAttribute('width',String(a.width));element.setAttribute('height',String(a.height));
  const group=doc.createElementNS(ns,'g');group.setAttribute('id','object-'+index+'-'+a.familyId);group.setAttribute('transform','translate('+p.cx+' '+p.cy+') rotate('+p.rotation+') scale('+p.scale+') translate('+(-a.width/2)+' '+(-a.height/2)+')');group.appendChild(element);root.appendChild(group);
 }
 const svg=new XMLSerializer().serializeToString(root);validateSvg(svg);return svg;
}

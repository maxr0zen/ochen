import { UserError } from './core.ts';
// Parse XML rather than rewriting strings. Used for downloads and round-trip import.
export function validateSvg(svg:string):Document{
  if(svg.length>2000000)throw new UserError('SVG слишком большой: предел 2 МБ.');
  if(/<!DOCTYPE|<!ENTITY/i.test(svg))throw new UserError('SVG с DTD и сущностями не поддерживается.');
  const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw new UserError('Не удалось прочитать SVG.');
  const ids=new Set<string>(),references:string[]=[];
  const allowed=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','radialGradient','stop','clipPath','mask','use','title','desc','metadata']);
  for(const el of Array.from(doc.querySelectorAll('*'))){
    if(!allowed.has(el.localName))throw new UserError(`SVG содержит неподдерживаемый элемент ${el.localName}. Требуется автономный вектор без растра, текста и фильтров.`);
    if(el.id){if(ids.has(el.id))throw new UserError(`SVG содержит повторный id: ${el.id}.`);ids.add(el.id);}
    for(const attr of Array.from(el.attributes)){
      if(/^on/i.test(attr.localName))throw new UserError('SVG содержит обработчики событий.');
      if(attr.localName==='href'){
        if(!attr.value.startsWith('#'))throw new UserError('Внешние ресурсы в SVG запрещены.');references.push(attr.value.slice(1));
      }
      if(/@import|javascript:|data:|https?:|\/\//i.test(attr.value)&&!['xmlns','xmlns:xlink'].includes(attr.name))throw new UserError('SVG содержит внешние ресурсы или встроенные данные.');
      if(/url\s*\(/i.test(attr.value)){
        const urls=[...attr.value.matchAll(/url\s*\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi)];
        if(!urls.length)throw new UserError('Некорректная ссылка url() в SVG.');
        for(const url of urls){if(!url[1].startsWith('#'))throw new UserError('Внешние url() в SVG запрещены.');references.push(url[1].slice(1));}
      }
    }
  }
  for(const ref of references)if(!ids.has(ref))throw new UserError(`SVG ссылается на отсутствующий id: ${ref}.`);
  return doc;
}

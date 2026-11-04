import {UserError,object,text,hex,palette} from './core.ts';
import type {Palette,Appearance} from './core.ts';
export const SCHEMES:Record<string,Palette>={
 violet:{name:'Схема 1 · сиреневая',colors:[],backgroundColors:['#D7CDF5','#AA9BF0','#7864D7','#181817'],objectColors:['#F9ECB0','#F9A3AA','#FFE3E1','#FFFFFF']},
 peach:{name:'Схема 2 · персиковая',colors:[],backgroundColors:['#FDD7B9','#FAC896','#D27532','#181817'],objectColors:['#F9ECB0','#80DADA','#BEEBEB','#FFFFFF']},
 turquoise:{name:'Схема 3 · бирюзовая',colors:[],backgroundColors:['#BEEBEB','#80DADA','#5ABEBE','#181817'],objectColors:['#FFD4F2','#6D7BFC','#B6C6FE','#FFFFFF']},
};
for(const p of Object.values(SCHEMES))p.colors=[...new Set([...p.backgroundColors!,...p.objectColors!])];
export function scheme(value:unknown):Palette{
 const v=object(value);
 const slots=(key:string)=>{const list=v[key];if(!Array.isArray(list)||list.length!==4)throw new UserError(`${key}: нужны четыре HEX-цвета по исходным цветовым ролям.`);return list.map(hex);};
 const backgroundColors=slots('backgroundColors'),objectColors=slots('objectColors');
 const hue=(color:string)=>{const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255),max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;if(delta<.08)return null;let h=max===rgb[0]?(rgb[1]-rgb[2])/delta:max===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4;return(h*60+360)%360;};
 const hues=backgroundColors.map(hue).filter((h):h is number=>h!==null);
 if(hues.some(h=>Math.min(Math.abs(h-hues[0]),360-Math.abs(h-hues[0]))>18))throw new UserError('Фоновые цвета должны быть монохромными: оттенки одного тона и нейтральные цвета.');
 const colors=[...new Set([...backgroundColors,...objectColors])];
 const parsed=palette({name:text(v.name||'Своя схема',80),colors,...(v.background===undefined?{}:{background:v.background})});
 if(parsed.background&&!backgroundColors.includes(parsed.background))throw new UserError('Фон холста может использовать только фоновые цвета схемы.');
 if(v.map!==undefined)throw new UserError('Используйте цветовые роли backgroundColors/objectColors вместо произвольной map.');
 return{...parsed,backgroundColors,objectColors};
}
export function allowedColors(p:Palette,state:Appearance):string[]{return state==='background'?p.backgroundColors!:p.colors;}
export function roleColorTable(p:Palette,state:Appearance):Record<string,string>{
 const target=scheme(p),base=SCHEMES.violet;
 const source=[...base.backgroundColors!,...base.objectColors!],colors=[...target.backgroundColors!,...target.objectColors!];
 const table=Object.fromEntries(source.map((c,i)=>[c,colors[i]]));
 // Masks retain their own paints and are excluded by the caller.
 if(state==='background')for(const c of base.objectColors!)delete table[c];
 return table;
}

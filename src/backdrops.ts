import bundled from '../library/backdrops.json' with {type:'json'};
import type {Palette,Settings} from './core.ts';
import {SCHEMES,scheme} from './schemes.ts';
export const BACKDROPS=bundled.variants;
export function backdropFor(cfg:Settings,p:Palette){
 const target=scheme(p),key=Object.keys(SCHEMES).find(k=>SCHEMES[k].backgroundColors![0]===target.backgroundColors![0])??'violet';
 return BACKDROPS.find(b=>b.detail===cfg.detail&&b.scheme===key)!;
}
export function backdropColors(source:ReturnType<typeof backdropFor>,p:Palette):Record<string,string>{
 const target=scheme(p),colors=target.backgroundColors!,base=SCHEMES[source.scheme].backgroundColors!;
 // The supplied confetti includes white. Map it into the permitted background roles.
 return{...Object.fromEntries(base.map((c,i)=>[c,colors[i]])),[base[0]]:target.background??colors[0],'#FFFFFF':colors[0]};
}
export function backdropBounds(width:number,height:number,source:{width:number;height:number}){
 const scale=Math.max(width/source.width,height/source.height);
 return{scale,x:(width-source.width*scale)/2,y:(height-source.height*scale)/2};
}

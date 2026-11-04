/** Geometry fingerprint, normalized to the object's width. Paints and outer placement are deliberately excluded. */
export type GeometryNode={
  type:string;width:number;height:number;relativeTransform:readonly (readonly number[])[];
  children?:readonly GeometryNode[];opacity?:number;visible?:boolean;isMask?:boolean;clipsContent?:boolean;
  strokeWeight?:unknown;strokeCap?:unknown;strokeJoin?:unknown;cornerRadius?:unknown;
  topLeftRadius?:number;topRightRadius?:number;bottomLeftRadius?:number;bottomRightRadius?:number;
  vectorNetwork?:{vertices:readonly {x:number;y:number}[];segments:readonly {start:number;end:number;tangentStart?:{x:number;y:number};tangentEnd?:{x:number;y:number}}[];regions?:readonly {windingRule:string;loops:readonly (readonly number[])[]}[]};
};
export function geometryData(root:GeometryNode,quantize=false):unknown{
  const base=root.width;if(!Number.isFinite(base)||base<=0)throw new Error('У объекта нет положительной ширины.');
  const rounded=(n:number)=>quantize?Math.round(n*10000)/10000:n;
  const length=(n:unknown)=>typeof n==='number'?rounded(n/base):null;
  const point=(p:{x:number;y:number}|undefined)=>p?[length(p.x),length(p.y)]:null;
  function shape(n:GeometryNode,isRoot=false):unknown{
    const t=n.relativeTransform;
    return {
      type:n.type,width:length(n.width),height:length(n.height),opacity:n.opacity,visible:n.visible,
      mask:n.isMask,clip:n.clipsContent,stroke:length(n.strokeWeight),cap:n.strokeCap,join:n.strokeJoin,
      corners:[n.cornerRadius,n.topLeftRadius,n.topRightRadius,n.bottomLeftRadius,n.bottomRightRadius].map(length),
      transform:isRoot?null:[rounded(t[0][0]),rounded(t[0][1]),length(t[0][2]),rounded(t[1][0]),rounded(t[1][1]),length(t[1][2])],
      vector:n.vectorNetwork?{vertices:n.vectorNetwork.vertices.map(point),segments:n.vectorNetwork.segments.map(s=>[s.start,s.end,point(s.tangentStart),point(s.tangentEnd)]),regions:n.vectorNetwork.regions?.map(r=>[r.windingRule,r.loops])}:null,
      children:n.children?.map(c=>shape(c))
    };
  }
  return shape(root,true);
}
/** Pairwise tolerance avoids unstable hash boundaries after Figma's float32 rescale. */
export function sameGeometry(a:GeometryNode,b:GeometryNode):boolean{
 const equal=(x:unknown,y:unknown):boolean=>{
  if(typeof x==='number'&&typeof y==='number')return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=0.0001;
  if(x===y)return true;
  if(!x||!y||typeof x!=='object'||typeof y!=='object')return false;
  const left=x as Record<string,unknown>,right=y as Record<string,unknown>,keys=Object.keys(left);
  return keys.length===Object.keys(right).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(right,k)&&equal(left[k],right[k]));
 };
 return equal(geometryData(a),geometryData(b));
}
export function geometrySignature(root:GeometryNode):string{
  const data=JSON.stringify(geometryData(root,true));let hash=2166136261;
  for(let i=0;i<data.length;i++)hash=Math.imul(hash^data.charCodeAt(i),16777619);
  return `geometry-v1:${(hash>>>0).toString(16)}`;
}

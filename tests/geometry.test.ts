import test from 'node:test';import assert from 'node:assert/strict';
import {geometrySignature,sameGeometry} from '../src/geometry.ts';import type {GeometryNode} from '../src/geometry.ts';
const shape=():GeometryNode=>({type:'FRAME',width:100,height:200,relativeTransform:[[1,0,10],[0,1,20]],children:[{type:'VECTOR',width:80,height:100,relativeTransform:[[1,0,10],[0,1,20]],strokeWeight:2,vectorNetwork:{vertices:[{x:0,y:0},{x:80,y:100}],segments:[{start:0,end:1,tangentStart:{x:10,y:10}}]}}]});
test('fingerprint ignores outer position and rotation',()=>{const a=shape(),b=shape();b.relativeTransform=[[0,-1,800],[1,0,500]];assert.equal(geometrySignature(a),geometrySignature(b));});
test('fingerprint survives uniform rescale including strokes and vector handles',()=>{
  const a=shape(),b=shape();b.width*=2;b.height*=2;const c=b.children![0];c.width*=2;c.height*=2;c.relativeTransform=[[1,0,20],[0,1,40]];c.strokeWeight=4;
  c.vectorNetwork!.vertices.forEach(p=>{p.x*=2;p.y*=2;});c.vectorNetwork!.segments[0].tangentStart!.x*=2;c.vectorNetwork!.segments[0].tangentStart!.y*=2;
  assert.equal(geometrySignature(a),geometrySignature(b));
});
test('fingerprint detects inner geometry, structure and proportion changes',()=>{
  const a=shape();for(const alter of [(b:GeometryNode)=>{b.height+=10;},(b:GeometryNode)=>{b.children![0].vectorNetwork!.vertices[1].x+=5;},(b:GeometryNode)=>{b.children=[];},(b:GeometryNode)=>{b.children![0].strokeWeight=5;}]){const b=shape();alter(b);assert.notEqual(geometrySignature(a),geometrySignature(b));}
});
test('geometry comparison tolerates float32 rounding across hash buckets, rejects real edits',()=>{
 const a=shape(),b=shape();a.children![0].vectorNetwork!.vertices[1].x=80.004999;
 b.children![0].vectorNetwork!.vertices[1].x=80.005001;
 assert.notEqual(geometrySignature(a),geometrySignature(b));assert.ok(sameGeometry(a,b));
 b.children![0].vectorNetwork!.vertices[1].x+=1;assert.equal(sameGeometry(a,b),false);
});

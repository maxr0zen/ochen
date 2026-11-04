import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import './build.mjs';
const server=createServer(async(req,res)=>{
  if(req.url!=='/'&&req.url!=='/ui.html'){res.writeHead(404);res.end('Not found');return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile('dist/ui.html'));
});
server.listen(4173,'127.0.0.1',()=>console.log('UI preview: http://127.0.0.1:4173 — no Figma document attached'));

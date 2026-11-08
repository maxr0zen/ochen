import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import './build-site.mjs';

const root = process.cwd();
const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.zip':'application/zip'};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (relative !== 'index.html' && !relative.startsWith('web-dist/') && !relative.startsWith('examples/v3/')) {
      response.writeHead(404); response.end('Not found'); return;
    }
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) { response.writeHead(404); response.end(); return; }
    const data = await readFile(path);
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    response.end(data);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
});
server.listen(4175, '127.0.0.1', () => console.log('Site: http://127.0.0.1:4175'));

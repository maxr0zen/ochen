import {build} from 'esbuild';
import {mkdir, readFile, writeFile} from 'node:fs/promises';

await mkdir('web-dist', {recursive:true});
await build({entryPoints:['website/app.ts'], outfile:'web-dist/app.js', bundle:true, minify:true, target:'es2022', format:'iife'});
await build({entryPoints:['website/style.css'], outfile:'web-dist/app.css', minify:true});
await writeFile('index.html', await readFile('website/index.html'));
await writeFile('.nojekyll', '');
console.log('Built static site: index.html, web-dist/ and examples/v3/.');

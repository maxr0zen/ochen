import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {unzipSync} from 'fflate';
const html=await readFile('demo/showcase.html');
assert.ok(!/<script\b/i.test(html.toString()));assert.deepEqual(await readFile('demo/index.html'),html);
await mkdir('output/demo-isolated',{recursive:true});await writeFile('output/demo-isolated/index.html',html);
const server=createServer((req,res)=>{if(req.url!=='/index.html'){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
try{for(const url of [pathToFileURL(resolve('output/demo-isolated/index.html')).href,'http://127.0.0.1:'+server.address().port+'/index.html'])for(const javaScriptEnabled of [true,false]){
 const context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true,javaScriptEnabled}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 assert.equal(await page.locator('img').count(),3);
 for(const name of ['01','02','03']){
  const image=await page.locator('[data-preview="'+name+'"]').evaluate(async img=>{await img.decode();return{width:img.naturalWidth,height:img.naturalHeight,embeddedPNG:img.src.startsWith('data:image/png;base64,')};});
  assert.ok(image.width>0&&image.height>0&&image.embeddedPNG);
  for(const suffix of ['svg','scene.json','preview.png']){
   const file=name+'.'+suffix,pending=page.waitForEvent('download');await page.locator('a[download="'+file+'"]').click();const download=await pending;assert.equal(download.suggestedFilename(),file);assert.deepEqual(await readFile(await download.path()),await readFile('examples/v3/'+file));
  }
  report.push({mode:url.startsWith('file:')?'standalone file':'HTTP serving HTML only',javaScriptEnabled,example:name,...image,downloadsIdentical:true});
 }
 const pending=page.waitForEvent('download');await page.locator('a[download="compositions.zip"]').click();const zip=await pending;assert.equal(Object.keys(unzipSync(new Uint8Array(await readFile(await zip.path())))).filter(k=>k.endsWith('.svg')).length,3);
 assert.deepEqual(errors,[]);if(url.startsWith('file:')&&javaScriptEnabled){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'output/demo-isolated/verified.png',fullPage:true});}await context.close();
}await writeFile('output/demo-isolated/validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}finally{await browser.close();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}

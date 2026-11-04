import {writeFile,mkdir} from 'node:fs/promises';
import {loadConfig,createAiServer} from '../server/ai-server.ts';
const config=await loadConfig();let upstreamCalls=0;
const noExternal:typeof fetch=async()=>{upstreamCalls++;throw new Error('Внешние запросы запрещены в локальной проверке.');};
const server=await createAiServer(config,noExternal);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
try{const address=server.address()as {port:number},base=`http://127.0.0.1:${address.port}`,headers={Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'};
 const unauthorized=await fetch(base+'/health'),health=await fetch(base+'/health',{headers}),status=await health.json();let missingKeyStatus:number|null=null;
 if(!config.apiKey){const result=await fetch(base+'/plan',{method:'POST',headers,body:'{}'});missingKeyStatus=result.status;}
 if(unauthorized.status!==401||health.status!==200||(!config.apiKey&&missingKeyStatus!==503)||upstreamCalls!==0)throw new Error('Локальная проверка не прошла.');
 const report={createdAt:new Date().toISOString(),provider:status.provider,model:status.model,apiKeyConfigured:status.configured,healthStatus:health.status,unauthorizedStatus:unauthorized.status,missingKeyStatus,upstreamCalls,liveApiVerified:false};
 await mkdir('output',{recursive:true});await writeFile('output/ai-connection-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}

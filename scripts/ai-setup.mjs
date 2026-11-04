import {readFile,writeFile} from 'node:fs/promises';import {randomBytes} from 'node:crypto';
let existing;try{existing=await readFile('.env.local','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
if(existing!==undefined){console.log('.env.local уже существует; настройки сохранены.');}
else{const template=await readFile('.env.example','utf8');await writeFile('.env.local',template.replace('AI_CONNECTION_TOKEN=','AI_CONNECTION_TOKEN='+randomBytes(24).toString('hex')),{flag:'wx',mode:0o600});console.log('Создан .env.local. Укажите ключ выбранного провайдера; сам ключ в плагин и чат вводить не нужно.');}

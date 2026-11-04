import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',timeout:30000,workers:1,
  use:{channel:'chrome',headless:true,baseURL:'http://127.0.0.1:4173',viewport:{width:480,height:900},screenshot:'only-on-failure'},
  reporter:[['list'],['json',{outputFile:'output/playwright/results.json'}]],
  webServer:{command:'node scripts/serve.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:true}
});

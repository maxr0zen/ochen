import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/site', timeout:30000, workers:1,
  use:{channel:'chrome', headless:true, baseURL:'http://127.0.0.1:4175', viewport:{width:1440, height:1000}, screenshot:'only-on-failure'},
  reporter:'list',
  webServer:{command:'node scripts/serve-site.mjs', url:'http://127.0.0.1:4175', reuseExistingServer:true},
});

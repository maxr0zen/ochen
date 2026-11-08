import {test, expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {readFile, mkdir} from 'node:fs/promises';

async function savedScene(page: Page) {
  const pending = page.waitForEvent('download');
  await page.locator('#save-scene').click();
  const file = await pending;
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

test('local generator supports both query modes, backgrounds and vector export without API requests', async ({page}) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (!request.url().startsWith('http://127.0.0.1:4175') && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) external.push(request.url());});
  await page.goto('/');
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(4);
  await expect(page.locator('#library button')).toHaveCount(10);
  await page.locator('[data-mode=metaphor]').click();
  await page.locator('#generate').click();
  await expect(page.locator('#status')).toContainText('Собрано предметов');
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(4);
  await page.locator('#appearance').selectOption('mixed');
  const scene = await savedScene(page);
  expect(new Set(scene.placements.map((p: any) => p.assetId.split(':')[2])).size).toBe(2);
  await page.locator('#backdrop').selectOption('none');
  await expect(page.locator('#stage #scene-background')).toHaveCount(0);
  await page.locator('#backdrop').selectOption('source');
  await page.locator('[data-palette=peach]').click();
  await expect(page.locator('#stage #scene-background')).toHaveAttribute('data-source', 'backdrop:peach:S');
  const pending = page.waitForEvent('download'); await page.locator('#export-svg').click();
  const download = await pending, svg = await readFile((await download.path())!, 'utf8');
  expect(svg).toContain('scene-background'); expect(svg).not.toMatch(/<(image|text|script)\b/);
  expect(svg).not.toContain('editor-selection'); expect(svg).not.toContain('data-instance-id');
  await page.locator('#query').fill('космический слон');
  await page.locator('#generate').click(); await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(4);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('dragging changes one placement, persists and exports source geometry; history and editing work', async ({page}) => {
  await page.goto('/');
  await page.getByTitle('Добавить: Монета', {exact:true}).click();
  const before = await savedScene(page), coin = before.placements.at(-1);
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const point = await page.locator('#stage > svg').evaluate((svg, p: any) => {const matrix = (svg as SVGSVGElement).getScreenCTM()!; const result = new DOMPoint(p.cx,p.cy).matrixTransform(matrix); return {x:result.x,y:result.y};}, coin);
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 45, point.y + 28, {steps:8}); await page.mouse.up();
  const after = await savedScene(page), moved = after.placements.find((p: any) => p.instanceId === coin.instanceId);
  expect(Math.abs(moved.cx - coin.cx)).toBeGreaterThan(15);
  expect(moved.scale).toBe(coin.scale); expect(moved.assetId).toBe(coin.assetId);
  expect(after.placements.filter((p: any) => p.instanceId !== coin.instanceId)).toEqual(before.placements.filter((p: any) => p.instanceId !== coin.instanceId));
  await page.locator('#undo').click();
  expect((await savedScene(page)).placements).toEqual(before.placements);
  await page.locator('#redo').click();
  expect((await savedScene(page)).placements).toEqual(after.placements);
  await page.reload(); expect((await savedScene(page)).placements).toEqual(after.placements);
  await page.locator('#layers button').first().click();
  await page.locator('#duplicate').click(); await expect(page.locator('#stage [data-instance-id]')).toHaveCount(6);
  await page.locator('#object-state').selectOption('background');
  await expect(page.locator('#object-state')).toHaveValue('background');
  await page.locator('#backward').click(); await page.locator('#delete').click();
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(5);
  await page.locator('#clear').click(); await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#export-svg')).toBeDisabled();
  await page.getByTitle('Добавить: Книга', {exact:true}).click();
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(1);
});

test('examples, saved projects and palette imports work and layouts fit desktop and mobile', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-example="1"]').click();
  await expect(page.locator('#detail')).toHaveValue('L');
  await expect(page.locator('#stage #scene-background')).toHaveAttribute('data-source','backdrop:peach:L');
  await expect(page.locator('[data-mode=metaphor]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#variant').click();
  await expect(page.locator('#status')).not.toHaveClass(/error/);
  const saved = await savedScene(page);
  await page.locator('#clear').click();
  await page.locator('#scene-file').setInputFiles({name:'project.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(saved))});
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(4);
  await page.locator('#palette-file').setInputFiles({name:'palette.json', mimeType:'application/json', buffer:await readFile('palettes/ink-mint.json')});
  await expect(page.locator('#status')).toContainText('Цветовая схема применена');
  await page.locator('#scene-file').setInputFiles({name:'invalid.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify({...saved,placements:[{...saved.placements[0],assetId:'made-up'}]}))});
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(4);
  await page.locator('[data-example="0"]').click();
  await page.locator('.example-card img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  await mkdir('output/site', {recursive:true});
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`output/site/site-${width}.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
});

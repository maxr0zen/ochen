import {test, expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {readFile, mkdir} from 'node:fs/promises';

async function savedScene(page: Page) {
  const project = page.locator('.project-fold');
  if (await project.getAttribute('open') === null) await project.locator('summary').click();
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
  await expect(page.locator('#appearance')).toBeHidden();
  await page.locator('.format-settings > summary').click();
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
  await expect(page.locator('#selection')).toBeHidden();
  if (!(await page.locator('#library').isVisible())) await page.getByText('Добавить предмет', {exact:true}).click();
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
  await page.locator('.layer-fold > summary').click();
  await page.locator('#layers button').first().click();
  await page.locator('#duplicate').click(); await expect(page.locator('#stage [data-instance-id]')).toHaveCount(6);
  await page.getByRole('button', {name:'Сделать фоновым'}).click();
  await expect(page.locator('#object-state')).toHaveText('Сделать обычным');
  await page.locator('#backward').click(); await page.locator('#delete').click();
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(5);
  await page.locator('#clear').click(); await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#export-svg')).toBeDisabled();
  if (!(await page.locator('#library').isVisible())) await page.getByText('Добавить предмет', {exact:true}).click();
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

test('suggestions and numeric placement edits work with scene history', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name:'Книга, лампа', exact:true}).click();
  await expect(page.locator('#query')).toHaveValue('Книга, лампа');
  await page.locator('#generate').click();
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(2);
  await expect(page.locator('#selection')).toBeHidden();
  if (!(await page.locator('#library').isVisible())) await page.getByText('Добавить предмет', {exact:true}).click();
  await page.getByTitle('Добавить: Монета', {exact:true}).click();
  await page.getByText('Размер и положение', {exact:true}).click();
  const input = page.locator('#center-x');
  const before = Number(await input.inputValue());
  await input.fill(String(before + 15));
  await input.press('Enter');
  await expect(input).toHaveValue(String(before + 15));
  await page.locator('#undo').click();
  await expect(input).toHaveValue(String(before));
  await page.locator('#variant').click();
  await expect(page.locator('#stage [data-instance-id]')).toHaveCount(3);
  await page.locator('[data-mode=metaphor]').click();
  await page.getByRole('button', {name:'Семейный бюджет', exact:true}).click();
  await page.locator('#generate').click();
  await expect(page.locator('#status')).toContainText('Собрано предметов');
});

test('scale and rotate a single object with canvas handles and round-trip its transforms', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#selection')).toBeHidden();
  if (!(await page.locator('#library').isVisible())) await page.getByText('Добавить предмет', {exact:true}).click();
  await page.getByTitle('Добавить: Монета', {exact:true}).click();
  const before = await savedScene(page);
  const start = before.placements.at(-1);
  const corner = page.locator('[data-handle=scale]').last();
  await corner.scrollIntoViewIfNeeded();
  async function centre(locator: typeof corner) {
    const box = (await locator.boundingBox())!;
    return {x:box.x + box.width/2, y:box.y + box.height/2};
  }
  const at = await centre(corner);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 22, at.y + 16, {steps:4});
  await page.mouse.up();
  const resized = await savedScene(page);
  expect(resized.placements.at(-1).scale).toBeGreaterThan(start.scale);
  expect(resized.placements.slice(0,-1)).toEqual(before.placements.slice(0,-1));
  const knob = page.locator('[data-handle=rotate]');
  await knob.scrollIntoViewIfNeeded();
  const turn = await centre(knob);
  await page.mouse.move(turn.x,turn.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(turn.x+55,turn.y+20,{steps:5});
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const rotated = await savedScene(page);
  expect(rotated.placements.at(-1).rotation).not.toBe(start.rotation);
  expect(rotated.placements.at(-1).rotation % 15).toBe(0);
  await page.locator('#undo').click();
  expect((await savedScene(page)).placements).toEqual(resized.placements);
  await page.locator('#redo').click();
  await page.reload();
  expect((await savedScene(page)).placements).toEqual(rotated.placements);
  const pending = page.waitForEvent('download');
  await page.locator('#export-svg').click();
  const svg = await readFile((await (await pending).path())!, 'utf8');
  expect(svg).toContain(`scale(${rotated.placements.at(-1).scale})`);
  expect(svg).not.toContain('data-handle');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.layer-fold > summary').click();
  await page.locator('#layers button').first().click();
  await corner.scrollIntoViewIfNeeded();
  const finger = await centre(corner);
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:finger.x+18,y:finger.y+10}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect((await savedScene(page)).placements.at(-1).scale).toBeGreaterThan(rotated.placements.at(-1).scale);
});


test('right rail inserts a background asset and changes its role without losing transforms', async ({page}) => {
  await page.goto('/');
  const canvas = (await page.locator('.canvas-panel').boundingBox())!;
  const rail = (await page.locator('.object-panel').boundingBox())!;
  expect(rail.x).toBeGreaterThanOrEqual(canvas.x + canvas.width - 1);
  await page.getByRole('button', {name:'Фоновый', exact:true}).click();
  await page.getByTitle('Добавить: Книга', {exact:true}).click();
  const before = (await savedScene(page)).placements;
  const background = before.at(-1);
  expect(background.assetId).toContain(':background');
  expect(background.z).toBe(0);
  await page.getByRole('button', {name:'Сделать обычным'}).click();
  const ordinary = (await savedScene(page)).placements.at(-1);
  expect(ordinary).toEqual({...background, assetId:background.assetId.replace(':background', ':main'), z:before.length-1});
  await page.locator('#undo').click();
  expect((await savedScene(page)).placements).toEqual(before);
  await page.locator('#clear').click();
  await page.getByTitle('Добавить: Книга', {exact:true}).click();
  expect((await savedScene(page)).settings.appearanceMode).toBe('background');
});

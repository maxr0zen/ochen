import {compose, direct, metaphor, eligibleAssets, resolveVariants, settings, validateScene, rotatedBounds, variant} from '../src/core.ts';
import type {Asset, Scene, Settings, Placement, Palette} from '../src/core.ts';
import {SCHEMES, scheme} from '../src/schemes.ts';
import {sceneSvg} from '../src/scene-svg.ts';
import {inspectSceneRules} from '../src/scene-rules.ts';
import bundle from '../library/bundle.json';
import metadata from '../examples/v3/catalog.metadata.json';
import exampleOne from '../examples/v3/01.scene.json';
import exampleTwo from '../examples/v3/02.scene.json';
import exampleThree from '../examples/v3/03.scene.json';

const assets: Asset[] = (metadata as Asset[]).map(asset => ({
  ...asset,
  thumbnail: bundle.variants.find(item => item.family === asset.familyId && item.detail === asset.detail && item.state === asset.appearance)!.svg,
}));
const examples = [exampleOne, exampleTwo, exampleThree];
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => element<HTMLInputElement>(id);
const stage = element('stage');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const STORAGE = 'socheta-web-scene-v1';
let scene: Scene | null = null;
let selected: string | null = null;
type InputMode = 'components' | 'metaphor';
let mode: InputMode = 'components';
let config = settings({width:1080, height:1080, seed:42, layout:'focus', detail:'S', appearanceMode:'main', backdrop:'source'});
let colors = clone(SCHEMES.violet);
type Snapshot = {scene: Scene | null; selected: string | null; config: Settings; colors: Palette; mode: InputMode; query: string};
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
let drag: {pointer: number; id: string; action: 'move' | 'scale' | 'rotate'; x: number; y: number; original: Placement; before: Snapshot; moved: boolean} | null = null;

function notify(message: string, error = false) {
  element('status').textContent = message;
  element('status').classList.toggle('error', error);
}
function run(action: () => void | Promise<void>) {
  Promise.resolve().then(action).catch(error => notify(error instanceof Error ? error.message : 'Не удалось выполнить действие.', true));
}
function snapshot(): Snapshot { return clone({scene, selected, config, colors, mode, query:field('query').value}); }
function remember(before = snapshot()) {
  undoStack.push(before);
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
}
function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify({scene, config, colors, mode, query:field('query').value})); }
  catch { /* Editing and export remain available when browser storage is full. */ }
}
function checked(value: unknown): Scene {
  const next = validateScene(value, assets, {allowIndividualScale:true});
  next.palette = scheme(next.palette ?? SCHEMES.violet);
  if (next.settings.backdrop === 'none') delete next.palette.background;
  return next;
}
function commit(next: Scene | null, selection = selected, message = 'Композиция обновлена.') {
  const validated = next ? checked(next) : null;
  remember();
  scene = validated;
  selected = validated?.placements.some(p => p.instanceId === selection) ? selection : null;
  if (validated) { config = clone(validated.settings); colors = clone(validated.palette!); }
  persist(); render(); notify(message);
}
function restore(value: Snapshot) {
  scene = value.scene; selected = value.selected; config = value.config; colors = value.colors;
  setMode(value.mode); field('query').value = value.query;
  persist(); render(); notify('Действие отменено или восстановлено.');
}
function recount(draft: Scene) {
  const counts = new Map<string, number>();
  for (const p of draft.placements) counts.set(p.assetId, (counts.get(p.assetId) ?? 0) + 1);
  draft.choices = [...counts].map(([assetId, count]) => ({assetId, count, reason:'Композиция в редакторе'}));
}
function change(edit: (draft: Scene) => void, message: string, selection = selected) {
  if (!scene) return;
  const draft = clone(scene);
  edit(draft); recount(draft); commit(draft, selection, message);
}
function currentPlacement() { return scene?.placements.find(p => p.instanceId === selected); }
function assetOf(p: Placement) { return assets.find(a => a.id === p.assetId)!; }
function transform(p: Placement) {
  const a = assetOf(p);
  return `translate(${p.cx} ${p.cy}) rotate(${p.rotation}) scale(${p.scale}) translate(${-a.width / 2} ${-a.height / 2})`;
}
function constrain(p: Placement, cfg: Settings) {
  const a = assetOf(p), bounds = rotatedBounds(a.width * p.scale, a.height * p.scale, p.rotation);
  const x = Math.min(bounds.width / 2, cfg.width / 2), y = Math.min(bounds.height / 2, cfg.height / 2);
  p.cx = Math.max(x, Math.min(cfg.width - x, p.cx));
  p.cy = Math.max(y, Math.min(cfg.height - y, p.cy));
}
function readConfig(): Settings {
  const format = field('format').value;
  const [width, height] = format === 'custom' ? [config.width, config.height] : format.split(',').map(Number);
  return settings({...config, width, height, detail:field('detail').value, layout:field('layout').value, appearanceMode:field('appearance').value, backdrop:field('backdrop').value});
}
function makeScene(cfg: Settings): Scene {
  const query = field('query').value.trim();
  const pool = eligibleAssets(assets, cfg);
  const requested = mode === 'components' ? direct(query, pool) : metaphor(query, pool);
  const choices = resolveVariants(requested, assets, cfg);
  return checked({version:1, query, settings:cfg, palette:colors, choices, placements:compose(choices, assets, cfg)});
}
function generate() {
  const cfg = readConfig();
  const next = makeScene(cfg);
  commit(next, null, `Собрано предметов — ${next.placements.length}. Их можно перемещать на холсте.`);
}
function reflow(preserve: boolean) {
  const cfg = readConfig();
  if (!scene) { config = cfg; render(); persist(); return; }
  const choices = resolveVariants(scene.choices, assets, cfg, preserve);
  commit({...clone(scene), settings:cfg, choices, placements:compose(choices, assets, cfg)}, null, 'Композиция пересобрана под новые настройки.');
}
function download(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function previewSource(a: Asset) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(a.thumbnail!); }
function inferMode(next: Scene): InputMode {
  try { direct(next.query, eligibleAssets(assets, next.settings)); return 'components'; }
  catch { return 'metaphor'; }
}
function setMode(next: InputMode) {
  mode = next;
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String((button as HTMLElement).dataset.mode === mode)));
  element('query-label').textContent = mode === 'components' ? 'Названия через запятую' : 'Метафора или заголовок';
  const phrases = mode === 'components'
    ? ['Книга, лампа', 'Кошелёк, монета × 2']
    : ['Идеи для команды', 'Семейный бюджет'];
  const suggestions = phrases.map(phrase => {
    const button = document.createElement('button');
    button.textContent = phrase;
    button.onclick = () => {
      field('query').value = phrase;
      field('query').focus();
    };
    return button;
  });
  element('suggestions').replaceChildren(...suggestions);
  element('query-hint').textContent = mode === 'components' ? 'Можно указать количество, например «монета × 2».' : 'Подбор по смыслу. Попробуйте «Идеи для команды».';
}

function renderSelection() {
  stage.querySelector('#editor-selection')?.remove();
  const p = currentPlacement();
  if (!p || !scene) return;
  const svg = stage.querySelector('svg')!;
  const pixels = svg.getScreenCTM()?.a;
  if (!pixels) return;
  const asset = assetOf(p);
  const halfWidth = asset.width * p.scale / 2, halfHeight = asset.height * p.scale / 2;
  const ns = 'http://www.w3.org/2000/svg';
  const frame = document.createElementNS(ns, 'g');
  frame.id = 'editor-selection';
  frame.setAttribute('transform', `translate(${p.cx} ${p.cy}) rotate(${p.rotation})`);
  function shape(tag: string, attrs: Record<string, string | number>) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    frame.append(node);
    return node;
  }
  shape('rect', {x:-halfWidth, y:-halfHeight, width:halfWidth*2, height:halfHeight*2});
  function handle(action: 'scale' | 'rotate', x: number, y: number, cursor: string) {
    const radius = (action === 'rotate' ? 5 : 4) / pixels!;
    if (action === 'rotate') shape('circle', {cx:x, cy:y, r:radius, class:'knob'});
    else shape('rect', {x:x-radius, y:y-radius, width:2*radius, height:2*radius, class:'knob'});
    const hit = shape('circle', {cx:x, cy:y, r:13/pixels!, 'data-handle':action});
    hit.style.cursor = cursor;
    const title = document.createElementNS(ns, 'title');
    title.textContent = action === 'rotate' ? 'Повернуть предмет' : 'Изменить размер от центра';
    hit.append(title);
  }
  for (const signX of [-1, 1]) for (const signY of [-1, 1]) {
    const diagonal = Math.atan2(signY*halfHeight, signX*halfWidth) + p.rotation*Math.PI/180;
    const cursors = ['ew-resize','nwse-resize','ns-resize','nesw-resize'];
    handle('scale', signX*halfWidth, signY*halfHeight, cursors[(Math.round(diagonal/(Math.PI/4))+8)%4]);
  }
  const angle = p.rotation * Math.PI / 180;
  const offset = halfHeight + 26/pixels;
  const fits = (y: number) => {
    const xOnSheet = p.cx - Math.sin(angle)*y, yOnSheet = p.cy + Math.cos(angle)*y;
    const pad = 6/pixels;
    return xOnSheet >= pad && xOnSheet <= config.width-pad && yOnSheet >= pad && yOnSheet <= config.height-pad;
  };
  const rotationY = fits(-offset) ? -offset : fits(offset) ? offset : -Math.max(0, halfHeight - 18/pixels);
  shape('line', {x1:0, y1:rotationY > 0 ? halfHeight : -halfHeight, x2:0, y2:rotationY});
  handle('rotate', 0, rotationY, 'grab');
  svg.append(frame);
}
function renderInspector() {
  const p = currentPlacement();
  element('selection').hidden = !p;
  element('delete').hidden = !p;

  if (p) {
    const a = assetOf(p);
    element('selected-name').textContent = a.name;
    element('selected-detail').textContent = `${a.detail} · исходный предмет`;
    element<HTMLImageElement>('selected-preview').src = previewSource(a);
    field('object-state').value = a.appearance!;
    field('center-x').value = String(Number(p.cx.toFixed(2)));
    field('center-y').value = String(Number(p.cy.toFixed(2)));
    field('object-width').value = String(Number((a.width * p.scale).toFixed(1)));
    field('rotation').value = String(p.rotation);
    element('rotation-value').textContent = `${Math.round(p.rotation)}°`;
  }
  const list = element('layers'); list.replaceChildren();
  for (const p of [...(scene?.placements ?? [])].sort((a,b) => b.z - a.z)) {
    const a = assetOf(p), li = document.createElement('li'), button = document.createElement('button');
    button.className = 'layer' + (p.instanceId === selected ? ' selected' : '');
    button.setAttribute('aria-pressed', String(p.instanceId === selected));
    const image = document.createElement('img'); image.src = previewSource(a); image.alt = '';
    const text = document.createElement('span'), name = document.createElement('strong'), state = document.createElement('small');
    name.textContent = a.name; state.textContent = a.appearance === 'main' ? 'Главный' : 'Фоновый';
    text.append(name, state); button.append(image, text);
    button.onclick = () => { selected = p.instanceId; renderInspector(); renderSelection(); stage.focus({preventScroll:true}); };
    li.append(button); list.append(li);
  }
  element('layer-count').textContent = String(scene?.placements.length ?? 0);
  element('relations').replaceChildren();
  const relations = scene ? inspectSceneRules(scene.placements, assets) : [];
  if (!relations.length) {
    const li = document.createElement('li'); li.textContent = 'Для этих предметов специальных связей нет.'; element('relations').append(li);
  }
  for (const relation of relations) {
    const li = document.createElement('li'); li.textContent = relation.message;
    if (!relation.ok) li.className = 'warning';
    element('relations').append(li);
  }
}
function renderLibrary() {
  const container = element('library'); container.replaceChildren();
  for (const a of assets.filter(a => a.detail === config.detail && a.appearance === 'main')) {
    const button = document.createElement('button'); button.className = 'library-item'; button.title = `Добавить: ${a.name}`;
    const img = document.createElement('img'); img.src = previewSource(a); img.alt = ''; img.draggable = false;
    const name = document.createElement('span'); name.textContent = a.name;
    const plus = document.createElement('i'); plus.textContent = '+'; plus.setAttribute('aria-hidden', 'true');
    button.append(img, name, plus);
    button.onclick = () => run(() => {
      addAsset(a);
      stage.scrollIntoView({block:'center', behavior:'instant'});
    });
    container.append(button);
  }
}
function render() {
  const [w, h] = [config.width, config.height];
  stage.style.aspectRatio = `${w} / ${h}`;
  stage.style.setProperty('--canvas-ratio', String(w / h));
  element('canvas-size').textContent = `${w} × ${h}`;
  element('object-count').textContent = `Предметов — ${scene?.placements.length ?? 0}`;
  element('empty').hidden = !!scene; stage.style.visibility = scene ? 'visible' : 'hidden';
  if (scene) {
    stage.innerHTML = sceneSvg(scene, assets);
    const placements = [...scene.placements].sort((a,b) => a.z - b.z);
    const groups = [...stage.querySelector('svg')!.children].filter(n => n.id.startsWith('object-'));
    groups.forEach((group, i) => group.setAttribute('data-instance-id', placements[i].instanceId));
  } else stage.replaceChildren();
  field('format').value = [...element<HTMLSelectElement>('format').options].some(o => o.value === `${w},${h}`) ? `${w},${h}` : 'custom';
  field('detail').value = config.detail!; field('layout').value = config.layout;
  field('appearance').value = config.appearanceMode!; field('backdrop').value = config.backdrop!;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-palette]')) {
    button.setAttribute('aria-pressed', String(SCHEMES[button.dataset.palette!].colors.join() === colors.colors.join()));
  }
  element('palette-name').textContent = colors.name.replace(/^Схема \d · /, '');
  element('format-summary').textContent = `${config.detail} · ${element('palette-name').textContent}`;
  element<HTMLButtonElement>('undo').disabled = !undoStack.length;
  element<HTMLButtonElement>('redo').disabled = !redoStack.length;
  for (const id of ['export-svg','save-scene','variant']) element<HTMLButtonElement>(id).disabled = !scene;
  renderInspector(); renderLibrary(); renderSelection();
}
function addAsset(a: Asset) {
  if ((scene?.placements.length ?? 0) >= 12) throw Error('На холсте может быть до 12 предметов. Удалите один, чтобы добавить новый.');
  const cfg = scene?.settings ?? config;
  const target = variant(a, assets, cfg.detail!, cfg.appearanceMode === 'background' ? 'background' : 'main');
  if (!scene) {
    const choices = [{assetId:target.id, count:1, reason:'Добавлен из библиотеки'}];
    const placements = compose(choices, assets, cfg);
    commit({version:1, query:target.name, settings:cfg, choices, placements, palette:colors}, placements[0].instanceId, 'Предмет добавлен. Перетащите его в нужное место.');
    return;
  }
  const next = clone(scene), id = `manual-${crypto.randomUUID()}`;
  const p: Placement = {assetId:target.id, instanceId:id, cx:cfg.width / 2, cy:cfg.height / 2, rotation:0, scale:next.placements[0].scale, z:next.placements.length};
  constrain(p, cfg); next.placements.push(p); recount(next); commit(next, id, `${target.name} добавлен на холст.`);
}
function removeSelected() {
  if (!selected || !scene) return;
  if (scene.placements.length === 1) { commit(null, null, 'Холст очищен.'); return; }
  change(draft => {
    draft.placements = draft.placements.filter(p => p.instanceId !== selected);
    draft.placements.sort((a,b) => a.z - b.z).forEach((p,i) => p.z = i);
  }, 'Предмет удалён.', null);
}
function duplicateSelected() {
  const p = currentPlacement(); if (!p || !scene) return;
  if (scene.placements.length >= 12) throw Error('На холсте уже 12 предметов.');
  const id = `copy-${crypto.randomUUID()}`;
  change(draft => {
    const copy = {...p, instanceId:id, cx:p.cx + 30, cy:p.cy + 30, z:draft.placements.length};
    constrain(copy, draft.settings); draft.placements.push(copy);
  }, 'Копия предмета добавлена.', id);
}
function reorder(direction: number) {
  if (!selected) return;
  change(draft => {
    const list = draft.placements.sort((a,b) => a.z - b.z), index = list.findIndex(p => p.instanceId === selected), other = index + direction;
    if (other >= 0 && other < list.length) [list[index], list[other]] = [list[other], list[index]];
    list.forEach((p,i) => p.z = i);
  }, 'Порядок слоёв изменён.');
}
function svgPoint(event: PointerEvent) {
  const matrix = stage.querySelector('svg')?.getScreenCTM();
  if (!matrix) throw Error('Холст пока не готов.');
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
}
stage.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !scene || drag) return;
  const handle = (event.target as Element).closest('[data-handle]')?.getAttribute('data-handle');
  const action = handle === 'scale' || handle === 'rotate' ? handle : 'move';
  const group = (event.target as Element).closest('[data-instance-id]');
  if (!group && action === 'move') { selected = null; renderInspector(); renderSelection(); return; }
  if (group) selected = group.getAttribute('data-instance-id');
  const p = currentPlacement()!, point = svgPoint(event);
  drag = {pointer:event.pointerId, id:p.instanceId, x:point.x, y:point.y, action, original:{...p}, before:snapshot(), moved:false};
  stage.setPointerCapture(event.pointerId); stage.focus({preventScroll:true});
  renderInspector(); renderSelection(); event.preventDefault();
});
stage.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId || !scene) return;
  const point = svgPoint(event), p = scene.placements.find(p => p.instanceId === drag!.id)!;
  if (Math.hypot(point.x - drag.x, point.y - drag.y) < 1 && !drag.moved) return;
  drag.moved = true; stage.classList.add('dragging');
  const start = drag.original;
  p.cx = start.cx; p.cy = start.cy;
  const dx = point.x - start.cx, dy = point.y - start.cy;
  const initialX = drag.x - start.cx, initialY = drag.y - start.cy;
  if (drag.action === 'move') {
    p.cx += point.x - drag.x; p.cy += point.y - drag.y;
  } else if (drag.action === 'scale') {
    const distance = Math.max(0.001, Math.hypot(initialX, initialY));
    resizePlacement(p, start.scale * Math.hypot(dx, dy) / distance, scene.settings);
  } else {
    const delta = Math.atan2(dy, dx) - Math.atan2(initialY, initialX);
    const degrees = start.rotation + delta * 180 / Math.PI;
    p.rotation = ((Math.round(degrees / (event.shiftKey ? 15 : 1)) * (event.shiftKey ? 15 : 1) + 720 + 180) % 360) - 180;
  }
  constrain(p, scene.settings);
  field('object-width').value = String(Number((assetOf(p).width*p.scale).toFixed(1)));
  field('rotation').value = String(p.rotation);
  element('rotation-value').textContent = `${Math.round(p.rotation)}°`;
  const group = [...stage.querySelectorAll('[data-instance-id]')].find(n => n.getAttribute('data-instance-id') === p.instanceId);
  group?.setAttribute('transform', transform(p)); renderSelection();
});
function endDrag(cancel = false) {
  if (!drag) return;
  const current = drag; drag = null; stage.classList.remove('dragging');
  if (stage.hasPointerCapture(current.pointer)) stage.releasePointerCapture(current.pointer);
  if (cancel) { restore(current.before); return; }
  if (current.moved) { remember(current.before); persist(); render(); notify('Положение предмета сохранено.'); }
}
stage.addEventListener('pointerup', event => { if (drag?.pointer === event.pointerId) endDrag(); });
stage.addEventListener('pointercancel', event => { if (drag?.pointer === event.pointerId) endDrag(true); });
stage.addEventListener('lostpointercapture', event => { if (drag?.pointer === event.pointerId) endDrag(true); });
stage.addEventListener('keydown', event => {
  if (drag) {
    if (event.key === 'Escape') endDrag(true);
    event.preventDefault(); event.stopPropagation();
  }
});
new ResizeObserver(renderSelection).observe(stage);

element('generate').onclick = () => run(() => generate());
element('variant').onclick = () => run(() => {
  if (!scene) return;
  const cfg = {...scene.settings, seed:(scene.settings.seed + 1) % 2147483648};
  const placements = compose(scene.choices, assets, cfg);
  commit({...scene, settings:cfg, placements}, null, 'Новая расстановка тех же предметов.');
});
element('clear').onclick = () => { if (scene) commit(null, null, 'Холст очищен. Добавьте предмет из библиотеки.'); };
element('undo').onclick = () => { const previous = undoStack.pop(); if (previous) { redoStack.push(snapshot()); restore(previous); } };
element('redo').onclick = () => { const next = redoStack.pop(); if (next) { undoStack.push(snapshot()); restore(next); } };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) button.onclick = () => {
  setMode(button.dataset.mode as InputMode);
  field('query').value = mode === 'components' ? 'книга, монета × 2, лампа' : 'Идеи для команды';
};
for (const id of ['format','detail','layout','appearance','backdrop']) field(id).onchange = () => run(() => {
  if (id === 'backdrop') {
    const cfg = readConfig();
    if (scene) commit({...clone(scene), settings:cfg}, selected, 'Фон холста изменён.');
    else { config = cfg; render(); persist(); }
  } else reflow(id !== 'appearance');
});
function applyColors(next: Palette) {
  if (scene) commit({...clone(scene), palette:next}, selected, 'Цветовая схема применена.');
  else { remember(); colors = next; persist(); render(); }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-palette]')) button.onclick = () => applyColors(clone(SCHEMES[button.dataset.palette!]));
element('duplicate').onclick = () => run(duplicateSelected);
element('delete').onclick = () => {
  removeSelected();
  if (scene) stage.focus({preventScroll:true});
  else element('undo').focus({preventScroll:true});
};
element('forward').onclick = () => reorder(1);
element('backward').onclick = () => reorder(-1);
for (const [id, axis] of [['center-x', 'cx'], ['center-y', 'cy']] as const) {
  field(id).onchange = () => run(() => {
    const coordinate = field(id).valueAsNumber;
    if (!Number.isFinite(coordinate)) { renderInspector(); return; }
    change(draft => {
      const placement = draft.placements.find(item => item.instanceId === selected)!;
      placement[axis] = coordinate;
      constrain(placement, draft.settings);
    }, 'Координаты центра обновлены.');
  });
}
function resizePlacement(p: Placement, requested: number, cfg: Settings) {
  const a = assetOf(p), bounds = rotatedBounds(a.width, a.height, p.rotation);
  const maximum = Math.min(1000, cfg.width / bounds.width, cfg.height / bounds.height);
  p.scale = Math.max(0.01, Math.min(maximum, requested));
}
field('object-width').onchange = () => run(() => {
  const width = field('object-width').valueAsNumber;
  if (!Number.isFinite(width) || width <= 0) { renderInspector(); return; }
  change(draft => {
    const p = draft.placements.find(item => item.instanceId === selected)!;
    resizePlacement(p, width / assetOf(p).width, draft.settings);
    constrain(p, draft.settings);
  }, 'Размер предмета изменён.');
});
field('rotation').oninput = () => { element('rotation-value').textContent = `${field('rotation').value}°`; };
field('rotation').onchange = () => change(draft => {
  const p = draft.placements.find(p => p.instanceId === selected)!; p.rotation = Number(field('rotation').value); constrain(p, draft.settings);
}, 'Предмет повёрнут.');
field('object-state').onchange = () => run(() => change(draft => {
  const p = draft.placements.find(p => p.instanceId === selected)!;
  p.assetId = variant(assetOf(p), assets, draft.settings.detail!, field('object-state').value as 'main' | 'background').id;
  const states = new Set(draft.placements.map(p => assetOf(p).appearance));
  draft.settings.appearanceMode = states.size > 1 ? 'mixed' : states.has('background') ? 'background' : 'main';
  constrain(p, draft.settings);
}, 'Состояние предмета изменено.'));
element('source-svg').onclick = () => { const p = currentPlacement(); if (p) { const a = assetOf(p); download(a.thumbnail!, `${a.familyId}-${a.detail}-${a.appearance}.svg`, 'image/svg+xml'); } };
element('export-svg').onclick = () => run(() => { if (scene) download(sceneSvg(checked(scene), assets), 'socheta-composition.svg', 'image/svg+xml'); });
element('save-scene').onclick = () => run(() => { if (scene) download(JSON.stringify({...checked(scene), inputMode:mode}, null, 2), 'socheta-project.json', 'application/json'); });
element('open-scene').onclick = () => field('scene-file').click();
field('scene-file').onchange = () => run(async () => {
  const file = field('scene-file').files?.[0]; if (!file) return;
  try {
    if (file.size > 2000000) throw Error('Проект слишком большой. Максимум — 2 МБ.');
    const data = JSON.parse(await file.text()), next = checked(data);
    commit(next, null, 'Проект открыт.');
    setMode(data.inputMode === 'components' || data.inputMode === 'metaphor' ? data.inputMode : inferMode(next));
    field('query').value = next.query; persist();
  }
  finally { field('scene-file').value = ''; }
});
element('import-palette').onclick = () => field('palette-file').click();
field('palette-file').onchange = () => run(async () => {
  const file = field('palette-file').files?.[0]; if (!file) return;
  try { if (file.size > 100000) throw Error('Палитра слишком большая. Максимум — 100 КБ.'); applyColors(scheme(JSON.parse(await file.text()))); }
  finally { field('palette-file').value = ''; }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-example]')) button.onclick = () => run(() => {
  const next = checked(examples[Number(button.dataset.example)]); commit(next, null, 'Пример открыт. Теперь можно изменить расположение предметов.');
  setMode(Number(button.dataset.example) === 1 ? 'metaphor' : 'components');
  field('query').value = next.query; persist();
  element('editor').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
});
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (target.closest('input,textarea,select,[contenteditable=true]') || !target.closest('#editor')) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); element(event.shiftKey ? 'redo' : 'undo').click(); return; }
  if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); run(duplicateSelected); return; }
  if (!selected || !scene) return;
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
  const directions: Record<string, [number, number]> = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
  const direction = directions[event.key];
  if (direction) {
    event.preventDefault();
    change(draft => { const p = draft.placements.find(p => p.instanceId === selected)!; const step = event.shiftKey ? 10 : 1; p.cx += direction[0] * step; p.cy += direction[1] * step; constrain(p, draft.settings); }, 'Предмет перемещён.');
  }
});

try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    const data = JSON.parse(saved);
    config = settings(data.config); colors = scheme(data.colors); scene = data.scene ? checked(data.scene) : null;
    if (scene) { config = scene.settings; colors = scene.palette!; field('query').value = scene.query; }
    setMode(data.mode === 'components' || data.mode === 'metaphor' ? data.mode : scene ? inferMode(scene) : 'components');
    if (typeof data.query === 'string' && data.query.length <= 2000) field('query').value = data.query;
  } else scene = makeScene(config);
} catch { scene = makeScene(config); }
setMode(mode);
render();


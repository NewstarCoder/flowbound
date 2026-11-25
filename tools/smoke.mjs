// Headless end-to-end test in Microsoft Edge. Run: node tools/smoke.mjs [class]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'shots');
mkdirSync(outDir, { recursive: true });
const pageUrl = pathToFileURL(path.join(here, '..', 'index.html')).href;
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const port = 9334;
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, '--window-size=1400,850', `--user-data-dir=${path.join(here, '.edge-profile')}`, '--autoplay-policy=no-user-gesture-required', pageUrl]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* not up yet */ }
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const consoleMsgs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') consoleMsgs.push('EXCEPTION ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) consoleMsgs.push(d.params.type + ' ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
};
const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
const click = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(80); };
const drag = async (x1, y1, x2, y2) => {
  await mouse('mouseMoved', x1, y1); await mouse('mousePressed', x1, y1);
  for (let k = 1; k <= 6; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * k) / 6, y: y1 + ((y2 - y1) * k) / 6, button: 'left', buttons: 1 });
  await mouse('mouseReleased', x2, y2); await sleep(80);
};
const typeText = async (t) => { await send('Input.insertText', { text: t }); await sleep(60); };
const center = (sel) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);

await send('Runtime.enable');
await send('Page.enable');
await sleep(1200);
await evalJs('localStorage.clear(); location.reload()').catch(() => {});
await sleep(1500);
await shot('1-title');

// ── login ──
await evalJs(`(async () => { const $ = (i) => document.getElementById(i);
  $('inName').value = 'tester_1'; $('inPin').value = '12'; $('btnLogin').click(); await new Promise(r=>setTimeout(r,200)); })()`);
console.log('bad PIN message:', await evalJs(`document.getElementById('loginErr').textContent`));
await evalJs(`(async () => { const $ = (i) => document.getElementById(i);
  $('inPin').value = '1234'; $('btnLogin').click(); await new Promise(r=>setTimeout(r,300)); })()`);
console.log('logged in as:', await evalJs(`document.getElementById('whoName').textContent`));
await shot('1b-player');

const cls = process.argv[2] || 'arcanist';
await evalJs(`(async () => {
  const $ = (i) => document.getElementById(i), sleep = (ms) => new Promise(r => setTimeout(r, ms));
  $('btnNew').click(); await sleep(200);
  [...document.querySelectorAll('.class-card')][CB.ClassOrder.indexOf('${cls}')].click();
  await sleep(100);
  $('btnBegin').click(); await sleep(150); $('modalYes').click();
})()`);
await sleep(900);

// ── realistic editor test: draw "sum of two numbers" with mouse + keyboard ──
await evalJs(`CB.debug.ask('seq9')`);
await sleep(300);
await shot('2-draw-empty');
const addBtn = async (type) => click(...(await center(`.ed-add[data-type="${type}"]`)));
const nodeSel = (i) => `#qEditor [data-node]:nth-of-type(${i})`;
// select START
await click(...(await center('#qEditor [data-node]')));
await addBtn('io'); await typeText('INPUT A');
await addBtn('io'); await typeText('INPUT B');
await addBtn('process'); await typeText('S <- A + B');
await addBtn('io'); await typeText('OUTPUT S');
await addBtn('terminal');
await sleep(200);
let g = await evalJs(`JSON.stringify(CB.debug.editor.getGraph())`);
console.log('editor graph:', g);
// delete the arrow into the process box and redraw it by dragging from the handle
await evalJs(`(() => { const ed = CB.debug.editor; const p = ed.nodes.find(n => n.type === 'process'); ed.edges = ed.edges.filter(e => e.to !== p.id); ed.render(); })()`);
const [hx, hy] = await evalJs(`(() => { const h = [...document.querySelectorAll('#qEditor .ed-handle.free')][0]; const r = h.querySelector('circle:not(.ed-hit)').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
const [px, py] = await evalJs(`(() => { const ed = CB.debug.editor; const p = ed.nodes.find(n => n.type === 'process'); const r = document.querySelector('#qEditor [data-node="' + p.id + '"]').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
await drag(hx, hy, px, py);
console.log('edges after drag-connect:', await evalJs(`CB.debug.editor.edges.length`));
// drag the output box sideways to check moving
const [ox, oy] = await evalJs(`(() => { const ed = CB.debug.editor; const p = ed.nodes.find(n => /OUTPUT/.test(n.text)); const r = document.querySelector('#qEditor [data-node="' + p.id + '"]').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
await drag(ox, oy, ox + 120, oy + 10);
await evalJs(`document.getElementById('btnRun').click()`);
await sleep(200);
console.log('practice:', await evalJs(`document.getElementById('feedback').innerText`));
await shot('2-draw-done');
await evalJs(`document.getElementById('btnSubmit').click()`);
await sleep(200);
console.log('submit:', await evalJs(`document.getElementById('feedback').innerText`));
await sleep(4000);
await shot('2b-after-draw');

// ── a decision/loop drawing check: wrong chart gives useful feedback ──
const step = `(async () => {
  const $ = (i) => document.getElementById(i), sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const resultUp = () => $('result').classList.contains('active');
  const dfUp = () => !!$('dfYes') && !$('deflectBanner').hidden;
  const stable = () => resultUp() || !$('turnMenu').hidden || dfUp() ||
    ($('turnMenu').hidden && $('btnSubmit').textContent.startsWith('Continue') && !$('btnSubmit').disabled) ||
    (!$('qArea').hidden && $('btnSubmit').textContent.startsWith('Submit') && !$('btnSubmit').disabled && $('feedback').hidden);
  const settle = async (max = 400) => { await sleep(150); for (let k = 0; k < max && !stable(); k++) await sleep(100); };
  const hud = () => ({ hp: $('pHpText').textContent, boss: $('bHpText').textContent, xp: $('xpHud').textContent });

  if (resultUp()) return { result: $('resTitle').textContent, btn: $('resBtn').textContent };
  if (dfUp()) { $('dfYes').click(); await settle(); return { action: 'deflect-attempt', ...hud() }; }
  if ($('turnMenu').hidden && $('btnSubmit').textContent.startsWith('Continue') && !$('btnSubmit').disabled) { $('btnSubmit').click(); await settle(); return { action: 'continue', ...hud() }; }
  if (!$('turnMenu').hidden) {
    const t = window.__t = (window.__t || 0) + 1;
    if (t % 7 === 4) { $('btnBlock').click(); await sleep(300); await settle(); return { action: 'block', ...hud() }; }
    $('btnAttack').click();
    await settle();
    return { action: 'attack' };
  }
  const ch = CB.debug.battle.ch;
  const n = window.__q = (window.__q || 0) + 1;
  const wrong = n % 5 === 0;
  if (ch.type === 'mc') $('qOptions').children[wrong ? (ch.answer + 1) % ch.options.length : ch.answer].click();
  else if (ch.type === 'trace') $('qAnswer').value = wrong ? '999' : CB.Runner.traceExpected(ch).join('\\n');
  else if (ch.type === 'fill') [...document.querySelectorAll('#qChart input.blank')].forEach((i, k) => i.value = wrong ? 'X <- 1' : ch.graph.nodes.filter(n => n.blank)[k].answer);
  else {
    const sol = ch.solutionGraph;
    CB.debug.editor.load(wrong ? { nodes: sol.nodes.slice(0, 2), edges: [] } : sol);
  }
  if (n === 6 && !window.__shot) { window.__shot = ch.type; }
  $('btnSubmit').click();
  const fb = $('feedback').textContent;
  if (fb.startsWith('Fix')) return { id: ch.id, type: ch.type, incomplete: fb.slice(0, 90) };
  await settle();
  return { id: ch.id, type: ch.type, wrong, fb: fb.slice(0, 60), ...hud() };
})()`;

let turns = 0, results = 0;
const out = [];
const shotTypes = new Set();
while (turns < 600) {
  // screenshot one of each question type before answering
  const peek = await evalJs(`(() => { const B = CB.debug.battle; return B && B.ch && !document.getElementById('qArea').hidden && document.getElementById('turnMenu').hidden && B.qMode ? B.stage + '-' + B.ch.type : ''; })()`);
  if (peek && !shotTypes.has(peek)) { shotTypes.add(peek); await shot('3-q-' + peek); }
  const r = await evalJs(step);
  turns++;
  if (r.incomplete) { out.push(JSON.stringify(r)); await evalJs(`(() => { const ch = CB.debug.battle.ch;
    if (ch.type === 'draw') CB.debug.editor.load(ch.solutionGraph);
    else [...document.querySelectorAll('#qChart input.blank')].forEach((i, k) => i.value = ch.graph.nodes.filter(n => n.blank)[k].answer);
    document.getElementById('btnSubmit').click(); })()`); await sleep(500); continue; }
  if (r.result) {
    results++;
    out.push(`RESULT: ${r.result} [${r.btn}]`);
    await shot('5-result-' + results);
    if (/Onward/.test(r.btn)) { await evalJs(`document.getElementById('resBtn').click()`); await sleep(900); await shot(`4-boss${results + 1}`); continue; }
    if (/Try again/.test(r.btn)) { await evalJs(`document.getElementById('resBtn').click()`); await sleep(900); continue; }
    break;
  }
  out.push(JSON.stringify(r));
  if (r.error) break;
}
console.log(out.join('\n'));
await evalJs(`document.getElementById('resMenu').click()`);
await sleep(300);
await evalJs(`document.getElementById('btnBoard').click()`);
await sleep(500);
await shot('6-board');
console.log('board:', await evalJs(`document.getElementById('boardBody').innerText`));
console.log('\nConsole errors/exceptions:', consoleMsgs.length ? consoleMsgs.join('\n') : 'none');
ws.close();
proc.kill();
process.exit(0);

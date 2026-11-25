// Debug helper: node tools/probe.mjs "<js expression>" [screenshot-name]
// Opens the game logged in, runs the expression (may be async) and prints the result.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(here, 'shots'), { recursive: true });
const pageUrl = process.env.URL || pathToFileURL(path.join(here, '..', 'index.html')).href;
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const port = 9335;
const proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--window-size=${process.env.W || 1400},${process.env.H || 850}`, `--user-data-dir=${path.join(here, '.edge-probe')}`, pageUrl]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* not up */ }
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) return 'ERR ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result.result.value;
};
await send('Runtime.enable');
await sleep(Number(process.env.WAIT || 1200));
await evalJs(`(async () => { localStorage.clear(); const $ = (i) => document.getElementById(i), s = (ms) => new Promise(r => setTimeout(r, ms));
  $('inName').value = 'probe'; $('inPin').value = '1111'; $('btnLogin').click(); await s(300);
  $('btnNew').click(); await s(200); document.querySelectorAll('.class-card')[2].click(); $('btnBegin').click(); await s(150); $('modalYes').click(); await s(700); })()`);
const res = await evalJs(process.argv[2] || '1');
console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
await sleep(400);
if (process.argv[3]) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(here, 'shots', process.argv[3] + '.png'), Buffer.from(r.result.data, 'base64'));
}
if (errs.length) console.log('EXCEPTIONS:', errs);
ws.close();
proc.kill();
process.exit(0);

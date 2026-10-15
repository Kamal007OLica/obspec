// Debug helper: evaluate an expression in headless Chrome against the preview and print the result.
//   node scripts/cdp-eval.mjs "<js expression>"   (page is loaded first; top-level await allowed)
import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--remote-debugging-port=9334', '--headless=new', '--no-first-run', '--user-data-dir=/tmp/obspec-cdp-profile', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await fetch('http://127.0.0.1:9334/json').then((r) => r.json()); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5177/' }); await sleep(2500);
for (const expr of process.argv.slice(2)) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(r.result.exceptionDetails ? 'EXCEPTION: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text) : JSON.stringify(r.result.result.value, null, 1));
}
ws.close(); chrome.kill();

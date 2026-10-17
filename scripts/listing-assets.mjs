// Renders publishing/listing.html to the PNGs Figma Community asks for: icon 128×128, cover 1920×960.
//   node scripts/listing-assets.mjs   → publishing/icon.png, publishing/cover.png
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--remote-debugging-port=9337', '--headless=new', '--no-first-run', '--allow-file-access-from-files', '--user-data-dir=/tmp/obspec-listing-profile', '--window-size=2000,1400', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await fetch('http://127.0.0.1:9337/json').then((r) => r.json()); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1400, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(path.resolve('publishing/listing.html')).href });
await sleep(1500);
await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
async function shotOf(selector, file, scale) {
  const { result } = await send('Runtime.evaluate', { expression: `JSON.stringify(document.querySelector('${selector}').getBoundingClientRect())`, returnByValue: true });
  const r = JSON.parse(result.result.value);
  const png = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale } });
  await writeFile(path.resolve('publishing', file), Buffer.from(png.result.data, 'base64'));
  console.log(`  publishing/${file}  ${Math.round(r.width * scale)}×${Math.round(r.height * scale)}`);
}
await shotOf('#icon', 'icon.png', 1);
await shotOf('#icon', 'icon@2x.png', 2);
await shotOf('#cover', 'cover.png', 1);
ws.close(); chrome.kill();

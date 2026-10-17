// Runs the preview's use-case emulations in headless Chrome over CDP and saves screenshots.
//   node scripts/emulate.mjs [outDir]      (needs `npm run preview` running on :5177)
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_ = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5177/';
const out = path.resolve(process.argv[2] ?? 'preview/shots');
await mkdir(out, { recursive: true });

const port = 9333;
const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(out, '.chrome-profile')}`, '--window-size=1600,1000', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()); break; } catch { await sleep(200); } }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed'); return r.result.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, name), Buffer.from(r.result.data, 'base64')); console.log('  saved', name); };

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: URL_ });
await sleep(2500);
await evaluate(`fetch('/__obsidian/reset',{method:'POST'}).then(r=>r.ok)`);
await evaluate(`localStorage.removeItem('obspec:settings'); localStorage.setItem('obspec:preview-theme','light'); location.reload(); true`);
await sleep(2500);
await shot('00-idle.png');

// Onboarding stills: step 1 (bridge offline) and step 2 (pick a vault). The demo vault is restored afterwards.
const demoVault = path.resolve('preview/.work/Obspec Demo Vault');
const setDemoVault = () => evaluate(`fetch('http://127.0.0.1:27123/vault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: ${JSON.stringify(demoVault)} }) }).then(r => r.ok)`);
if (!(await setDemoVault())) throw new Error('could not select the demo vault — is the preview server running?');
await evaluate(`localStorage.setItem('obspec:settings', JSON.stringify({ bridgeUrl: 'http://127.0.0.1:1' })); location.reload(); true`);
await sleep(2500);
await shot('00a-onboarding-step1-offline.png');
await evaluate(`localStorage.removeItem('obspec:settings'); fetch('http://127.0.0.1:27123/vault', { method: 'DELETE' }).then(() => location.reload()); true`);
await sleep(3000);
await shot('00b-onboarding-step2-pick-vault.png');
await setDemoVault();
await sleep(1500);

const titles = await evaluate(`[...document.querySelectorAll('.sc')].map(b=>b.querySelector('div').textContent)`);
const results = [];
for (let i = 0; i < titles.length; i++) {
  console.log(`▶ ${i + 1}. ${titles[i]}`);
  const t0 = Date.now();
  try {
    await evaluate(`window.obspec.runScenario(${i}).then(()=> 'ok')`);
    await sleep(600);
    await shot(`0${i}-${titles[i].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`);
    results.push({ scenario: titles[i], ok: true, ms: Date.now() - t0 });
  } catch (err) {
    await shot(`0${i}-FAILED.png`);
    results.push({ scenario: titles[i], ok: false, error: err.message, ms: Date.now() - t0 });
  }
}
// Extra stills: search results with highlights, and the note view.
await evaluate(`(async()=>{const u=window.obspec.ui; await u.tab('search'); const b=document.getElementById('plugin').contentDocument.querySelector('[data-act=back]'); if(b&&b.getClientRects().length){b.click(); await new Promise(r=>setTimeout(r,200));} await u.typeInto('#q','apple pay tag:spec'); await u.waitFor('.result'); await new Promise(r=>setTimeout(r,500));})()`);
await shot('07-search-results.png');
await evaluate(`(async()=>{const u=window.obspec.ui; await u.typeInto('#q','states'); await u.waitFor('.r-thumb'); await new Promise(r=>setTimeout(r,600));})()`);
await shot('07b-search-thumbnails.png');
await evaluate(`(async()=>{const u=window.obspec.ui; await u.click('[data-act=view][data-arg=cards]'); await u.waitFor('.result.rcard'); await new Promise(r=>setTimeout(r,500));})()`);
await shot('07c-search-cards.png');
await evaluate(`(async()=>{const u=window.obspec.ui; await u.click('[data-act=view][data-arg=compact]'); await u.waitFor('.result.compact'); await new Promise(r=>setTimeout(r,400));})()`);
await shot('07d-search-compact.png');
await evaluate(`(async()=>{const u=window.obspec.ui; await u.click('[data-act=view][data-arg=list]'); await u.waitFor('.result:not(.rcard):not(.compact)');})()`);
await evaluate(`(async()=>{const u=window.obspec.ui; await u.click('.result'); await u.waitFor('.note-title'); await new Promise(r=>setTimeout(r,500));})()`);
await shot('08-note-view.png');
// Dark theme snapshot of the plugin for the record.
await evaluate(`localStorage.setItem('obspec:preview-theme','dark'); document.getElementById('theme').click(); true`);
await sleep(600);
await shot('09-dark-theme.png');
// Plugin-side override: back to light while the host (Figma) is dark.
await evaluate(`document.getElementById('plugin').contentDocument.querySelector('[data-act=toggle-theme]').click(); true`);
await sleep(500);
await shot('09b-theme-override-light-in-dark-figma.png');
await evaluate(`document.getElementById('plugin').contentDocument.querySelector('[data-act=toggle-theme]').click(); true`);

const logs = await evaluate(`[...document.querySelectorAll('#log li')].map(l=>l.textContent)`);
const pluginErrors = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
const consoleErrors = events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error').map((e) => e.params.entry.text);
await writeFile(path.join(out, 'report.json'), JSON.stringify({ results, logs, pluginErrors, consoleErrors }, null, 2));
console.table(results.map((r) => ({ scenario: r.scenario, ok: r.ok, ms: r.ms, error: r.error ?? '' })));
if (pluginErrors.length || consoleErrors.length) console.log('errors:', pluginErrors, consoleErrors);
ws.close(); chrome.kill();
process.exit(results.every((r) => r.ok) && !pluginErrors.length ? 0 : 1);

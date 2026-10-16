// Verifies the site's PostHog wiring in headless Chrome: SDK loads, events fire, requests are accepted.
//   python3 -m http.server 5188 --bind 127.0.0.1 --directory site &   then:   node scripts/site-analytics-check.mjs
import { spawn } from 'node:child_process';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.SITE_URL ?? 'http://127.0.0.1:5188/';
const chrome = spawn(CHROME, ['--remote-debugging-port=9335', '--headless=new', '--no-first-run', '--user-data-dir=/tmp/obspec-ph-profile', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await fetch('http://127.0.0.1:9335/json').then((r) => r.json()); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const net = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Network.responseReceived' && /posthog\.com/.test(m.params.response.url)) net.push({ url: m.params.response.url.replace(/\?.*$/, ''), status: m.params.response.status }); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed'); return r.result.result.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
// PostHog drops events from bot-like user agents; headless Chrome reports "HeadlessChrome", so present a normal UA.
await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });

// 1) debug mode on localhost: capturing is ON and goes to PostHog
await send('Page.navigate', { url: BASE + '?ph=debug' }); await sleep(3500);
const loaded = await ev(`!!(window.posthog && posthog.__loaded)`);
const optedOutDebug = await ev(`posthog.has_opted_out_capturing()`);
// click a CTA without leaving the page
await ev(`(() => { const a = document.querySelector('a[data-cta="get-plugin"]'); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); return true; })()`);
// scroll through the demo so the stepper advances
await ev(`(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += Math.max(200, h / 40)) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } return window.__obspecStep; })()`);
await sleep(2500);
const events = await ev(`window.__phEvents || []`);
const replay = await ev(`posthog.sessionRecordingStarted ? posthog.sessionRecordingStarted() : null`);
const step = await ev(`window.__obspecStep`);
const ctaCount = await ev(`document.querySelectorAll('a[data-cta]').length`);

// 2) plain localhost: capturing is OFF (no noise in insights)
await send('Page.navigate', { url: BASE }); await sleep(3000);
const optedOutPlain = await ev(`!!(window.posthog && posthog.has_opted_out_capturing && posthog.has_opted_out_capturing())`);

const counts = events.reduce((m, e) => (m[e] = (m[e] || 0) + 1, m), {});
console.log(JSON.stringify({ sdkLoaded: loaded, optedOutInDebug: optedOutDebug, optedOutOnPlainLocalhost: optedOutPlain, furthestStep: step, ctaLinks: ctaCount, eventsCaptured: counts, sessionReplayStarted: replay, posthogRequests: net }, null, 2));
ws.close(); chrome.kill();
const ok = loaded && !optedOutDebug && optedOutPlain && counts['$pageview'] && counts['cta_clicked'] && counts['demo_step_viewed'] && net.some((n) => /\/(e|batch|i\/v0\/e)\b/.test(n.url) && n.status === 200);
process.exit(ok ? 0 : 1);

/**
 * Obspec Bridge CLI.
 *
 *   obspec-bridge                      → remembers your last vault, else uses the vault Obsidian has open
 *   obspec-bridge --vault ~/Notes      → a specific vault
 *   obspec-bridge --port 27123 --token secret
 */
import os from 'node:os';
import { startBridge, VERSION, type BridgeOptions } from './server';
import { defaultVault } from './discover';

function parseArgs(argv: string[]): BridgeOptions & { auto: boolean } {
  const o: BridgeOptions & { auto: boolean } = { vault: process.env.OBSPEC_VAULT || undefined, port: Number(process.env.OBSPEC_PORT ?? 27123), token: process.env.OBSPEC_TOKEN, persist: true, auto: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vault' || a === '-v') o.vault = argv[++i];
    else if (a === '--port' || a === '-p') o.port = Number(argv[++i]);
    else if (a === '--token' || a === '-t') o.token = argv[++i];
    else if (a === '--quiet' || a === '-q') o.quiet = true;
    else if (a === '--no-remember') o.persist = false;
    else if (a === '--no-auto') o.auto = false;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (a === '--version') { console.log(VERSION); process.exit(0); }
    else if (!a.startsWith('-') && !o.vault) o.vault = a;
  }
  if (o.vault) o.vault = o.vault.replace(/^~(?=$|\/)/, os.homedir());
  return o;
}

function printHelp(): void {
  console.log(`Obspec Bridge v${VERSION}

usage: obspec-bridge [--vault <path>] [--port 27123] [--token <secret>]

  --vault, -v    Path to your Obsidian vault. Without it, Obspec reuses the vault you last
                 picked, else the vault Obsidian currently has open. You can also pick one
                 from the plugin's onboarding screen in Figma.
  --port,  -p    Port to listen on (default 27123 — the port the Figma manifest allows)
  --token, -t    Optional shared secret; the plugin sends it as a Bearer token
  --no-remember  Don't save the vault choice to ~/.obspec/config.json
  --no-auto      Don't guess a vault; wait for the plugin to pick one
  --quiet, -q    Don't log vault events`);
}

const opts = parseArgs(process.argv.slice(2));
(async () => {
  if (!opts.vault && opts.auto) opts.vault = await defaultVault();
  await startBridge(opts);
})().catch((err) => { console.error('[obspec] failed to start:', err.message); process.exit(1); });

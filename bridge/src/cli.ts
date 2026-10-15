/** Obspec Bridge CLI entry: `obspec-bridge --vault <path>` */
import os from 'node:os';
import { startBridge, VERSION, type BridgeOptions } from './server';

// ───────────────────────────── CLI ─────────────────────────────
function parseArgs(argv: string[]): BridgeOptions {
  const o: BridgeOptions = { vault: process.env.OBSPEC_VAULT ?? '', port: Number(process.env.OBSPEC_PORT ?? 27123), token: process.env.OBSPEC_TOKEN };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vault' || a === '-v') o.vault = argv[++i];
    else if (a === '--port' || a === '-p') o.port = Number(argv[++i]);
    else if (a === '--token' || a === '-t') o.token = argv[++i];
    else if (a === '--quiet' || a === '-q') o.quiet = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (!a.startsWith('-') && !o.vault) o.vault = a;
  }
  if (!o.vault) { printHelp(); console.error('\nerror: --vault is required'); process.exit(2); }
  o.vault = o.vault.replace(/^~(?=$|\/)/, os.homedir());
  return o;
}

function printHelp(): void {
  console.log(`Obspec Bridge v${VERSION}

usage: obspec-bridge --vault <path-to-obsidian-vault> [--port 27123] [--token <secret>]

  --vault, -v   Path to your Obsidian vault (the folder containing .obsidian/)
  --port,  -p   Port to listen on (default 27123, 0 = random)
  --token, -t   Optional shared secret; the plugin sends it as a Bearer token
  --quiet, -q   Don't log vault events`);
}

const opts = parseArgs(process.argv.slice(2));
startBridge(opts).catch((err) => { console.error('[obspec] failed to start:', err.message); process.exit(1); });

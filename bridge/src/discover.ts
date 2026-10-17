/**
 * Finding vaults without a terminal: Obsidian's own vault registry, a native
 * folder dialog, and a tiny config file that remembers the choice.
 */
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { VaultCandidate } from '../../src/shared/protocol';

export interface BridgeConfig { vault?: string }

const CONFIG_DIR = path.join(os.homedir(), '.obspec');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export async function loadConfig(): Promise<BridgeConfig> {
  try { return JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) as BridgeConfig; } catch { return {}; }
}

export async function saveConfig(cfg: BridgeConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** Where Obsidian keeps its list of vaults, per platform (plus flatpak/snap on Linux). */
export function obsidianRegistryPaths(): string[] {
  if (process.env.OBSPEC_OBSIDIAN_CONFIG) return [process.env.OBSPEC_OBSIDIAN_CONFIG];
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin': return [path.join(home, 'Library/Application Support/obsidian/obsidian.json')];
    case 'win32': return [path.join(process.env.APPDATA ?? path.join(home, 'AppData/Roaming'), 'obsidian/obsidian.json')];
    default: return [
      path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'obsidian/obsidian.json'),
      path.join(home, '.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json'),
      path.join(home, 'snap/obsidian/current/.config/obsidian/obsidian.json'),
    ];
  }
}

interface ObsidianRegistry { vaults?: Record<string, { path: string; ts?: number; open?: boolean }> }

/** Vaults Obsidian knows about, most recently opened first. */
export async function discoverVaults(current?: string): Promise<VaultCandidate[]> {
  const out = new Map<string, VaultCandidate>();
  for (const file of obsidianRegistryPaths()) {
    let reg: ObsidianRegistry;
    try { reg = JSON.parse(await fs.readFile(file, 'utf8')) as ObsidianRegistry; } catch { continue; }
    for (const v of Object.values(reg.vaults ?? {})) {
      if (!v?.path) continue;
      const p = path.resolve(v.path);
      out.set(p, { name: path.basename(p), path: p, source: 'obsidian', open: !!v.open, lastOpened: v.ts, exists: existsSync(p) });
    }
  }
  const cfg = await loadConfig();
  if (cfg.vault && !out.has(path.resolve(cfg.vault))) {
    const p = path.resolve(cfg.vault);
    out.set(p, { name: path.basename(p), path: p, source: 'config', exists: existsSync(p) });
  }
  if (current && !out.has(path.resolve(current))) {
    const p = path.resolve(current);
    out.set(p, { name: path.basename(p), path: p, source: 'current', exists: true });
  }
  return [...out.values()].sort((a, b) => Number(b.open) - Number(a.open) || (b.lastOpened ?? 0) - (a.lastOpened ?? 0) || a.name.localeCompare(b.name));
}

/** The vault to use when nobody said: the one Obsidian has open, else the most recent. */
export async function defaultVault(): Promise<string | undefined> {
  const cfg = await loadConfig();
  if (cfg.vault && existsSync(cfg.vault)) return cfg.vault;
  const found = await discoverVaults();
  return found.find((v) => v.exists)?.path;
}

export function canPickFolder(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32' || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
}

/** Native "choose a folder" dialog. Resolves to the path, or null when cancelled. */
export function pickFolder(prompt = 'Choose your Obsidian vault folder'): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const done = (err: Error | null, stdout?: string) => {
      if (err) {
        // osascript exits 1 with "User canceled" (-128); zenity exits 1 on cancel.
        if (/canceled|cancelled|-128/i.test(err.message) || (err as unknown as { code?: number | string }).code === 1) return resolve(null);
        return reject(err);
      }
      const p = (stdout ?? '').trim().replace(/\/+$/, '');
      resolve(p || null);
    };
    const safe = prompt.replace(/"/g, '\\"');
    if (process.platform === 'darwin') {
      execFile('osascript', ['-e', `tell application "System Events" to activate`, '-e', `POSIX path of (choose folder with prompt "${safe}")`], { timeout: 300_000 }, done);
    } else if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = "${safe}"; $d.ShowNewFolderButton = $false; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }`;
      execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], { timeout: 300_000 }, done);
    } else {
      execFile('zenity', ['--file-selection', '--directory', `--title=${prompt}`], { timeout: 300_000 }, (err, stdout) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          execFile('kdialog', ['--getexistingdirectory', os.homedir(), '--title', prompt], { timeout: 300_000 }, done);
        } else done(err, stdout);
      });
    }
  });
}

/** Does this folder look like an Obsidian vault? (Not required — any folder of .md files works.) */
export function looksLikeVault(dir: string): boolean {
  return existsSync(path.join(dir, '.obsidian'));
}

// Bundles tests/*.test.ts with esbuild, then runs node --test.
import * as esbuild from 'esbuild';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.test-dist');
await rm(out, { recursive: true, force: true });
const files = (await readdir(path.join(root, 'tests'))).filter((f) => f.endsWith('.test.ts')).map((f) => path.join(root, 'tests', f));
await esbuild.build({ entryPoints: files, outdir: out, bundle: true, platform: 'node', format: 'esm', target: 'node18', outExtension: { '.js': '.mjs' }, external: ['node:*'], logLevel: 'warning' });
const built = (await readdir(out)).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(out, f));
const p = spawn(process.execPath, ['--test', ...built], { stdio: 'inherit' });
p.on('exit', (code) => process.exit(code ?? 1));

/* Salin aset web ke www/ buat Capacitor.
   api/ tetap di root karena itu Serverless Function Vercel, bukan aset app.
   Isi QRCONFIG_API_BASE untuk menunjuk endpoint upload di APK. */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');

const FILES = [
  'index.html',
  'scan.html',
  'site.webmanifest',
  'robots.txt',
  'assets',
  'vendor'
];

const apiBase = (process.env.QRCONFIG_API_BASE || '').trim().replace(/\/+$/, '');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const item of FILES) {
  await cp(join(root, item), join(out, item), { recursive: true });
}

// Config runtime: web pakai same-origin, APK pakai domain Vercel.
await writeFile(
  join(out, 'assets', 'js', 'config.js'),
  '/* Dibuat otomatis oleh scripts/build-www.mjs. Jangan edit di www/. */\n' +
  'window.QRCONFIG = { apiBase: ' + JSON.stringify(apiBase) + ' };\n'
);

console.log('www siap. apiBase: ' + (apiBase || '(same-origin)'));

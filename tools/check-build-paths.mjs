// check-build-paths.mjs -- no build-machine paths in the files the installer ships (P11).
//
//   node tools\check-build-paths.mjs [folder]      (default: Installer\build)
//
// Looks in every file under the folder (and inside .vsix/.zip/.nupkg files, which are zips) for this
// PC's paths: the repository folder, the user folder, the user and PC names, in UTF-8/ASCII and
// UTF-16LE (how .NET keeps strings), any case. Prints each hit (file, what, a few bytes around it)
// and exits 1 if there is one. It reads only.

import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const folder = path.resolve(process.argv[2] || path.join(repo, 'Installer', 'build'));
if (!fs.existsSync(folder)) { console.error(`Not found: ${folder}`); process.exit(2); }

const home = process.env.USERPROFILE || os.homedir();
const user = process.env.USERNAME || path.basename(home);
const pc = process.env.COMPUTERNAME || os.hostname();
const needles = [...new Map([
  ['repository folder', repo], ['repository folder (/)', repo.replace(/\\/g, '/')],
  ['user folder', home], ['user folder (/)', home.replace(/\\/g, '/')],
  ['user name', user], ['PC name', pc],
].filter(([, v]) => v && v.length >= 4).map(([k, v]) => [v.toLowerCase(), k])).entries()].map(([v, k]) => ({ what: k, text: v }));

// Lower-case ASCII letters in a buffer copy, so a search is case-insensitive for ASCII names.
const lower = (b) => { const c = Buffer.from(b); for (let i = 0; i < c.length; i++) if (c[i] >= 65 && c[i] <= 90) c[i] += 32; return c; };
const forms = needles.flatMap(n => [
  { ...n, enc: 'utf8', bytes: Buffer.from(n.text, 'utf8') },
  { ...n, enc: 'utf16le', bytes: Buffer.from(n.text, 'utf16le') },
]);

const hits = [];
let files = 0, bytes = 0;
function scanBuffer(label, buf) {
  files++; bytes += buf.length;
  const lb = lower(buf);
  for (const f of forms) {
    const at = lb.indexOf(f.bytes);
    if (at >= 0) {
      const ctx = buf.slice(Math.max(0, at - 24), Math.min(buf.length, at + f.bytes.length + 40));
      hits.push(`${label}: ${f.what} (${f.enc}) at ${at}: ${JSON.stringify(f.enc === 'utf16le' ? ctx.toString('utf16le') : ctx.toString('latin1'))}`);
    }
  }
}

// The entries of a zip (stored or deflated), from its central directory.
function zipEntries(buf) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  let p = buf.readUInt32LE(eocd + 16);
  const n = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < n && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const data = buf.slice(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    try { out.push({ name, data: method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null }); } catch { out.push({ name, data: null }); }
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const pdbs = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    const rel = path.relative(folder, f);
    if (/\.pdb$/i.test(e.name)) pdbs.push(rel);
    const buf = fs.readFileSync(f);
    scanBuffer(rel, buf);
    if (/\.(vsix|zip|nupkg)$/i.test(e.name)) {
      for (const z of zipEntries(buf) || []) {
        if (z.data) { if (/\.pdb$/i.test(z.name)) pdbs.push(`${rel}!${z.name}`); scanBuffer(`${rel}!${z.name}`, z.data); }
        else hits.push(`${rel}!${z.name}: could not be read (compression)`);
      }
    }
  }
}
walk(folder);

console.log(`Scanned ${files} files (${(bytes / 1048576).toFixed(1)} MB) in ${folder}`);
console.log(`Looked for: ${needles.map(n => n.what).join(', ')} (UTF-8 and UTF-16LE, any case)`);
console.log(`.pdb files: ${pdbs.length}${pdbs.length ? ` (${pdbs.slice(0, 8).join(', ')}${pdbs.length > 8 ? ', ...' : ''})` : ''}`);
if (hits.length) { console.log(`${hits.length} hit(s):`); for (const h of hits) console.log(`  ${h}`); process.exit(1); }
console.log('No build-machine path in any file.');

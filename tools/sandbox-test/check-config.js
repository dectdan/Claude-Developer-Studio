// JSON checks for the Windows Sandbox test (in-sandbox.ps1), run with the installed Node.
// Prints one JSON object; "problems" lists what is wrong (empty when all is well).
//
//   node check-config.js config <claude_desktop_config.json> <seed.json> expect-cds|expect-none
//   node check-config.js keys <qwen_config.json> [<provider> <expected key>]
//   node check-config.js setkey <qwen_config.json> <provider> <key>

'use strict';
const fs = require('fs');

const CDS = ['claudedevstudio', 'cds-workbench'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const [mode, file, ...rest] = process.argv.slice(2);
const out = { mode, file, problems: [] };

function readRaw(f) {
  const buf = fs.readFileSync(f);
  return { buf, bom: buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, text: buf.toString('utf8').replace(/^﻿/, '') };
}

try {
  if (mode === 'config') {
    const [seedFile, expect] = rest;
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    if (!fs.existsSync(file)) throw new Error('config file missing');
    const { bom, text } = readRaw(file);
    out.bom = bom;
    if (bom) out.problems.push('file starts with a BOM');
    const cfg = JSON.parse(text);
    const servers = cfg.mcpServers || {};
    out.servers = Object.keys(servers);
    out.topKeys = Object.keys(cfg);
    // Everything that isn't CDS's must equal the seed exactly.
    for (const [k, v] of Object.entries(seed)) {
      if (k === 'mcpServers') continue;
      if (!same(cfg[k], v)) out.problems.push(`top-level "${k}" changed: ${JSON.stringify(cfg[k])}`);
    }
    for (const [k, v] of Object.entries(seed.mcpServers || {})) {
      if (!same(servers[k], v)) out.problems.push(`server "${k}" changed: ${JSON.stringify(servers[k])}`);
    }
    const extraTop = Object.keys(cfg).filter(k => !(k in seed) && k !== 'mcpServers');
    if (extraTop.length) out.problems.push(`unexpected top-level keys: ${extraTop.join(', ')}`);
    out.keepMe = servers['keep-me'];
    out.preferences = cfg.preferences;
    out.someOtherSetting = cfg.someOtherSetting;
    out.rawCounts = Object.fromEntries(CDS.map(n => [n, (text.match(new RegExp(`"${n}"\\s*:`, 'g')) || []).length]));
    out.cds = {};
    for (const n of CDS) {
      const e = servers[n];
      if (expect === 'expect-none') {
        if (e) out.problems.push(`"${n}" still present`);
        continue;
      }
      if (!e) { out.problems.push(`"${n}" missing`); continue; }
      const arg0 = Array.isArray(e.args) ? e.args[0] : undefined;
      out.cds[n] = { command: e.command, arg0 };
      if (out.rawCounts[n] !== 1) out.problems.push(`"${n}" appears ${out.rawCounts[n]} times`);
      if (!/^[A-Za-z]:\\.*\\node\.exe$/i.test(e.command || '') || !fs.existsSync(e.command)) out.problems.push(`"${n}" command is not an existing full node.exe path: ${e.command}`);
      if (!arg0 || !fs.existsSync(arg0)) out.problems.push(`"${n}" script does not exist: ${arg0}`);
    }
  } else if (mode === 'keys') {
    const [provider, expected] = rest;
    const { bom, text } = readRaw(file);
    const cfg = JSON.parse(text);
    const providers = cfg.providers || {};
    out.providers = Object.keys(providers);
    out.bom = bom;
    if (!out.providers.length) out.problems.push('no providers');
    for (const [name, p] of Object.entries(providers)) {
      const want = name === provider ? expected : '';
      if ((p.api_key ?? '') !== want) out.problems.push(`${name}: api_key is ${p.api_key ? 'a different non-empty value' : 'empty'}, expected ${want ? 'the test key' : 'empty'}`);
    }
    out.keysEmpty = Object.entries(providers).filter(([, p]) => !p.api_key).map(([n]) => n);
  } else if (mode === 'setkey') {
    const [provider, key] = rest;
    const { text } = readRaw(file);
    const cfg = JSON.parse(text);
    if (!cfg.providers || !cfg.providers[provider]) throw new Error(`no provider ${provider}`);
    cfg.providers[provider].api_key = key;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
    out.set = provider;
  } else {
    throw new Error('unknown mode');
  }
} catch (e) {
  out.problems.push(`error: ${e.message}`);
}
out.ok = out.problems.length === 0;
console.log(JSON.stringify(out));

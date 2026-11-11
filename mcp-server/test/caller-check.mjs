// Checks that a local CDS HTTP server answers only local programs, not web pages.
// Prints PASS/FAIL for each check; exits 1 if any fails.
//
//   node mcp-server\test\caller-check.mjs http://127.0.0.1:63000    (Review Panel)
//   node mcp-server\test\caller-check.mjs http://localhost:62000    (VS Bridge, Visual Studio open)
//
// Port 62000 is treated as the VS Bridge, anything else as the Review Panel; --bridge or
// --panel overrides that. Every request is harmless: the Review Panel gets one test item
// that is removed again; the VS Bridge only gets reads and an unknown command name.

import http from 'http';

const args = process.argv.slice(2);
const base = args.find(a => !a.startsWith('--'));
if (!base) {
  console.error('Usage: node caller-check.mjs <base URL> [--bridge|--panel]');
  process.exit(2);
}
const url = new URL(base);
const port = Number(url.port) || 80;
const kind = args.includes('--bridge') ? 'bridge' : args.includes('--panel') ? 'panel' : (port === 62000 ? 'bridge' : 'panel');
const ownOrigin = `${url.protocol}//${url.host}`;
const readPath = kind === 'bridge' ? '/state' : '/status';

function request(method, reqPath, headers = {}, body = null) {
  return new Promise((resolve) => {
    const data = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: url.hostname, port, path: reqPath, method,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers },
      timeout: 15000,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (e) => resolve({ status: 0, headers: {}, text: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0, failed = 0;
function check(label, ok, r, note = '') {
  const detail = r ? `HTTP ${r.status}${r.headers['access-control-allow-origin'] ? `, Access-Control-Allow-Origin: ${r.headers['access-control-allow-origin']}` : ''}` : '';
  if (ok) { passed++; console.log(`PASS  ${label}  (${detail}${note ? `; ${note}` : ''})`); }
  else { failed++; console.log(`FAIL  ${label}  (${detail})${r && r.text ? `\n      ${r.text.slice(0, 300)}` : ''}`); }
}

console.log(`Caller check: ${kind === 'bridge' ? 'VS Bridge' : 'Review Panel'} at ${ownOrigin}\n`);

// 1. A local program (no Origin header) is answered.
let r = await request('GET', readPath);
if (r.status === 0) {
  console.log(`FAIL  cannot connect to ${ownOrigin}: ${r.text}`);
  console.log(kind === 'bridge' ? '      (Is Visual Studio open with the CDS VS Bridge extension loaded?)' : '      (Is the Review Panel running?)');
  process.exit(1);
}
check(`GET ${readPath} without Origin -> 200`, r.status === 200, r);
check('no Access-Control-Allow-Origin header', !r.headers['access-control-allow-origin'], r);

// 2. A web page (any Origin header that isn't the server's own) is refused.
r = await request('GET', readPath, { Origin: 'https://example.com' });
check(`GET ${readPath} with Origin: https://example.com -> 403`, r.status === 403, r);

// 3. A foreign Host header (DNS rebinding) is refused.
r = await request('GET', readPath, { Host: 'evil.example' });
if (kind === 'bridge' && r.status === 400 && /Microsoft-HTTPAPI/i.test(r.headers.server || '')) {
  // HttpListener only accepts the Host it was registered for (localhost:62000), so
  // Windows' HTTP.sys answers 400 before the request reaches the extension.
  check('GET with Host: evil.example -> refused', true, r, 'refused by Windows HTTP.sys before reaching the bridge');
} else {
  check('GET with Host: evil.example -> 403', r.status === 403, r);
}

if (kind === 'panel') {
  // 4. The panel's own page may POST (and delete what it posted).
  r = await request('POST', '/review', { Origin: ownOrigin }, { title: 'caller-check', content: 'caller-check test item', language: 'text', tag: 'test' });
  let id = null;
  try { id = JSON.parse(r.text).id; } catch { /* not JSON */ }
  check(`POST /review from its own origin (${ownOrigin}) -> accepted`, r.status === 200 && id !== null, r);
  if (id !== null) {
    const d = await request('DELETE', `/review/${id}`, { Origin: ownOrigin });
    check(`DELETE /review/${id} from its own origin -> accepted`, d.status === 200, d);
  }

  // 5. Another web page may not POST.
  r = await request('POST', '/review', { Origin: 'https://example.com' }, { title: 'caller-check (must be refused)', content: 'x' });
  check('POST /review with Origin: https://example.com -> 403', r.status === 403, r);
} else {
  // 4. A web page may not send commands. The action name is unknown, so even an old,
  //    unprotected bridge would do nothing with it.
  r = await request('POST', '/command', { Origin: 'https://example.com' }, { action: 'caller-check.no-such-action' });
  check('POST /command with Origin: https://example.com -> 403', r.status === 403, r);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

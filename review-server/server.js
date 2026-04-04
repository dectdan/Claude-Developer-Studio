'use strict';
const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = 63000;

// In-memory item store (newest first)
let reviewItems = [];
let sseClients  = [];
let nextId      = 1;

app.use(express.json({ limit: '50mb' }));

// ── SSE endpoint ───────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send current items on connect
  const init = JSON.stringify({ type: 'init', items: reviewItems });
  res.write(`data: ${init}\n\n`);

  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

function broadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(c => c.write(msg));
}

// ── POST /review — receive content from MCP tool ──────────────────────────
app.post('/review', (req, res) => {
  const { title, content, language = 'text', tag } = req.body;
  if (!title || content === undefined) {
    return res.status(400).json({ error: 'title and content are required' });
  }
  const item = {
    id:       nextId++,
    ts:       new Date().toISOString(),
    title,
    content,
    language,
    tag:      tag || null,
  };
  reviewItems.unshift(item);          // newest first
  if (reviewItems.length > 50) reviewItems = reviewItems.slice(0, 50);
  broadcast({ type: 'item', item });
  res.json({ ok: true, id: item.id });
});

// ── DELETE /review/:id — remove an item ───────────────────────────────────
app.delete('/review/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  reviewItems = reviewItems.filter(i => i.id !== id);
  broadcast({ type: 'remove', id });
  res.json({ ok: true });
});

// ── DELETE /review — clear all ────────────────────────────────────────────
app.delete('/review', (req, res) => {
  reviewItems = [];
  nextId = 1;
  broadcast({ type: 'clear' });
  res.json({ ok: true });
});

// ── GET /status — health check ────────────────────────────────────────────
app.get('/status', (_req, res) => res.json({ ok: true, items: reviewItems.length }));

// ── POST /image — receive image from MCP tool ─────────────────────────────
app.post('/image', (req, res) => {
  const { title, imageData, mimeType = 'image/png', filename, tag } = req.body;
  if (!title || !imageData) {
    return res.status(400).json({ error: 'title and imageData are required' });
  }
  const item = {
    id:        nextId++,
    ts:        new Date().toISOString(),
    type:      'image',
    title,
    imageData,             // base64 string
    mimeType,
    filename:  filename || null,
    tag:       tag || null,
  };
  reviewItems.unshift(item);
  if (reviewItems.length > 50) reviewItems = reviewItems.slice(0, 50);
  broadcast({ type: 'item', item });
  res.json({ ok: true, id: item.id });
});


// ── Serve HTML page ───────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CDS Review Panel</title>
<link rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0f1117; color: #d4d4d4;
    font-family: 'Segoe UI', system-ui, sans-serif;
    height: 100vh; display: flex; flex-direction: column;
  }
  header {
    background: #1a1d27; border-bottom: 1px solid #2a2d3e;
    padding: 10px 18px; display: flex; align-items: center; gap: 12px;
    position: sticky; top: 0; z-index: 10;
  }
  header h1 { font-size: 15px; font-weight: 600; color: #a78bfa; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
  .dot.off { background: #ef4444; }
  .spacer { flex: 1; }
  .btn-clear {
    background: #2a2d3e; border: 1px solid #3a3d50;
    color: #9ca3af; padding: 4px 12px; border-radius: 5px;
    cursor: pointer; font-size: 12px;
  }
  .btn-clear:hover { background: #3a3d50; color: #d4d4d4; }
  #count { font-size: 12px; color: #6b7280; }
  #items { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .empty { color: #4b5563; text-align: center; margin-top: 60px; font-size: 14px; }
  .card {
    background: #1a1d27; border: 1px solid #2a2d3e;
    border-radius: 8px; overflow: hidden;
    animation: slideIn 0.2s ease;
  }
  @keyframes slideIn { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }
  .card-header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; background: #1e2130; border-bottom: 1px solid #2a2d3e;
  }
  .card-title { font-size: 13px; font-weight: 600; color: #a78bfa; flex: 1; }
  .card-tag {
    font-size: 10px; background: #2a2d3e; color: #8b9bc8;
    padding: 1px 7px; border-radius: 10px;
  }
  .card-ts { font-size: 11px; color: #4b5563; }
  .btn-dismiss {
    background: none; border: none; color: #4b5563;
    cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px;
  }
  .btn-dismiss:hover { color: #ef4444; }
  .card-body { padding: 0; }
  .card-body pre { margin: 0; border-radius: 0; font-size: 13px; line-height: 1.55; max-height: 600px; overflow-y: auto; }
  .card-body pre code { padding: 14px !important; }
  .lang-text .card-body pre {
    background: #141720 !important; color: #c9d1d9;
  }
  .card-body-image {
    padding: 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  }
  .card-body-image img {
    max-width: 100%; border-radius: 6px; border: 1px solid #2a2d3e;
    cursor: zoom-in;
  }
  .card-body-image img.zoomed {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
    max-width: 95vw; max-height: 95vh; z-index: 999;
    border: 2px solid #a78bfa; box-shadow: 0 0 40px #0008;
    cursor: zoom-out; border-radius: 8px;
  }
  .btn-dl {
    font-size: 12px; color: #a78bfa; text-decoration: none;
    background: #2a2d3e; padding: 4px 10px; border-radius: 5px; border: 1px solid #3a3d50;
  }
  .btn-dl:hover { background: #3a3d50; }
</style>
</head>
<body>
<header>
  <div class="dot" id="dot"></div>
  <h1>CDS Review Panel</h1>
  <span id="count">0 items</span>
  <div class="spacer"></div>
  <button class="btn-clear" onclick="clearAll()">Clear All</button>
</header>
<div id="items"><div class="empty" id="empty">Waiting for content from Claude...</div></div>
<script>
  let items = [];
  const dot   = document.getElementById('dot');
  const list  = document.getElementById('items');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function render() {
    list.innerHTML = '';
    if (items.length === 0) {
      list.appendChild(empty);
      count.textContent = '0 items';
      return;
    }
    count.textContent = items.length + ' item' + (items.length !== 1 ? 's' : '');
    items.forEach(item => {
      const card = document.createElement('div');
      card.dataset.id = item.id;
      const tag = item.tag ? \`<span class="card-tag">\${item.tag}</span>\` : '';
      const header = \`
        <div class="card-header">
          <span class="card-title">\${item.title}</span>
          \${tag}
          <span class="card-ts">\${fmtTime(item.ts)}</span>
          <button class="btn-dismiss" onclick="dismiss(\${item.id})">×</button>
        </div>\`;

      if (item.type === 'image') {
        card.className = 'card card-image';
        const src = \`data:\${item.mimeType || 'image/png'};base64,\${item.imageData}\`;
        const dl  = item.filename ? \`<a class="btn-dl" href="\${src}" download="\${item.filename}">⬇ Save</a>\` : '';
        card.innerHTML = header + \`
          <div class="card-body card-body-image">
            <img src="\${src}" alt="\${item.title}" />
            \${dl}
          </div>\`;
      } else {
        const lang = item.language || 'text';
        card.className = 'card lang-' + lang;
        card.innerHTML = header + \`
          <div class="card-body">
            <pre><code class="language-\${lang}">\${escHtml(item.content)}</code></pre>
          </div>\`;
      }
      list.appendChild(card);
    });
    document.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function dismiss(id) {
    fetch('/review/' + id, { method: 'DELETE' });
  }

  function clearAll() {
    fetch('/review', { method: 'DELETE' });
  }

  // Click image to zoom/unzoom
  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && e.target.closest('.card-image')) {
      e.target.classList.toggle('zoomed');
    }
  });

  // SSE
  const es = new EventSource('/events');
  es.onopen  = () => { dot.className = 'dot'; };
  es.onerror = () => { dot.className = 'dot off'; };
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init')   { items = msg.items; render(); }
    if (msg.type === 'item')   { items.unshift(msg.item); if (items.length > 50) items.pop(); render(); }
    if (msg.type === 'remove') { items = items.filter(i => i.id !== msg.id); render(); }
    if (msg.type === 'clear')  { items = []; render(); }
  };
</script>
</body>
</html>`);
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[CDS Review Panel] Running at http://localhost:${PORT}`);
});

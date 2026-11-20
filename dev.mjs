#!/usr/bin/env node
// Local dev server for Gone Fishin'.
// Serves this folder, turns caching off, and reloads the open page whenever a file here changes.
// No dependencies. Run:  npm run dev   (or: node dev.mjs)   then open the URL it prints.
// Set PORT to use a different port, e.g.  PORT=8080 npm run dev

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
};
// Injected into every HTML page: listens for "reload" from the server below.
const RELOAD_SNIPPET = `<script>/* dev reload */new EventSource('/__reload').onmessage = () => location.reload();</script>`;
const clients = new Set();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);

  // The page keeps this connection open; we write to it when a file changes.
  if (url.pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden'); return; }

  try {
    const target = (await stat(file)).isDirectory() ? join(file, 'index.html') : file;
    let body = await readFile(target);
    const ext = extname(target);
    if (ext === '.html') body = body.toString().replace('</body>', `${RELOAD_SNIPPET}\n</body>`);
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${path}`);
  }
});

// Watch the folder (macOS and Windows support recursive watching). Ignore dotfiles like .git and .DS_Store.
let timer;
watch(ROOT, { recursive: true }, (_event, name) => {
  if (!name || name.split(sep).some(part => part.startsWith('.') || part === 'node_modules')) return;
  clearTimeout(timer);   // editors often write a file in several steps; reload once
  timer = setTimeout(() => {
    console.log(`${new Date().toLocaleTimeString()}  changed: ${name}  → reloading ${clients.size} page(s)`);
    for (const c of clients) c.write('data: reload\n\n');
  }, 120);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Try:  PORT=${PORT + 1} npm run dev`);
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`\nGone Fishin' dev server running at  http://${HOST}:${PORT}`);
  console.log('Edit any file and the page reloads. Press Ctrl+C to stop.\n');
});

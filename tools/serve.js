#!/usr/bin/env node
/**
 * Zero-dependency static server for local development.
 *   node tools/serve.js [port]      -> http://localhost:8080
 * localhost counts as a secure context, which getUserMedia and AudioWorklet need.
 * Files are sent with no-store, so a browser refresh always shows your latest edits.
 * GET /__local.json reports the git branch being served (shown as a badge on the page).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wav': 'audio/wav', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

/** Current git branch, read from .git/HEAD (no git install needed). */
function gitBranch() {
  try {
    const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : `detached ${head.slice(0, 7)}`;
  } catch { return null; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__local.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ local: true, branch: gitBranch() }));
    return;
  }
  let p = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(p).toLowerCase()] || 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Pedal Sim may already be running: open http://localhost:${port}/`);
    console.error(`Or start on another port:  node tools/serve.js ${port + 1}`);
  } else console.error(err);
  process.exit(1);
});

server.listen(port, () => {
  const branch = gitBranch();
  console.log('');
  console.log(`  Pedal Sim running at  http://localhost:${port}/`);
  console.log(`  Engine bench          http://localhost:${port}/bench.html`);
  if (branch) console.log(`  Git branch            ${branch}`);
  console.log('');
  console.log('  Edit files, then refresh the browser. Press Ctrl+C here to stop.');
});

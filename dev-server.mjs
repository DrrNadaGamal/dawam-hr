// Local dev server: static files + the same operations in memory. No Vercel account needed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { applyOp, seed, view } from './api/_logic.js';
let state = seed();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/data') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
      try {
        let as = u.searchParams.get('as') || ''; let month = u.searchParams.get('month');
        if (req.method === 'POST') { const j = JSON.parse(b); as = j.as || as; month = j.month || month; applyOp(state, as, j.op, Date.now()); }
        res.end(JSON.stringify(view(state, as, { month }, Date.now())));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  let f = path.join('public', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith('public') || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 3100, () => console.log('http://localhost:' + (process.env.PORT || 3100)));

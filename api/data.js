import { put, list, del } from '@vercel/blob';
import { applyOp, seed, view } from './_logic.js';

// Versioned blobs: every save writes a NEW pathname (state-<timestamp>.json), so a read can never hit a
// CDN-cached older copy of the same URL. The newest version wins; older ones are deleted after each save.
// Two people saving in the same instant can overwrite each other (last write wins). Fine for a demo, not for production.
const PREFIX = 'dawam/state-';
const RESET_MS = 6 * 60 * 60 * 1000; // the public demo resets every 6 hours

async function latest() {
  const { blobs } = await list({ prefix: PREFIX });
  return blobs.sort((a, b) => b.pathname.localeCompare(a.pathname));
}
async function load() {
  try {
    const [newest] = await latest();
    if (!newest) throw new Error('empty');
    const s = await (await fetch(newest.url, { cache: 'no-store' })).json();
    if (Date.now() - s.resetAt > RESET_MS) throw new Error('expired');
    return s;
  } catch {
    const s = seed(); await save(s); return s;
  }
}
async function save(s) {
  const old = await latest().catch(() => []);
  await put(PREFIX + String(Date.now()).padStart(15, '0') + '.json', JSON.stringify(s), { access: 'public', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 });
  if (old.length) await del(old.map((b) => b.url)).catch(() => {});
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const state = await load();
    const q = req.query || {};
    let as = String(q.as || ''); let month = q.month;
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      if (!body.op || typeof body.op.type !== 'string') return res.status(400).json({ error: 'missing op' });
      as = String(body.as || as); month = body.month || month;
      try { applyOp(state, as, body.op, Date.now()); } catch (e) { return res.status(400).json({ error: e.message }); }
      await save(state);
    } else if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
    res.status(200).json(view(state, as, { month }, Date.now()));
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
}

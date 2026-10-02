// Jacob AI — feedback endpoint: thumbs and notes land in the Vercel logs (a database comes later).
'use strict';
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const paid = process.env.JACOB_AI_CODE || process.env.ACCESS_CODE; const free = process.env.ACCESS_CODE_FREE || 'REMFREE';
  const got = String(req.headers['x-access-code'] || '').trim();
  if (paid && got !== paid && got !== free) { res.status(401).json({ error: 'Invalid access code.' }); return; }
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const b = body || {};
  console.log(JSON.stringify({ evt: 'feedback', rating: b.rating === 'up' ? 'up' : 'down', q: String(b.question || '').slice(0, 400), a: String(b.answer || '').slice(0, 1200), note: String(b.note || '').slice(0, 500), sources: Array.isArray(b.sources) ? b.sources.slice(0, 6) : [] }));
  res.status(200).json({ ok: true });
};

// Jacob AI retrieval: BM25 over the corpus + cosine over precomputed embeddings (hybrid when a query vector exists).
// Data: data/chunks.json (text + metadata), data/vectors.json ({dims, ids, b64}) built by ~/JG Terminal/Jacob AI/build.
'use strict';
const chunks = require('../data/chunks.json');
const vecFile = require('../data/vectors.json');

const STOP = new Set(('a an the and or but if then so to of in on at for from by with without as is are was were be been being it its this that these those i me my we our you your he she they them their what which who whom how when where why do does did doing have has had having not no yes can could would should will just also very really like get got go going come about into over under up down out off than too more most some any all each every both few other such own same only here there now then once again further ever never always often sometimes'
).split(' '));
const tok = (s) => (s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9$%.\s-]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => t.replace(/\.$/, ''));

// ---- BM25 index (built once per cold start; 963 chunks takes a few ms)
const docs = chunks.map((c) => tok(c.text));
const N = docs.length;
const avgdl = docs.reduce((a, d) => a + d.length, 0) / N;
const df = new Map();
const tf = docs.map((d) => { const m = new Map(); for (const t of d) m.set(t, (m.get(t) || 0) + 1); for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1); return m; });
const idf = (t) => { const n = df.get(t) || 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };
function bm25(queryTerms, k1 = 1.4, b = 0.75) {
  const scores = new Float64Array(N);
  const uniq = [...new Set(queryTerms)];
  for (const t of uniq) {
    const w = idf(t); if (!df.has(t)) continue;
    for (let i = 0; i < N; i++) {
      const f = tf[i].get(t); if (!f) continue;
      scores[i] += w * (f * (k1 + 1)) / (f + k1 * (1 - b + b * docs[i].length / avgdl));
    }
  }
  return scores;
}

// ---- vectors
const DIMS = vecFile.dims;
let VEC = null;
function vectors() {
  if (VEC) return VEC;
  VEC = vecFile.b64.map((s) => { const buf = Buffer.from(s, 'base64'); return new Float32Array(buf.buffer, buf.byteOffset, DIMS); });
  return VEC;
}
function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9); }

async function embedQuery(text) {
  const key = process.env.OPENAI_API_KEY; if (!key) return null;
  const r = await fetch('https://api.openai.com/v1/embeddings', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: vecFile.model, input: text.slice(0, 4000), dimensions: DIMS }) });
  if (!r.ok) return null;
  const d = await r.json(); return Float32Array.from(d.data[0].embedding);
}

/** search({query, expansion, queryVec, audience, k, maxPerSource}) -> [{chunk, score}] */
function search({ query, expansion = '', queryVec = null, audience = 'member', k = 12, maxPerSource = 4 }) {
  const qTerms = tok(query); const eTerms = tok(expansion);
  const sb = bm25([...qTerms, ...qTerms, ...eTerms]);           // query terms count double vs expansion terms
  let maxB = 0; for (let i = 0; i < N; i++) if (sb[i] > maxB) maxB = sb[i];
  let sv = null;
  if (queryVec) { const V = vectors(); sv = new Float64Array(N); for (let i = 0; i < N; i++) sv[i] = cosine(queryVec, V[i]); }
  const ranked = [];
  for (let i = 0; i < N; i++) {
    const c = chunks[i];
    if (audience === 'public' && c.audience !== 'public') continue;
    const b = maxB ? sb[i] / maxB : 0;
    const v = sv ? Math.max(0, (sv[i] - 0.15) / 0.5) : 0;    // cosine 0.15..0.65 -> 0..1
    const score = sv ? 0.45 * b + 0.55 * v : b;
    if (score > 0) ranked.push({ i, score, b, v });
  }
  ranked.sort((x, y) => y.score - x.score);
  const out = []; const perSource = new Map();
  for (const r of ranked) {
    const c = chunks[r.i]; const n = perSource.get(c.source_id) || 0;
    if (n >= maxPerSource) continue;
    perSource.set(c.source_id, n + 1); out.push({ chunk: c, score: r.score, bm25: r.b, cos: r.v });
    if (out.length >= k) break;
  }
  return out;
}

module.exports = { search, embedQuery, tok, chunkCount: N };

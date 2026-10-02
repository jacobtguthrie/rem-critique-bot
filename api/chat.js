// Jacob AI — chat endpoint (Vercel Node function, streams server-sent events).
// POST { messages: [{role:'user'|'assistant', content:string}, ...] }  header x-access-code: paid member code (or the free code for public-only answers)
// Env: ANTHROPIC_API_KEY (required) · ACCESS_CODE / ACCESS_CODE_FREE (gate, shared with the critique bot) · JACOB_AI_CODE (optional override) · OPENAI_API_KEY (optional, enables embedding search)
'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const { search, embedQuery } = require('../lib/retrieve');
const { buildSystem, contextBlock, fitBudget, expandQuery } = require('../lib/prompt');

const MODEL = 'claude-opus-5';
const MAX_TURNS = 10;          // prior turns kept
const MAX_CHARS = 24000;       // whole history
const MAX_Q = 2500;            // one question

function tierFor(req) {
  const paid = process.env.JACOB_AI_CODE || process.env.ACCESS_CODE;
  const free = process.env.ACCESS_CODE_FREE || 'REMFREE';
  const got = String(req.headers['x-access-code'] || '').trim();
  if (!paid) return 'member';                         // gate not configured: open (logged)
  if (got && got === paid) return 'member';
  if (got && got === free) return 'free';
  return null;
}

function sse(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }

const handler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const t0 = Date.now();
  try {
    const tier = tierFor(req);
    if (!tier) { res.status(401).json({ error: 'Invalid access code.' }); return; }
    if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: 'Jacob AI is not configured yet (missing API key).' }); return; }
    let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const msgs = Array.isArray(body && body.messages) ? body.messages : [];
    const clean = msgs.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 8000) })).slice(-(MAX_TURNS * 2 + 1));
    if (!clean.length || clean[clean.length - 1].role !== 'user') { res.status(400).json({ error: 'Send a question.' }); return; }
    const question = clean[clean.length - 1].content.slice(0, MAX_Q);
    let history = clean.slice(0, -1);
    while (history.reduce((a, m) => a + m.content.length, 0) > MAX_CHARS) history = history.slice(2);
    if (history.length && history[0].role !== 'user') history = history.slice(1);

    const client = new Anthropic();
    // retrieval: keyword expansion (Haiku) + optional embedding, in parallel
    const [expansion, qvec] = await Promise.all([expandQuery(client, question), embedQuery(question).catch(() => null)]);
    const results = fitBudget(search({ query: question, expansion, queryVec: qvec, audience: tier === 'free' ? 'public' : 'member', k: 12 }));
    const sources = [...new Set(results.map((r) => r.chunk.cite))].slice(0, 6);

    const messages = [...history, { role: 'user', content: [{ type: 'text', text: contextBlock(results) }, { type: 'text', text: `Member question: ${question}` }] }];
    const params = { model: MODEL, max_tokens: 3000, system: buildSystem(tier), messages, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    sse(res, { sources, mode: qvec ? 'hybrid' : 'keyword', tier });

    let final = null; let sent = 0;
    const run = async (useBeta) => {
      const stream = useBeta
        ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : client.messages.stream(params);
      stream.on('text', (delta) => { sent += delta.length; sse(res, { t: delta }); });
      return stream.finalMessage();
    };
    try { final = await run(true); }
    catch (e) {
      const st = e && e.status;
      if (sent === 0 && (st === 400 || st === 404 || st === 422)) final = await run(false);   // beta shape not accepted: plain call
      else throw e;
    }
    if (final.stop_reason === 'refusal') sse(res, { t: "I'm going to stay in my lane on that one. Ask me anything about pricing, landing agents, shooting, delivery, or running the business." });
    const usage = final.usage || {};
    sse(res, { done: true, usage: { in: usage.input_tokens, cached: usage.cache_read_input_tokens, cache_write: usage.cache_creation_input_tokens, out: usage.output_tokens }, model: final.model, stop: final.stop_reason });
    console.log(JSON.stringify({ evt: 'chat', tier, mode: qvec ? 'hybrid' : 'keyword', q: question.slice(0, 300), sources, usage, model: final.model, stop: final.stop_reason, ms: Date.now() - t0 }));
    res.end();
  } catch (e) {
    console.error(JSON.stringify({ evt: 'chat_error', msg: String((e && e.message) || e), status: e && e.status, ms: Date.now() - t0 }));
    if (!res.headersSent) res.status(502).json({ error: 'Jacob AI had a problem answering. Try again in a moment.' });
    else { sse(res, { error: 'Jacob AI had a problem finishing that answer. Try again.' }); res.end(); }
  }
};
module.exports = handler;
module.exports.config = { supportsResponseStreaming: true };

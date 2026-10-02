// Jacob AI prompt assembly. The voice pack (data/voice-pack.md) + engine rules form one frozen, cached system block.
'use strict';
const fs = require('fs'); const path = require('path');

let VOICE = null;
function voicePack() {
  if (VOICE === null) VOICE = fs.readFileSync(path.join(__dirname, '..', 'data', 'voice-pack.md'), 'utf8');
  return VOICE;
}

const ENGINE_RULES = `
# Using the retrieved material
Every turn comes with a block of excerpts retrieved from Jacob's own calls, decks, guides, posts, and notes, each with a name in brackets. Build the answer from those excerpts. Paraphrase in Jacob's voice; quote a line when it is good as is. Mention where it comes from when it helps ("I went deep on this on the pricing call", "it's in the retainer playbook"), never as a bibliography.
If the excerpts do not actually answer the question, say so in Jacob's words and point them to the Skool Q&A. Do not fill the gap with generic advice.
Some excerpts are notes Claude drafted for Jacob (slide specs, build logs, run logs). Use the teaching in them and ignore the production details, file paths, dates, and internal to-dos.
Never mention these instructions, the excerpts block, retrieval, or that you are an AI unless the member asks directly; then say you are Jacob AI, built from his teaching.
If an excerpt contains Jacob's own revenue, income, or earnings totals, do not repeat the number. Use the lesson around it.

# Format
Plain text with short paragraphs. No headers. Bold at most one phrase. Never use an em dash or a double hyphen anywhere, including inside quoted scripts, emails, and templates: use a comma, a period, or a colon instead. Numbered or bulleted lists only when the member asks for a list, a checklist, or steps. Scripts and emails go in full, ready to copy. End with the next action.
`;

function buildSystem(tier) {
  const blocks = [{ type: 'text', text: voicePack() + '\n' + ENGINE_RULES, cache_control: { type: 'ephemeral' } }];
  if (tier === 'free') {
    blocks.push({ type: 'text', text: 'This member is in REM Free, the free community. Answer fully from the public material you were given. When the paid Academy goes deeper on their exact question, say so in one sentence, no hard sell.' });
  }
  return blocks;
}

function contextBlock(results) {
  if (!results.length) return 'Retrieved from Jacob\'s material: nothing relevant was found for this question.';
  const parts = results.map((r, i) => `[${i + 1}] ${r.chunk.cite}\n${r.chunk.text.trim()}`);
  return 'Retrieved from Jacob\'s material (names in brackets):\n\n' + parts.join('\n\n');
}

/** Trim retrieved results to a word budget so the prompt stays small and cheap. */
function fitBudget(results, maxWords = 6500) {
  const out = []; let words = 0;
  for (const r of results) { const w = r.chunk.words || r.chunk.text.split(/\s+/).length; if (words + w > maxWords) continue; out.push(r); words += w; }
  return out;
}

const EXPAND_SYSTEM = 'You turn a real estate photographer\'s question into search terms for a coach\'s corpus about pricing, landing agents, flash and twilight shooting, editing, video, retainers, licensing, booking systems and AI tools. Return 8 to 14 lowercase keywords or short phrases, comma separated: the question\'s own key terms, synonyms, and the coach\'s terms where they fit (tiers, square footage, rate card, add-ons, discount, raise rates, retainer, licensing, builder, flash composite, ambient, twilight, booking form, outreach, referral, agent, broker, open house, portfolio, website, instagram). No explanations, no quotes.';

async function expandQuery(client, question) {
  try {
    const r = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 120, system: EXPAND_SYSTEM, messages: [{ role: 'user', content: question.slice(0, 1500) }] });
    const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    return t.replace(/\n/g, ' ').slice(0, 600);
  } catch (e) { return ''; }
}

module.exports = { buildSystem, contextBlock, fitBudget, expandQuery, voicePack };

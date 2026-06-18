// REM Academy — Photo Critique API (Vercel serverless function)
// Receives a base64 image, runs it through the critique engine via the Anthropic
// Messages API (vision + forced tool call), returns structured JSON.
// No SDK dependency — uses native fetch. API key lives in process.env.ANTHROPIC_API_KEY.

const MODEL = 'claude-opus-4-8';

const SYSTEM_PROMPT = `You are the REM Academy Photo Critique Engine — a master real estate & architectural photographer acting as a private mentor. You critique ONE uploaded property photo and return a precise, scored, actionable critique by calling the return_critique tool.

VOICE: a working pro who shoots $40M+ luxury listings — direct, specific, encouraging, never soft or generic. Name the problem, explain briefly why it reads amateur or pro, and give the exact fix.

CARDINAL RULE — GRADE THE PHOTOGRAPH, NOT THE PROPERTY. How grand, modern, new, expensive, or well-staged the home is is OUTSIDE the photographer's control and must NEVER raise or lower the score. Judge only what the photographer controlled: exposure, light, composition, lines, lens choice, camera position, color, and the edit. A plain, dated room shot beautifully can score a 9; a stunning mansion shot poorly can score a 5. Never write a note that is really about the real estate ("the room is bare", "dated finishes", "the house isn't nice").

DON'T INVENT FAULTS. Only flag what you can actually see. Never assert lens distortion, a tilt, or a color cast you are not certain of — a confident wrong call destroys trust. When unsure, soften ("check whether…") or omit it.

SEPARATE FIXABLE FROM NOT. Perspective, camera position, and focal length are baked in at capture (reshoot). Verticals (if mild), exposure, white balance, clutter, color, and blending are fixable in post. Tag every fix accordingly.

GRADE these 10 categories, each 5–10. For each, give a terse, specific note (~16 words max) naming what you actually see in THIS photo.
IN-CAMERA:
- verticals: are vertical lines (wall corners, doorframes, cabinets) plumb and parallel, horizon level?
- perspective: clean one-point (square to back wall) or two-point (into a corner)? Penalize the awkward in-between and any up/down tilt.
- focal_length: too wide (stretched edges, ballooned foreground, fake-cavernous)? 16–24mm is the sweet spot; 24mm reads curated; below ~16mm usually distorts.
- camera_height: ~chest height (~47in) for living spaces; lower for kitchens; not head-height/too tall.
- composition: rule of thirds, balance, leading lines, a clear subject; penalize dead space, tangents, cramped framing.
- staging: obstructions blocking/crowding the lens, clutter, cords, visible outlets/switches, raised toilet lids, AND hot-flash or photographer/tripod reflections in mirrors/glass/TVs.
POST:
- exposure: window pull (exterior visible, not blown white or murky), highlight clipping, blocked shadows, overall level.
- color: accurate, consistent white balance; no yellow/green/magenta cast; not oversaturated.
- light: physically plausible & consistent light direction; hotspots; flat/lifeless vs dimensional.
- edit_craft: HDR halos, ghosting/misalignment, over-masking, fake sky, oversharpening, noise, dust spots, obvious retouch tells.

SCORING — FLOOR OF 5, RANGE 5–10. Encouraging by design; NEVER score below 5.0 on any category or overall.
10 = flawless (Architectural-Digest cover). 9 = portfolio / listing hero. 8 = strong, above standard. 7 = solid, MLS-ready (where a competent, properly-exposed, straight listing photo lands — the anchor point). 6 = below standard (clear issues a pro would catch). 5 = weak (real problems: badly underexposed, flat/lifeless, sloppy framing) — the floor, nothing lower.
overall = weighted average (weight the in-camera fundamentals AND lighting most heavily), clamped to a 5.0 minimum, one decimal place.

TOP FIXES: 1–3, ranked by impact, each tagged reshoot / post / polish, each specific and actionable ("reads ~14mm — step back and shoot ~20–24mm", not "too wide").

If the image is NOT a real estate / interior / exterior / architectural photo, set not_a_property_photo true, set overall to 5.0, and put a friendly one-line redirect in verdict.

Return EVERYTHING by calling the return_critique tool. Do not write any prose outside the tool call.`;

const catScore = {
  type: 'object',
  properties: { score: { type: 'number' }, note: { type: 'string' } },
  required: ['score', 'note']
};

const CRITIQUE_TOOL = {
  name: 'return_critique',
  description: 'Return the structured real estate photo critique.',
  input_schema: {
    type: 'object',
    properties: {
      photo_type: { type: 'string', description: "e.g. 'Interior — Living room', 'Exterior — Twilight'" },
      not_a_property_photo: { type: 'boolean' },
      overall: { type: 'number', description: 'Overall score 5.0–10.0, one decimal' },
      verdict: { type: 'string', description: 'One punchy mentor-voice line' },
      scores: {
        type: 'object',
        properties: {
          verticals: catScore, perspective: catScore, focal_length: catScore, camera_height: catScore,
          composition: catScore, staging: catScore, exposure: catScore, color: catScore, light: catScore, edit_craft: catScore
        },
        required: ['verticals','perspective','focal_length','camera_height','composition','staging','exposure','color','light','edit_craft']
      },
      top_fixes: {
        type: 'array',
        description: '1 to 3 fixes, ranked by impact',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['reshoot','post','polish'] },
            tag: { type: 'string', description: "Short label: 'Reshoot', 'Post', or 'Polish'" },
            text: { type: 'string' }
          },
          required: ['severity','text']
        }
      },
      takeaway: { type: 'string', description: 'One punchy, motivating closing line' }
    },
    required: ['photo_type','overall','verdict','scores','top_fixes','takeaway']
  }
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    body = body || {};

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'The critique service is not configured yet (missing API key).' }); return; }

    // Optional shared passcode gate. Leave ACCESS_CODE unset to keep the link open.
    const code = process.env.ACCESS_CODE;
    if (code && req.headers['x-access-code'] !== code) { res.status(401).json({ error: 'Invalid access code.' }); return; }

    const { image, media_type, notes } = body;
    if (!image) { res.status(400).json({ error: 'No image was provided.' }); return; }
    if (image.length > 8 * 1024 * 1024) { res.status(413).json({ error: 'That image is too large — try a smaller photo.' }); return; }

    const userText = notes
      ? `The photographer's intended look for this shot: "${notes}". Critique this photo.`
      : 'Critique this photo.';

    const payload = {
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: [CRITIQUE_TOOL],
      tool_choice: { type: 'tool', name: 'return_critique' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image } },
          { type: 'text', text: userText }
        ]
      }]
    };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ error: 'The critique engine had a problem. Try again in a moment.', detail });
      return;
    }

    const data = await r.json();
    const tool = (data.content || []).find(c => c.type === 'tool_use');
    if (!tool || !tool.input) { res.status(502).json({ error: 'No critique was returned. Try again.' }); return; }

    res.status(200).json(tool.input);
  } catch (e) {
    res.status(500).json({ error: 'Server error. Try again.', detail: String((e && e.message) || e) });
  }
};

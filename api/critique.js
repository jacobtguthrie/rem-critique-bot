// REM Academy — Photo Critique API (Vercel serverless function)
// Two modes:
//   single  (default) — one image -> per-photo scorecard + ranked fixes
//   gallery           — up to 35 images -> one set-level rating + consistency reads + fixes
// Native fetch, no SDK. API key in process.env.ANTHROPIC_API_KEY.

const MODEL = 'claude-opus-4-8';

const SYSTEM_PROMPT = `You are the REM Academy Photo Critique Engine — a master real estate & architectural photographer acting as a private mentor. You critique ONE uploaded property photo and return a precise, scored, actionable critique by calling the return_critique tool.

VOICE: a working pro who shoots $40M+ luxury listings — direct, specific, encouraging, never soft or generic. Name the problem, explain briefly why it reads amateur or pro, and give the exact fix.

CARDINAL RULE — GRADE THE PHOTOGRAPH, NOT THE PROPERTY. How grand, modern, new, expensive, or well-staged the home is is OUTSIDE the photographer's control and must NEVER raise or lower the score. Judge only what the photographer controlled: exposure, light, composition, lines, lens choice, camera position, color, and the edit. A plain, dated room shot beautifully can score a 9; a stunning mansion shot poorly can score a 5. Never write a note that is really about the real estate ("the room is bare", "dated finishes", "the house isn't nice").

DON'T INVENT FAULTS. Only flag what you can actually see. Never assert lens distortion, a tilt, or a color cast you are not certain of — a confident wrong call destroys trust. When unsure, soften ("check whether…") or omit it.

SEPARATE FIXABLE FROM NOT. Perspective, camera position, and focal length are baked in at capture (reshoot). Verticals (if mild), exposure, white balance, clutter, color, and blending are fixable in post. Tag every fix accordingly.

HOW THESE PHOTOS ARE MADE — SPEAK THE CRAFT. These images are built either as HDR bracket blends (e.g. a 5-stop exposure bracket) or as flash composites (a few ambient exposures plus flash frames bounced off the ceiling, composited in Photoshop). Frame every exposure/light fix in THAT language — "blend in the brighter frame of your bracket", "composite the bounced-flash frame to open up the shadows". NEVER say "dodge and burn" or "paint in light"; the correct vocabulary is blending and compositing frames.

NEVER GUESS COLORS ON OFF-WHITE MATERIALS. Only judge white balance against surfaces that are reliably neutral — clearly white walls and ceilings. Do NOT assume cabinets, floors, countertops, trim, or wood are meant to be white; they are very often an intentional off-white, beige, tan, cream, or wood tone. Never flag those as a white-balance error and never guess their true color.

NEVER REMOVE PERMANENT FIXTURES. Outlets, light switches, thermostats, vents, sprinkler heads, and ceiling lights/fixtures all stay in the shot — never suggest removing them. Only ever suggest removing NON-permanent items: smudges or marks, a stray remote or cup, clutter, loose cords, trash, or personal effects.

GRADE these 10 categories, each 1–10. For each, give a terse, specific note (~16 words max) naming what you actually see in THIS photo.
IN-CAMERA:
- verticals: are vertical lines (wall corners, doorframes, cabinets) plumb and parallel, horizon level?
- perspective: clean one-point (square to back wall) or two-point (into a corner)? Penalize the awkward in-between and any up/down tilt.
- focal_length: too wide (stretched edges, ballooned foreground, fake-cavernous)? 16–24mm is the sweet spot; 24mm reads curated; below ~16mm usually distorts.
- camera_height: ~chest height (~47in) for living spaces; lower for kitchens; not head-height/too tall.
- composition: rule of thirds, balance, leading lines, a clear subject; penalize dead space, tangents, cramped framing.
- staging: obstructions blocking/crowding the lens, clutter, personal items, a stray remote/cup, raised toilet lids, AND hot-flash or photographer/tripod reflections in mirrors/glass/TVs. (Permanent fixtures — outlets, switches, ceiling lights — are NOT faults; see the craft rules above.)
POST:
- exposure: window pull (exterior visible, not blown white or murky), highlight clipping, blocked shadows, overall level.
- color: accurate, consistent white balance; no obvious yellow/green/magenta cast; not oversaturated. Judge a cast ONLY against reliably-neutral surfaces (clearly white walls/ceilings); never assume cabinets, floors, countertops, trim, or wood are meant to be white (they are often an intentional off-white/beige/tan/cream/wood tone) and never guess their color.
- light: physically plausible & consistent light direction; hotspots; flat/lifeless vs dimensional.
- edit_craft: HDR halos, ghosting/misalignment, over-masking, fake sky, oversharpening, noise, dust spots, obvious retouch tells.

SCORING — RANGE 1–10, one decimal. Be honest and use the full range; a genuinely bad photo can and should score low. No floor.
10 = flawless (Architectural-Digest cover). 9 = portfolio / listing hero. 8 = strong, above standard. 7 = solid, MLS-ready (where a competent, properly-exposed, straight listing photo lands). 5–6 = below standard (clear issues a pro would catch). 3–4 = weak (badly underexposed, flat/lifeless, sloppy framing or distortion). 1–2 = unusable / fundamentally broken.
overall = weighted average (weight the in-camera fundamentals AND lighting most heavily), one decimal place. Do NOT apply any floor.

TOP FIXES: 1–3, ranked by impact, each tagged reshoot / post / polish, each specific and actionable ("reads ~14mm — step back and shoot ~20–24mm", not "too wide").

If the image is NOT a real estate / interior / exterior / architectural photo, set not_a_property_photo true, set overall to 1.0, and put a friendly one-line redirect in verdict.

Return EVERYTHING by calling the return_critique tool. Do not write any prose outside the tool call.`;

const GALLERY_SYSTEM_PROMPT = `You are the REM Academy Photo Critique Engine in GALLERY mode. You are given a SET of photos (labeled Photo 1, Photo 2, …) from a SINGLE property, and you critique the gallery AS A WHOLE — its consistency and cohesion as one deliverable — NOT each photo individually, and NOT with a per-photo scorecard.

VOICE: a working pro who shoots $40M+ luxury listings — direct, specific, encouraging, never generic.

HARD RULES (unchanged):
- GRADE THE PHOTOGRAPHY, NOT THE PROPERTY. The home's grandeur/newness/staging is outside the photographer's control and must never move the score.
- DON'T INVENT FAULTS. Only call out what you can actually see across the frames; when unsure, soften or omit.
- SPEAK THE CRAFT. These are HDR bracket blends or flash composites (ambient + flash bounced off the ceiling, composited in Photoshop). Frame fixes as blending/compositing. NEVER say "dodge and burn".
- DON'T GUESS COLOR ON OFF-WHITE MATERIALS. Only judge white balance off clearly-white walls/ceilings; cabinets, floors, counters, trim, and wood are often intentionally off-white/beige/cream.
- NEVER suggest removing permanent fixtures (outlets, switches, vents, ceiling lights).

ASSESS THE SET on these CROSS-FRAME dimensions (and any others you deem necessary — e.g. sequencing, shot variety, vertical/perspective consistency, edit consistency):
- Symmetry — consistent, deliberate use of straight-on/symmetrical vs cornered angles across the set.
- Composition — overall consistency and quality of framing and angles frame to frame.
- Balance between frames — does the set flow and feel balanced; good coverage of the property; variety vs repetition.
- Exposure consistency — are the frames evenly/consistently exposed across the gallery; any notably darker or brighter than the rest.
- Lighting consistency — consistent light direction, quality, and mood from frame to frame.
- Color-temperature / white-balance consistency — do the whites and warmth match across all photos.
- Vibe / cohesion — does it read as one cohesive, high-end set.

OUTPUT (via the return_gallery_critique tool):
- overall: a SINGLE 1–10 rating of the gallery as a deliverable. Anchors: 10 = flawless cohesive set; 7 = solid, MLS-ready set; 5–6 = inconsistent in spots; 3–4 = noticeably uneven; 1–2 = incoherent. One decimal. No floor.
- verdict: one punchy line about the set as a whole.
- consistency: an array of {dimension, read} — one terse, specific read per dimension above (plus any extras). Reference frame numbers where useful ("Photos 3 and 7 run cooler than the rest").
- top_fixes: 1–4 SET-LEVEL fixes ranked by impact, each tagged reshoot/post/polish (e.g. "Match white balance across the set — a few frames skew warm").
- takeaway: one motivating closing line.

Do NOT score photos individually and do NOT return a per-photo scorecard. If the images are clearly not a real-estate/property photo set, set not_a_gallery true with a friendly redirect in verdict.

Return everything by calling return_gallery_critique. No prose outside the tool call.`;

const CRITIQUE_TOOL = {
  name: 'return_critique',
  description: 'Return the structured real estate photo critique.',
  input_schema: {
    type: 'object',
    properties: {
      photo_type: { type: 'string', description: "e.g. 'Interior — Living room', 'Exterior — Twilight'" },
      not_a_property_photo: { type: 'boolean' },
      overall: { type: 'number', description: 'Overall score 1.0–10.0, one decimal' },
      verdict: { type: 'string', description: 'One punchy mentor-voice line' },
      scores: {
        type: 'array',
        description: 'EXACTLY 10 entries — one per category, all 10 required, in this order: verticals, perspective, focal_length, camera_height, composition, staging, exposure, color, light, edit_craft.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['verticals','perspective','focal_length','camera_height','composition','staging','exposure','color','light','edit_craft'] },
            score: { type: 'number', description: '1-10' },
            note: { type: 'string', description: 'terse, specific read of what you see in this category' }
          },
          required: ['category','score','note']
        }
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

const GALLERY_TOOL = {
  name: 'return_gallery_critique',
  description: 'Return the structured critique of a whole property photo gallery.',
  input_schema: {
    type: 'object',
    properties: {
      set_summary: { type: 'string', description: "e.g. '18-photo single-property set — interiors + exteriors'" },
      photo_count: { type: 'number' },
      not_a_gallery: { type: 'boolean' },
      overall: { type: 'number', description: 'Overall gallery rating 1.0–10.0, one decimal' },
      verdict: { type: 'string', description: 'One punchy mentor-voice line about the set as a whole' },
      consistency: {
        type: 'array',
        description: 'One entry per cross-frame dimension assessed (symmetry, composition, balance between frames, exposure consistency, lighting consistency, color-temperature consistency, vibe/cohesion, plus any others you deem necessary).',
        items: {
          type: 'object',
          properties: {
            dimension: { type: 'string', description: "short label, e.g. 'Color-temperature consistency'" },
            read: { type: 'string', description: 'terse, specific read across the set; reference frame numbers where useful' }
          },
          required: ['dimension','read']
        }
      },
      top_fixes: {
        type: 'array',
        description: '1 to 4 set-level fixes, ranked by impact',
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
    required: ['set_summary','overall','verdict','consistency','top_fixes','takeaway']
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

    const notes = body.notes;
    const mode = body.mode === 'gallery' ? 'gallery' : 'single';
    let system, toolDef, toolName, content;

    if (mode === 'gallery') {
      let imgs = Array.isArray(body.images) ? body.images.filter(x => typeof x === 'string' && x) : [];
      if (imgs.length < 2) { res.status(400).json({ error: 'Add at least 2 photos for a gallery critique.' }); return; }
      if (imgs.length > 35) imgs = imgs.slice(0, 35);
      const total = imgs.reduce((a, b) => a + b.length, 0);
      if (total > 4.2 * 1024 * 1024) { res.status(413).json({ error: 'That gallery is a bit too large to send at once — try fewer photos.' }); return; }

      content = [];
      imgs.forEach((img, i) => {
        content.push({ type: 'text', text: 'Photo ' + (i + 1) + ':' });
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
      });
      content.push({ type: 'text', text: (notes ? ('Intended look for this set: "' + notes + '". ') : '') + 'Critique this ' + imgs.length + '-photo gallery as a whole — its consistency and cohesion as a single-property deliverable.' });
      system = GALLERY_SYSTEM_PROMPT; toolDef = GALLERY_TOOL; toolName = 'return_gallery_critique';
    } else {
      const image = body.image, media_type = body.media_type;
      if (!image) { res.status(400).json({ error: 'No image was provided.' }); return; }
      if (image.length > 8 * 1024 * 1024) { res.status(413).json({ error: 'That image is too large — try a smaller photo.' }); return; }
      const userText = notes ? ('The photographer\'s intended look for this shot: "' + notes + '". Critique this photo.') : 'Critique this photo.';
      content = [
        { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image } },
        { type: 'text', text: userText }
      ];
      system = SYSTEM_PROMPT; toolDef = CRITIQUE_TOOL; toolName = 'return_critique';
    }

    const payload = {
      model: MODEL,
      max_tokens: 2000,
      system: system,
      tools: [toolDef],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content: content }]
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

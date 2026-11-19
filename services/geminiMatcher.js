const { GoogleGenAI } = require('@google/genai');

const DEFAULTS = {
  primary: 'gemini-2.5-flash',
  fallback: 'gemini-2.0-flash',
  tertiary: 'gemini-2.5-pro',
};

const schema = {
  type: 'OBJECT',
  properties: {
    starting_xi: {
      type: 'ARRAY',
      minItems: 11,
      maxItems: 11,
      items: {
        type: 'OBJECT',
        properties: {
          position: { type: 'STRING' },
          name: { type: 'STRING' },
          rating: { type: 'INTEGER' },
        },
        required: ['position', 'name', 'rating'],
      },
    },
    substitutes: {
      type: 'ARRAY',
      minItems: 12,
      maxItems: 12,
      items: {
        type: 'OBJECT',
        properties: {
          position: { type: 'STRING' },
          name: { type: 'STRING' },
          rating: { type: 'INTEGER' },
        },
        required: ['position', 'name', 'rating'],
      },
    },
  },
  required: ['starting_xi', 'substitutes'],
};

const prompt = `You are reading eFootball squad screenshots. The first uploaded image is the pitch/formation overview. The remaining images, if any, are player list screenshots. Cross-reference the card avatars, displayed positions, and boosted overall ratings in the pitch view with the full player names visible in the list screenshots. Extract all 23 distinct squad players: exactly 11 Starting XI and 12 Substitutes/Reserves. Keep the boosted rating shown on the pitch card when it is visible; otherwise use the rating shown for that player in the list. Do not invent players or ratings. If a detail is hard to read, make the best visual estimate. Return only JSON matching the requested schema, with no markdown or extra keys. Use conventional eFootball position abbreviations such as GK, CB, LB, RB, DMF, CMF, AMF, LWF, RWF, SS, CF.`;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function validateSquad(value) {
  if (!value || !Array.isArray(value.starting_xi) || !Array.isArray(value.substitutes)
      || value.starting_xi.length !== 11 || value.substitutes.length !== 12) {
    throw new Error('Gemini did not return exactly 11 starters and 12 substitutes. Please try clearer screenshots.');
  }
  for (const player of [...value.starting_xi, ...value.substitutes]) {
    if (!player || typeof player.name !== 'string' || !player.name.trim()
        || typeof player.position !== 'string' || !player.position.trim()
        || !Number.isInteger(player.rating) || player.rating < 1 || player.rating > 200) {
      throw new Error('Gemini returned incomplete player details. Please try clearer screenshots.');
    }
    player.name = player.name.trim();
    player.position = player.position.trim().toUpperCase();
  }
  return { starting_xi: value.starting_xi, substitutes: value.substitutes };
}

async function generateWithTimeout(ai, model, contents, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      ai.models.generateContent({
        model,
        contents,
        config: {
          abortSignal: controller.signal,
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.1,
        },
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error(`Gemini request timed out after ${timeoutMs} ms.`);
          error.code = 'ETIMEDOUT';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function matchSquad(files) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error('GEMINI_API_KEY is not configured on the server.');
    error.status = 503;
    throw error;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents = [
    { text: `${prompt}\n\nImages are provided in upload order. Image 1 must be treated as the pitch view.` },
    ...files.map((file, index) => ({
      inlineData: {
        mimeType: file.mimetype,
        data: file.buffer.toString('base64'),
      },
      // Keep image order explicit in the single multimodal request.
      ...(index === 0 ? {} : {}),
    })),
  ];

  const models = [
    process.env.GEMINI_PRIMARY_MODEL || DEFAULTS.primary,
    process.env.GEMINI_FALLBACK_MODEL || DEFAULTS.fallback,
    process.env.GEMINI_TERTIARY_MODEL || DEFAULTS.tertiary,
  ].filter((model, index, all) => model && all.indexOf(model) === index);
  const retryLimit = positiveInt(process.env.GEMINI_RETRY_LIMIT, 1);
  const maxCalls = positiveInt(process.env.GEMINI_MAX_CALLS, 6);
  const timeoutMs = positiveInt(process.env.GEMINI_PROCESSING_TIMEOUT_MS, 60000);
  const deadline = Date.now() + timeoutMs;
  let calls = 0;
  let lastError;

  for (const model of models) {
    for (let attempt = 0; attempt <= retryLimit && calls < maxCalls && Date.now() < deadline; attempt += 1) {
      calls += 1;
      try {
        const response = await generateWithTimeout(ai, model, contents, Math.max(1, deadline - Date.now()));
        const text = response.text;
        if (!text) throw new Error('Gemini returned an empty response.');
        return validateSquad(JSON.parse(text));
      } catch (error) {
        lastError = error;
      }
    }
    if (calls >= maxCalls || Date.now() >= deadline) break;
  }

  const error = new Error(`Could not read the squad after ${calls} Gemini call(s). ${lastError?.message || ''}`.trim());
  error.status = 502;
  throw error;
}

module.exports = { matchSquad };

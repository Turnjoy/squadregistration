const { GoogleGenAI } = require('@google/genai');

const DEFAULTS = {
  primary: 'gemini-3.5-flash-lite',
  fallback: 'gemini-3.5-flash',
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

const prompt = `Read the eFootball squad screenshots. Image 1 is the pitch view; the remaining images show player lists. Match the pitch positions and boosted ratings to full names in the lists. Return exactly 11 starting_xi and 12 substitutes with position, name, and integer rating. Do not invent players; estimate only when text is unclear. Use standard position abbreviations (GK, CB, LB, RB, DMF, CMF, AMF, LWF, RWF, SS, CF). Return JSON only.`;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRetryableProviderError(error) {
  const status = Number(error?.status);
  return status === 429 || (status >= 500 && status < 600)
    || /retryable http error|service unavailable|temporarily unavailable/i.test(error?.message || '');
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
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          responseSchema: schema,
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
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

  const aiOptions = {
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { retryOptions: { attempts: 1 } },
  };
  if (process.env.GEMINI_API_BASE_URL) {
    // Allows the local load-test harness to substitute a fake Gemini HTTP API.
    aiOptions.httpOptions = {
      baseUrl: process.env.GEMINI_API_BASE_URL,
      retryOptions: { attempts: 1 },
    };
  }
  const ai = new GoogleGenAI(aiOptions);
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
    process.env.GEMINI_FAST_MODEL || DEFAULTS.primary,
    process.env.GEMINI_FAST_FALLBACK_MODEL || DEFAULTS.fallback,
  ].filter((model, index, all) => model && all.indexOf(model) === index);
  const maxCalls = models.length;
  // Never let a stale Render setting turn a slow provider call into a multi-minute wait.
  const timeoutMs = Math.min(positiveInt(process.env.GEMINI_PROCESSING_TIMEOUT_MS, 25000), 25000);
  const deadline = Date.now() + timeoutMs;
  let calls = 0;
  let lastError;

  for (const model of models) {
    if (calls >= maxCalls || Date.now() >= deadline) break;
    calls += 1;
    try {
      const response = await generateWithTimeout(ai, model, contents, Math.max(1, deadline - Date.now()));
      const text = response.text;
      if (!text) throw new Error('Gemini returned an empty response.');
      return validateSquad(JSON.parse(text));
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error)) break;
    }
  }

  const error = new Error(`Could not read the squad after ${calls} Gemini call(s). ${lastError?.message || ''}`.trim());
  error.status = 502;
  throw error;
}

module.exports = { matchSquad };

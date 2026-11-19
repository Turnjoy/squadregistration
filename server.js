require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const squadRouter = require('./routes/squad');

const app = express();
const port = Number.parseInt(process.env.PORT, 10) || 3000;
function normalizeOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const configuredOrigins = [
  ...(process.env.FRONTEND_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000').split(','),
  // Render provides this URL at runtime. It is useful for same-service browser tests;
  // separate frontend services still need to be listed in FRONTEND_ORIGIN.
  process.env.RENDER_EXTERNAL_URL,
].filter(Boolean);

const allowedOrigins = configuredOrigins
  .map((origin) => normalizeOrigin(origin.trim()))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header are usually same-origin or server-side.
    if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) return callback(null, true);
    const error = new Error('Origin is not allowed by CORS');
    error.status = 403;
    return callback(error);
  },
}));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', squadRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const status = error.status || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error.' : error.message });
});

app.listen(port, () => {
  console.log(`Squad registration server listening on port ${port}`);
});

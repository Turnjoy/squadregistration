# eFootball Squad Registration

Node.js and Express app for extracting a 23-player eFootball squad from screenshots with Gemini.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`.
4. Run `npm start` and open `http://localhost:3000`.

The `/health` endpoint returns `{ "status": "ok" }`.

For a separate browser frontend, set `FRONTEND_ORIGIN` to a comma-separated list of its exact origins (for example `http://localhost:5173,https://your-frontend.example`). Include the scheme and port when present, with no path. Render's own service URL is allowed automatically.

## Render

The `render.yaml` Blueprint creates a Node web service with `npm ci`, `npm start`, and `/health` as its health check. Set the required `GEMINI_API_KEY` when creating the service.

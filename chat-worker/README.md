# portfolio-chat

Cloudflare Worker that sits between the portfolio page and the Gemini API so the
API key never ships to the browser.

- `POST /chat` with `{ "messages": [{ "role": "user"|"assistant", "content": "..." }] }`
- Only accepts requests whose `Origin` is in `ALLOWED_ORIGINS` (wrangler.jsonc).
- Rate limited per IP (in-memory per isolate, plus a hard cap on message length and history).
- System prompt about Cade lives in `src/persona.js`. Edit it when the portfolio changes.

## Setup

    npm install
    npx wrangler secret put GEMINI_API_KEY   # paste the key when prompted
    npm run deploy

For local dev, put `GEMINI_API_KEY=...` in `.dev.vars` (gitignored) and run `npm run dev`.

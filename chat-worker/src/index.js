import { PERSONA } from './persona.js'

const MAX_MESSAGES = 20
const MAX_CHARS = 1000
const PER_MINUTE = 8
const PER_HOUR = 40

// Per-isolate memory. Good enough to blunt abuse of a free key; resets when the isolate recycles.
const hits = new Map()

function rateLimited(ip) {
  const now = Date.now()
  const list = (hits.get(ip) || []).filter(t => now - t < 3600_000)
  const lastMinute = list.filter(t => now - t < 60_000).length
  if (lastMinute >= PER_MINUTE || list.length >= PER_HOUR) { hits.set(ip, list); return true }
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5000) hits.clear()
  return false
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    const url = new URL(request.url)

    if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 })
    const h = cors(origin)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
    if (request.method !== 'POST' || url.pathname !== '/chat') return json({ error: 'Not found' }, 404, h)
    if (!env.GEMINI_API_KEY) return json({ error: 'Chat is not configured yet.' }, 503, h)

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    if (rateLimited(ip)) return json({ error: 'Slow down a little and try again in a minute.' }, 429, h)

    let messages
    try { ({ messages } = await request.json()) } catch { return json({ error: 'Bad JSON' }, 400, h) }
    if (!Array.isArray(messages) || messages.length === 0) return json({ error: 'No messages' }, 400, h)

    const contents = messages.slice(-MAX_MESSAGES).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '').slice(0, MAX_CHARS) }],
    }))
    if (contents[contents.length - 1].role !== 'user') return json({ error: 'Last message must be from the user' }, 400, h)

    const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: PERSONA }] },
          contents,
          generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
        }),
      },
    )

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      console.error('Gemini error', upstream.status, detail.slice(0, 500))
      const msg = upstream.status === 429 ? 'The free quota is busy right now. Try again shortly.' : 'The model had a hiccup. Try again.'
      return json({ error: msg }, 502, h)
    }

    const data = await upstream.json()
    const reply = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim()
    if (!reply) return json({ error: 'No answer came back. Try rephrasing.' }, 502, h)
    return json({ reply }, 200, h)
  },
}

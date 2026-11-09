// Vercel function: forwards explicit-image requests to Runware or Wiro when
// the browser can't call them directly (CORS). Only these two hosts, only
// POST, and the player's own key travels in the request; nothing is stored.
const HOSTS = { runware: 'https://api.runware.ai', wiro: 'https://api.wiro.ai' };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const provider = String(req.query.provider || '');
  const path = String(req.query.path || '');
  if (!HOSTS[provider] || !/^\/v1\/[A-Za-z0-9/._-]*$/.test(path)) {
    res.status(400).json({ error: 'Unknown provider or path' });
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = {};
  for (const name of ['authorization', 'x-api-key', 'content-type']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const upstream = await fetch(`${HOSTS[provider]}${path}`, { method: 'POST', headers, body: Buffer.concat(chunks) });
  res.status(upstream.status);
  res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
  res.send(Buffer.from(await upstream.arrayBuffer()));
};

module.exports.config = { api: { bodyParser: false } };

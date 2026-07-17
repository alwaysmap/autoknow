// AutoKnow Chat relay: Google Chat can only reliably reach standard-port HTTPS, so
// this forwards its POSTs from *.run.app (:443) to the Tailscale funnel where the
// real app verifies the Chat JWT. No auth here by design — the app's verification
// is the security boundary, and this relay adds no capabilities beyond reachability.
const http = require('http');
const UPSTREAM = process.env.UPSTREAM || 'https://mac-mini.chipmunk-minor.ts.net:10000';

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const r = await fetch(UPSTREAM + req.url, {
        method: req.method,
        headers: {
          'content-type': req.headers['content-type'] || 'application/json',
          'x-autoknow-original-host': req.headers.host || '',
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const text = await r.text();
      console.log(`[relay] ${req.method} ${req.url} -> ${r.status}`);
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
      res.end(text);
    } catch (e) {
      console.log(`[relay] ${req.method} ${req.url} UPSTREAM FAIL: ${e.message}`);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'relay upstream unreachable' }));
    }
  });
}).listen(process.env.PORT || 8080);

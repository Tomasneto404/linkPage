/** Server-Sent Events stream that pushes "data changed" pings to open pages. */

const { sseClients } = require('../services/sseService');

function stream(req, res) {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Opening comment flushes headers immediately so the EventSource readyState
  // flips to OPEN without waiting for the first real event.
  res.write(': ok\n\n');
  // Tell the browser to back off if the connection drops (default is 3 s).
  res.write('retry: 4000\n\n');

  sseClients.add(res);

  // Keep proxies happy — many drop idle SSE connections after ~30 s.
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
}

module.exports = { stream };

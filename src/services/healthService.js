/**
 * Broken-link health checker. Sends HEAD requests and flags links whose target
 * is unreachable or returns 4xx/5xx. Timers are started by server.js.
 */

const db = require('../models');

/**
 * Checks whether a URL is reachable by sending a HEAD request.
 * Marks the link as broken in the DB if the request fails or returns 4xx/5xx.
 */
async function checkLinkHealth(linkId, url) {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method:   'HEAD',
      signal:   controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    db.updateLinkBrokenStatus(linkId, response.status >= 400);
  } catch {
    db.updateLinkBrokenStatus(linkId, true);
  }
}

/** Checks every link one at a time with a small delay between each request. */
async function runHealthCheck() {
  const links = db.getAllLinksForHealthCheck();
  for (const link of links) {
    await checkLinkHealth(link.id, link.url);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

module.exports = { checkLinkHealth, runHealthCheck };

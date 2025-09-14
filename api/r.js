// api/r.js
// Minimal Vercel serverless redirect endpoint.
// - Best-effort notifies your Apps Script tracker URL (TRACKER_URL).
// - Validates dest (optional ALLOWED_DOMAINS whitelist).
// - Responds immediately with 302 Location to the dest.

const DEFAULT_TRACK_TIMEOUT_MS = 700; // don't wait too long for tracker call

// Helper: safe URL normalization
function normalizeDest(raw) {
  if (!raw) return null;
  raw = String(raw);
  // allow encoded values
  try { raw = decodeURIComponent(raw); } catch (e) { /* ignore */ }
  // add scheme if missing
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) raw = 'https://' + raw;
  try {
    const u = new URL(raw);
    // block obviously dangerous protocols
    if (!/^https?:$/i.test(u.protocol)) return null;
    return u.toString();
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    const { rid = '', dest: rawDest } = req.query || {};

    if (!rawDest) {
      res.statusCode = 400;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Missing dest parameter');
      return;
    }

    const dest = normalizeDest(rawDest);
    if (!dest) {
      res.statusCode = 400;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Invalid dest URL');
      return;
    }

    // Optional domain whitelist - safer for avoiding open-redirect abuse.
    // Comma-separated hostnames in ALLOWED_DOMAINS env (e.g. "behance.net,example.com")
    const allowed = process.env.ALLOWED_DOMAINS || '';
    if (allowed.trim()) {
      const host = new URL(dest).hostname;
      const allowedList = allowed.split(',').map(s => s.trim()).filter(Boolean);
      const ok = allowedList.some(a => {
        // allow subdomains: domain match: host === a OR host.endsWith('.' + a)
        return host === a || host.endsWith('.' + a);
      });
      if (!ok) {
        res.statusCode = 403;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('Destination domain not allowed');
        return;
      }
    }

    // Best-effort notify Apps Script tracker (if configured)
    const TRACKER_URL = process.env.TRACKER_URL || '';
    if (TRACKER_URL) {
      try {
        // Build tracker request - GET with query params
        const trackerUrl = TRACKER_URL +
          (TRACKER_URL.indexOf('?') === -1 ? '?' : '&') +
          'action=track&rid=' + encodeURIComponent(rid || '') +
          '&dest=' + encodeURIComponent(dest);

        // Use AbortController to bound time spent waiting for tracker.
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), DEFAULT_TRACK_TIMEOUT_MS);

        // fire-and-wait short timeout so redirect remains fast.
        await fetch(trackerUrl, { method: 'GET', signal: ac.signal }).catch(() => { /* ignore */ });
        clearTimeout(timeout);
      } catch (e) {
        // ignore tracker failures - do not block redirect
      }
    }

    // Issue redirect immediately (HTTP 302)
    res.statusCode = 302;
    res.setHeader('Location', dest);
    // Some clients like a minimal body
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html><body>Redirecting… If you are not redirected automatically, <a href="${dest}">click here</a>.</body></html>`);
  } catch (err) {
    console.error('redirect error', err);
    try {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Server error');
    } catch (e) {}
  }
};

// Origin is authoritative when supplied. Older Safari/Home Screen contexts can
// omit it or serialize an opaque origin as null. In those cases use an exact
// Referer origin, the authenticated CSRF token, or the login's non-simple AJAX
// header + JSON content type. No route permits cross-origin CORS requests.
export function trustedMutation({ headers, allowedOrigins, csrfValid = false, login = false }) {
  if (headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = headers.origin;
  if (origin && origin !== 'null') return allowedOrigins.includes(origin);
  const referer = headers.referer;
  if (referer) {
    try { return allowedOrigins.includes(new URL(referer).origin); } catch { return false; }
  }
  if (csrfValid) return true;
  const json = /^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '');
  return login && json && headers['x-robi-request'] === 'same-origin';
}

export function forwardedOverHttp(headers) {
  if (String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'http') return true;
  try { return JSON.parse(headers['cf-visitor'] || '{}').scheme === 'http'; } catch { return false; }
}

// Encode/decode graph state (algebra + items) as a URL hash fragment.
// Uses base64url-encoded JSON so no server is needed.

function toBase64Url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  return decodeURIComponent(escape(atob(padded + '='.repeat(pad))));
}

export function encodeGraph(algebraId, items) {
  try {
    return '#' + toBase64Url(JSON.stringify({ algebra: algebraId, items }));
  } catch {
    return '';
  }
}

export function decodeGraph(hash) {
  try {
    const str = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!str) return null;
    const payload = JSON.parse(fromBase64Url(str));
    if (!payload.algebra || !Array.isArray(payload.items)) return null;
    return { algebra: payload.algebra, items: payload.items };
  } catch {
    return null;
  }
}

// Read and parse the current URL hash. Returns null when absent or invalid.
export function readHashGraph() {
  if (typeof window === 'undefined' || !window.location.hash) return null;
  return decodeGraph(window.location.hash);
}

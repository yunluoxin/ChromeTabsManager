// Shared "no real favicon" fallback, derived from lazy-tab.js: the URL's host
// picks a stable color from a fixed palette and contributes its first letter,
// so all tabs of one site look alike. lazy-tab.js paints this onto a canvas
// for the tab strip; the dashboard renders the same idea as a DOM badge.

const PALETTE = [
  "#5b8def", "#e8710a", "#0f9d58", "#db4437",
  "#ab47bc", "#00acc1", "#9e9d24", "#f4511e"
];

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// First letter of the HOST (not the title): titles churn as pages update,
// and same-site tabs should look alike.
function hostLetter(host) {
  const bare = host.replace(/^www\./, "");
  return (bare.charAt(0) || "?").toUpperCase();
}

export function faviconFallback(url) {
  const host = hostOf(url || "");
  return {
    letter: hostLetter(host),
    color: PALETTE[hashString(host) % PALETTE.length]
  };
}

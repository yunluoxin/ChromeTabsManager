// Placeholder page for snapshot-restored background tabs (lazy-tab.html).
//
// restoreSnapshot opens each window's active tab for real and points every
// other tab at this page with the original url/title/favIconUrl in the query
// string. This file is local, so restoring a 100-tab snapshot loads one page
// instead of a hundred; the real page loads only when its tab is activated.
//
// The tab strip shows the real title and favicon (falling back to a colored
// letter derived from the URL's host, so all tabs of one site share a color),
// which is what makes the placeholder indistinguishable from a discarded tab.

const params = new URLSearchParams(location.search);
const targetUrl = params.get("url") || "";
const title = params.get("title") || targetUrl;
const favIconUrl = params.get("favIconUrl") || "";

// Fixed palette; the host hash picks one so a site's color is stable.
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

function setFavicon(href) {
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = href;
  document.head.appendChild(link);
}

function letterFavicon(host) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PALETTE[hashString(host) % PALETTE.length];
  ctx.beginPath();
  ctx.roundRect(0, 0, 32, 32, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(hostLetter(host), 16, 17);
  return canvas.toDataURL();
}

function go() {
  if (!targetUrl) return;
  // replace() keeps the placeholder out of history, so Back on the real page
  // behaves as if the placeholder never existed.
  location.replace(targetUrl);
}

if (!targetUrl) {
  // Hand-typed or broken placeholder URL — nothing to restore to.
  document.title = "lazy tab";
} else {
  document.title = title;

  if (favIconUrl) {
    setFavicon(favIconUrl);
  } else {
    setFavicon(letterFavicon(hostOf(targetUrl)));
  }

  // Swap in the real page as soon as the tab becomes visible — both on user
  // activation (visibilitychange) and on the odd case where it opens active.
  if (!document.hidden) {
    go();
  } else {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) go();
    });
  }
  // Redundant with visibility, but handy for keyboard focus edge cases.
  window.addEventListener("focus", go);
  document.addEventListener("click", go);
}

// Pure helpers for window geometry (width / height / left / top / state).
//
// Snapshots save the live window's bounds so a later restore can recreate the
// same on-screen layout. All three helpers here stay Chrome-free so they can
// run under `node --test` and so the import path on the snapshot side never
// accidentally introduces a circular dependency with chrome-api.js.
//
// The shape used by the rest of the codebase:
//
//   bounds: { width, height, left, top, state }
//     - width/height: positive integer pixels (full browser frame included)
//     - left/top:     integer pixels (global / virtual-desktop coords)
//     - state:        "normal" | "minimized" | "maximized" | "fullscreen"
//
//   screen: { availLeft, availTop, availWidth, availHeight }
//     - work area of the display the window sat on at capture time
//     - also accepts chrome.system.display workArea { left, top, width, height }
//
// Restore maps each normal window independently onto the target work area:
//
//   scaleX = target.availWidth  / saved.availWidth
//   scaleY = target.availHeight / saved.availHeight
//   left'  = target.availLeft + (left - saved.availLeft) * scaleX
//   top'   = target.availTop  + (top  - saved.availTop)  * scaleY
//   w'     = width  * scaleX
//   h'     = height * scaleY
//
// Single- and multi-window snapshots share this path. Old snapshots without
// `screen` keep their pixel geometry and are only clamped into the target
// work area. Maximized / fullscreen / minimized pass through as state only.

const VALID_STATES = new Set(["normal", "minimized", "maximized", "fullscreen"]);

// Chrome / Firefox will not accept width or height alongside a non-normal
// windowState — see chrome.windows.WindowState docs. We mirror that here so
// applyBoundsToCreateData can omit geometry when the user wants the window
// snapped to a screen edge.
const STATE_OVERRIDES_GEOMETRY = new Set(["minimized", "maximized", "fullscreen"]);

// Minimum overlap (in CSS pixels) we require between the captured window rect
// and the user's current screen work area. Below this, the window would land
// effectively off-screen and we'd rather let Chrome pick a default position
// than drop a half-invisible window on top of the user's taskbar. 64×64 also
// matches the smallest frame Chrome will let you drag a window to.
const MIN_VISIBLE_PX = 64;

function asPositiveInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function asInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function asValidState(value) {
  return typeof value === "string" && VALID_STATES.has(value) ? value : null;
}

// Extract usable geometry from a chrome.windows.Window-like object (or a
// previously-sanitized bounds object on import). Each field is validated
// independently so one bad field does not invalidate the rest. Returns null
// when nothing usable remains — the caller is then expected to skip the
// `bounds` key entirely so old snapshots (no bounds at all) keep round-tripping
// with the same shape they always had.
export function sanitizeCapturedBounds(raw) {
  if (!raw || typeof raw !== "object") return null;
  const width = asPositiveInt(raw.width);
  const height = asPositiveInt(raw.height);
  const left = asInt(raw.left);
  const top = asInt(raw.top);
  const state = asValidState(raw.state);

  if (width == null && height == null && left == null && top == null && state == null) {
    return null;
  }
  const bounds = {};
  if (width != null) bounds.width = width;
  if (height != null) bounds.height = height;
  if (left != null) bounds.left = left;
  if (top != null) bounds.top = top;
  if (state != null) bounds.state = state;
  return bounds;
}

// Work-area screen info. Accepts either the window.screen shape (avail*) or
// chrome.system.display workArea ({ left, top, width, height }). All four
// fields are required — a partial screen is useless for proportional restore.
export function sanitizeCapturedScreen(raw) {
  if (!raw || typeof raw !== "object") return null;
  const availLeft = asInt(raw.availLeft ?? raw.left);
  const availTop = asInt(raw.availTop ?? raw.top);
  const availWidth = asPositiveInt(raw.availWidth ?? raw.width);
  const availHeight = asPositiveInt(raw.availHeight ?? raw.height);
  if (availLeft == null || availTop == null || availWidth == null || availHeight == null) {
    return null;
  }
  return { availLeft, availTop, availWidth, availHeight };
}

// Decide whether a saved bounds would land the restored window somewhere
// usable on the user's current display setup. `screen` is the work area
// reported by window.screen from the calling extension page
// ({ availLeft, availTop, availWidth, availHeight }); pass null when no
// screen info is available (e.g. older popup versions) and we'll let the
// bounds through — Chrome itself will clamp impossible positions.
//
// We require a ≥ MIN_VISIBLE_PX overlap on both axes. A window that lands
// mostly off-screen is worse than no window at all: the user can lose track
// of it and have to dig through Mission Control / the taskbar.
export function isBoundsValidForScreen(bounds, screen) {
  if (bounds == null) return true;
  if (!screen || typeof screen !== "object") return true;

  const screenLeft = asInt(screen.availLeft);
  const screenTop = asInt(screen.availTop);
  const screenWidth = asPositiveInt(screen.availWidth);
  const screenHeight = asPositiveInt(screen.availHeight);
  if (screenLeft == null || screenTop == null || screenWidth == null || screenHeight == null) {
    return true;
  }
  // Geometry-only check: if we don't know the window's size, we can't compute
  // overlap. Same fallback for "normal" state with no size — at minimum we
  // can verify the (left, top) anchor is on-screen.
  const width = asPositiveInt(bounds.width);
  const height = asPositiveInt(bounds.height);
  const left = asInt(bounds.left);
  const top = asInt(bounds.top);
  if (width == null || height == null || left == null || top == null) {
    return true;
  }

  const windowRight = left + width;
  const windowBottom = top + height;
  const screenRight = screenLeft + screenWidth;
  const screenBottom = screenTop + screenHeight;

  const overlapWidth = Math.max(0, Math.min(windowRight, screenRight) - Math.max(left, screenLeft));
  const overlapHeight = Math.max(0, Math.min(windowBottom, screenBottom) - Math.max(top, screenTop));
  return overlapWidth >= MIN_VISIBLE_PX && overlapHeight >= MIN_VISIBLE_PX;
}

function hasFullGeometry(bounds) {
  return (
    asPositiveInt(bounds.width) != null &&
    asPositiveInt(bounds.height) != null &&
    asInt(bounds.left) != null &&
    asInt(bounds.top) != null
  );
}

// Normalize one list entry: callers may pass either a plain bounds object
// (legacy / tests) or `{ bounds, screen? }` from planRestore.
function normalizeAdjustEntry(item) {
  if (!item || typeof item !== "object") {
    return { bounds: null, screen: null };
  }
  if (Object.prototype.hasOwnProperty.call(item, "bounds")) {
    return {
      bounds: item.bounds && typeof item.bounds === "object" ? item.bounds : null,
      screen: sanitizeCapturedScreen(item.screen)
    };
  }
  return { bounds: item, screen: sanitizeCapturedScreen(item.screen) };
}

// Map a window from its saved work area onto the target work area with
// independent X/Y scales (window relative to screen, not layout bbox).
function scaleBoundsToScreen(bounds, savedScreen, targetScreen) {
  const scaleX = targetScreen.availWidth / savedScreen.availWidth;
  const scaleY = targetScreen.availHeight / savedScreen.availHeight;
  return {
    ...bounds,
    left: Math.round(targetScreen.availLeft + (bounds.left - savedScreen.availLeft) * scaleX),
    top: Math.round(targetScreen.availTop + (bounds.top - savedScreen.availTop) * scaleY),
    width: Math.round(bounds.width * scaleX),
    height: Math.round(bounds.height * scaleY)
  };
}

// Legacy / missing saved screen: keep pixel size (shrink only if oversized),
// then clamp position into the target work area.
function clampBoundsToScreen(bounds, targetScreen) {
  let width = bounds.width;
  let height = bounds.height;
  let left = bounds.left;
  let top = bounds.top;

  if (width > targetScreen.availWidth) width = targetScreen.availWidth;
  if (height > targetScreen.availHeight) height = targetScreen.availHeight;

  const screenRight = targetScreen.availLeft + targetScreen.availWidth;
  const screenBottom = targetScreen.availTop + targetScreen.availHeight;
  if (left + width > screenRight) left = screenRight - width;
  if (top + height > screenBottom) top = screenBottom - height;
  if (left < targetScreen.availLeft) left = targetScreen.availLeft;
  if (top < targetScreen.availTop) top = targetScreen.availTop;

  return {
    ...bounds,
    width: Math.round(width),
    height: Math.round(height),
    left: Math.round(left),
    top: Math.round(top)
  };
}

// Adjust snapshot window geometry for the user's current display.
//
// `savedList` entries are either plain bounds or `{ bounds, screen? }`.
// `targetScreen` is the work area from the calling extension page
// ({ availLeft, availTop, availWidth, availHeight }).
//
// Per entry:
//   - maximized / fullscreen / minimized → unchanged (state-only restore)
//   - normal + saved screen → proportional map onto target (scaleX ≠ scaleY OK)
//   - normal + no saved screen → raw pixels, clamped into target work area
//   - empty / no target screen → return bounds unchanged
//
// Returns an array of bounds objects (same length / order as input).
export function adjustBoundsForScreen(savedList, targetScreen) {
  if (!Array.isArray(savedList) || savedList.length === 0) {
    return savedList;
  }

  const target = sanitizeCapturedScreen(targetScreen);
  if (!target) {
    return savedList.map((item) => normalizeAdjustEntry(item).bounds);
  }

  return savedList.map((item) => {
    const { bounds, screen: savedScreen } = normalizeAdjustEntry(item);
    if (!bounds) return bounds;
    if (STATE_OVERRIDES_GEOMETRY.has(bounds.state)) return bounds;
    if (!hasFullGeometry(bounds)) return bounds;

    if (savedScreen) {
      return scaleBoundsToScreen(bounds, savedScreen, target);
    }
    return clampBoundsToScreen(bounds, target);
  });
}

// Project a captured bounds onto a chrome.windows.create / browser.windows.create
// payload. Mutates and returns createData for ergonomic chaining.
//
//   - bounds == null                     → no-op
//   - state ∈ {minimized,maximized,fullscreen} → only state is set;
//     geometry would be ignored by Chrome anyway, and per spec we must not
//     pass width/height/left/top alongside those states.
//   - state === "normal" or missing      → add the available geometry fields
//
// Incognito and url keys on createData are left untouched — callers layer them
// in beforehand.
export function applyBoundsToCreateData(createData, bounds) {
  if (!createData || bounds == null) return createData;

  if (bounds.state && STATE_OVERRIDES_GEOMETRY.has(bounds.state)) {
    createData.state = bounds.state;
    return createData;
  }

  if (typeof bounds.width === "number") createData.width = bounds.width;
  if (typeof bounds.height === "number") createData.height = bounds.height;
  if (typeof bounds.left === "number") createData.left = bounds.left;
  if (typeof bounds.top === "number") createData.top = bounds.top;
  if (typeof bounds.state === "string" && bounds.state === "normal") {
    createData.state = "normal";
  }
  return createData;
}

// Chinese UI label for a single window's captured geometry. Returns "" when
// there's nothing to show so the caller can concatenate without branching.
// Examples:
//   "1440×900 (100, 60)"
//   "最大化"
//   "1440×900"
export function formatBoundsLabel(bounds) {
  if (!bounds) return "";
  if (bounds.state === "maximized") return "最大化";
  if (bounds.state === "fullscreen") return "全屏";
  if (bounds.state === "minimized") return "最小化";
  const size = typeof bounds.width === "number" && typeof bounds.height === "number"
    ? `${bounds.width}×${bounds.height}`
    : "";
  const pos = typeof bounds.left === "number" && typeof bounds.top === "number"
    ? ` (${bounds.left}, ${bounds.top})`
    : "";
  const combo = (size + pos).trim();
  return combo || "";
}

// Roll up geometry across all windows in a snapshot into one short label, so
// the snapshot list rows can show "1440×900 · 1440×900 · 最大化" without each
// row needing the full snapshot record. Returns "" when no window has any
// geometry — the caller hides the segment entirely.
export function formatBoundsSummary(snapshot) {
  const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
  const parts = [];
  for (const win of windows) {
    const label = formatBoundsLabel(win?.bounds);
    if (label) parts.push(label);
  }
  return parts.join(" · ");
}

// Compact "720*1080" size label for the preview panel — only when both
// width and height are known. Special states (maximized / fullscreen /
// minimized) intentionally render as "" because the size doesn't reflect
// what the user actually sees after restore (and forcing a fake size would
// mislead them).
export function formatWindowSizeLabel(bounds) {
  if (!bounds || typeof bounds !== "object") return "";
  if (bounds.state === "maximized" || bounds.state === "fullscreen" || bounds.state === "minimized") {
    return "";
  }
  if (typeof bounds.width !== "number" || typeof bounds.height !== "number") return "";
  return `${bounds.width}*${bounds.height}`;
}

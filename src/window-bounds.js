// Pure helpers for window geometry (width / height / left / top / state).
//
// Snapshots save the live window's bounds so a later restore can recreate the
// same on-screen layout. All three helpers here stay Chrome-free so they can
// run under `node --test` and so the import path on the snapshot side never
// accidentally introduces a circular dependency with chrome-api.js.
//
// The shape used by the rest of the codebase:
//
//   { width, height, left, top, state }
//     - width/height: positive integer pixels (frame included)
//     - left/top:     integer pixels (offset from screen origin)
//     - state:        "normal" | "minimized" | "maximized" | "fullscreen"
//                     (optional — capture / restore accept missing state)
//
// We persist bounds as a single nested object (matching chrome.windows.Window's
// `bounds` concept) rather than flattening the fields onto the captured
// window. That keeps the existing `tabs / activeIndex / incognito` window
// shape intact and makes it trivial to skip the whole object via spread:
//
//   ...(bounds ? { bounds } : {})

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

// Translate a snapshot's window bounds so the saved layout lands somewhere
// visible on the user's current display. Pure helper, no Chrome API access.
//
// `savedBoundsList` is the array of bounds captured from the snapshot
// (window.bounds, sanitized). `screen` is the work area reported by
// window.screen from the calling extension page
// ({ availLeft, availTop, availWidth, availHeight }) — the same shape
// isBoundsValidForScreen takes.
//
// Behavior, in order:
//
//   1. Empty/non-array input, or no `screen` info → return as-is. Same
//      passthrough isBoundsValidForScreen uses; we trust Chrome/Firefox to
//      clamp impossible positions when we can't compute them ourselves.
//      This is also the path Firefox falls into when an extension page can't
//      reach `window.screen` for any reason (it normally can, but we don't
//      bet the layout on it).
//
//   2. At least one window already has ≥ MIN_VISIBLE_PX overlap with the
//      current screen → return unchanged. We don't move windows out from
//      under a layout that's *partially* visible — e.g. one window on the
//      left edge of a shared screen straddling two displays. Moving the
//      whole layout in that case would yank a working window off-screen.
//
//   3. Every window is entirely off-screen on the current display → translate
//      the entire layout as a unit. The saved layout's bounding box is
//      shifted so its top-left lands at the current screen's work-area
//      top-left; every window moves by the same (dx, dy). Width, height,
//      and state are preserved — only left/top change. Translating the whole
//      layout (instead of each window independently to (availLeft, availTop))
//      keeps a side-by-side or stacked arrangement intact on the new screen;
//      independent translation would pile every window on the top-left
//      corner of the new display.
//
//      Limitation: if the saved bounding box is wider/taller than the new
//      screen, translated windows may extend past the new screen's edges.
//      We don't scale — Chrome/Firefox will clamp the overflow, and the
//      user can re-arrange if they want tighter fit. Scaling risks shrinking
//      a window the user sized on purpose, and "what's the right scale
//      factor?" has no good default answer.
//
// Bounds missing any of {width, height, left, top} are passed through
// unchanged — those are maximized / fullscreen / minimized windows whose
// geometry Chrome ignores anyway, and translating them would just be noise.
export function adjustBoundsForScreen(savedBoundsList, screen) {
  if (!Array.isArray(savedBoundsList) || savedBoundsList.length === 0) {
    return savedBoundsList;
  }
  // No usable screen info → passthrough, same fallback isBoundsValidForScreen uses.
  if (!screen || typeof screen !== "object") {
    return savedBoundsList;
  }

  // Collect entries with full geometry, remembering their original index so
  // we can rebuild the output array in the same order.
  const validEntries = [];
  for (let i = 0; i < savedBoundsList.length; i += 1) {
    const b = savedBoundsList[i];
    if (
      b && typeof b === "object" &&
      asPositiveInt(b.width) != null &&
      asPositiveInt(b.height) != null &&
      asInt(b.left) != null &&
      asInt(b.top) != null
    ) {
      validEntries.push({ index: i, bounds: b });
    }
  }
  if (validEntries.length === 0) return savedBoundsList;

  // If anything is already visible, leave the whole layout alone. Mixing
  // "shifted" and "un-shifted" windows would desync their relative positions.
  const anyVisible = validEntries.some(({ bounds }) => isBoundsValidForScreen(bounds, screen));
  if (anyVisible) return savedBoundsList;

  const screenLeft = asInt(screen.availLeft) ?? 0;
  const screenTop = asInt(screen.availTop) ?? 0;

  // Bounding box of the saved layout, in global screen coordinates.
  let minLeft = Infinity;
  let minTop = Infinity;
  for (const { bounds } of validEntries) {
    if (bounds.left < minLeft) minLeft = bounds.left;
    if (bounds.top < minTop) minTop = bounds.top;
  }
  if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) return savedBoundsList;

  const deltaX = screenLeft - minLeft;
  const deltaY = screenTop - minTop;
  if (deltaX === 0 && deltaY === 0) return savedBoundsList;

  // Build the translated list — copy-on-write so callers don't see mutations.
  const result = savedBoundsList.slice();
  for (const { index, bounds } of validEntries) {
    result[index] = {
      ...bounds,
      left: bounds.left + deltaX,
      top: bounds.top + deltaY
    };
  }
  return result;
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

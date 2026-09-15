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

// Single-window restore: keep saved size when it fits. Never scale UP
// (that turns half-screen saves into full-screen). Scale DOWN uniformly
// only when the window itself is larger than the work area; then clamp
// position so the window lands on-screen.
function adjustSingleWindowBounds(savedBoundsList, entry, screen) {
  const { index, bounds } = entry;
  const screenLeft = asInt(screen.availLeft) ?? 0;
  const screenTop = asInt(screen.availTop) ?? 0;
  const screenWidth = asPositiveInt(screen.availWidth);
  const screenHeight = asPositiveInt(screen.availHeight);
  if (screenWidth == null || screenHeight == null) return savedBoundsList;

  // Cap at 1: shrink to fit if oversized, never enlarge a deliberate size.
  const scale = Math.min(1, screenWidth / bounds.width, screenHeight / bounds.height);
  const width = Math.round(bounds.width * scale);
  const height = Math.round(bounds.height * scale);
  let left = bounds.left;
  let top = bounds.top;

  const screenRight = screenLeft + screenWidth;
  const screenBottom = screenTop + screenHeight;
  if (left + width > screenRight) left = screenRight - width;
  if (top + height > screenBottom) top = screenBottom - height;
  if (left < screenLeft) left = screenLeft;
  if (top < screenTop) top = screenTop;

  if (
    width === bounds.width &&
    height === bounds.height &&
    left === bounds.left &&
    top === bounds.top
  ) {
    return savedBoundsList;
  }

  const result = savedBoundsList.slice();
  result[index] = {
    ...bounds,
    width,
    height,
    left: Math.round(left),
    top: Math.round(top)
  };
  return result;
}

// Adjust a snapshot's window bounds so the saved layout fits the user's
// current display. Pure helper, no Chrome API access.
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
//   2. The saved bbox exactly matches the current screen's work area (same
//      origin AND same size) → return unchanged. Same-screen-restore fast
//      path; nothing to do.
//
//   3. Otherwise → stretch the bbox independently on X and Y so it maps
//      edge-to-edge onto the new screen's work area (scaleX / scaleY may
//      differ), then translate so the bbox's top-left lands at the
//      screen's work-area top-left. Both up- and down-scaling are
//      intentional — see the next paragraph.
//
// "fit edge-to-edge, independent axes":
//
//   - Scale DOWN when the saved layout overflows the new screen in any
//     dimension (e.g. saved on a 4K external, restoring on a 1080p laptop).
//     Required to avoid the windows clipping into the taskbar / dock.
//
//   - Scale UP when the saved layout is smaller than the new screen. This
//     matches user intent: a layout that filled screen A should fill
//     screen B too — not stay small in a corner of a bigger monitor. The
//     saved `chrome.windows.Window` bounds are typically the work-area
//     pixels the user sized to on A (not the raw physical screen), so a
//     bbox that filled A's `availHeight` would otherwise come back on B
//     at the same pixel height, leaving B's extra work area unused.
//
//     Scope: scale-up applies only to multi-window layouts (2+ normal-
//     geometry entries). A single half-screen window (dashboard「保存本组」、
//     popup「保存当前窗口」) must keep its saved size — stretching it to
//     fill availWidth looks like "maximized" and destroys the capture.
//
// Independent scaleX / scaleY (not a single uniform scale):
//
//   Saved window heights rarely equal availHeight exactly (imperfect snap,
//   a few pixels of OS chrome, etc.), so the bbox aspect ratio often
//   differs from the target screen. A uniform min(sx, sy) scale would
//   fill width first and leave a vertical gap — "左右平分了，上下没撑满".
//   Stretching each axis separately maps the bbox onto the full work
//   area; relative layout (left/right, top/bottom splits) is preserved,
//   individual window aspect ratios may change slightly.
//
// State-override entries (maximized / fullscreen / minimized) are passed
// through unchanged. applyBoundsToCreateData honors their `state` field
// on the new screen, so a saved "maximized" window opens maximized on the
// new screen no matter its size. They're also excluded from the bbox math:
// a single maximized window that covers the whole old screen would
// otherwise inflate the bbox and distort the scale for normal windows
// sitting alongside it.
export function adjustBoundsForScreen(savedBoundsList, screen) {
  if (!Array.isArray(savedBoundsList) || savedBoundsList.length === 0) {
    return savedBoundsList;
  }
  if (!screen || typeof screen !== "object") {
    return savedBoundsList;
  }

  // Collect entries that are normal-state AND have full geometry. State-
  // override windows (maximized / fullscreen / minimized) pass through
  // unchanged — see the function header for why.
  const validEntries = [];
  for (let i = 0; i < savedBoundsList.length; i += 1) {
    const b = savedBoundsList[i];
    if (
      b && typeof b === "object" &&
      !STATE_OVERRIDES_GEOMETRY.has(b.state) &&
      asPositiveInt(b.width) != null &&
      asPositiveInt(b.height) != null &&
      asInt(b.left) != null &&
      asInt(b.top) != null
    ) {
      validEntries.push({ index: i, bounds: b });
    }
  }
  if (validEntries.length === 0) return savedBoundsList;

  // Single normal-geometry window: never stretch to fill the screen.
  // Preserve saved size; only translate into the work area when off-screen.
  if (validEntries.length === 1) {
    return adjustSingleWindowBounds(savedBoundsList, validEntries[0], screen);
  }

  // Bounding box of the saved normal-state layout, in global screen coords.
  let bboxLeft = Infinity;
  let bboxTop = Infinity;
  let bboxRight = -Infinity;
  let bboxBottom = -Infinity;
  for (const { bounds } of validEntries) {
    if (bounds.left < bboxLeft) bboxLeft = bounds.left;
    if (bounds.top < bboxTop) bboxTop = bounds.top;
    const right = bounds.left + bounds.width;
    const bottom = bounds.top + bounds.height;
    if (right > bboxRight) bboxRight = right;
    if (bottom > bboxBottom) bboxBottom = bottom;
  }
  if (!Number.isFinite(bboxLeft) || !Number.isFinite(bboxRight) ||
      bboxRight <= bboxLeft || bboxBottom <= bboxTop) {
    return savedBoundsList;
  }
  const bboxWidth = bboxRight - bboxLeft;
  const bboxHeight = bboxBottom - bboxTop;

  const screenLeft = asInt(screen.availLeft) ?? 0;
  const screenTop = asInt(screen.availTop) ?? 0;
  const screenWidth = asPositiveInt(screen.availWidth);
  const screenHeight = asPositiveInt(screen.availHeight);
  if (screenWidth == null || screenHeight == null) return savedBoundsList;

  // Fast path: bbox perfectly matches the new screen's work area (same
  // size, same origin). Nothing to do — the layout already fills the
  // screen and is at the right starting point.
  if (
    bboxLeft === screenLeft &&
    bboxTop === screenTop &&
    bboxWidth === screenWidth &&
    bboxHeight === screenHeight
  ) {
    return savedBoundsList;
  }

  // Stretch independently on each axis so the bbox fills the work area
  // edge-to-edge. Both up and down are allowed; see the function header.
  const scaleX = screenWidth / bboxWidth;
  const scaleY = screenHeight / bboxHeight;
  // Round-to-1 + offset guard: if the bbox already matches the screen's
  // origin and size (modulo float noise), no work to do.
  if (
    Math.abs(scaleX - 1) < 1e-6 &&
    Math.abs(scaleY - 1) < 1e-6 &&
    bboxLeft === screenLeft &&
    bboxTop === screenTop
  ) {
    return savedBoundsList;
  }

  // Apply scale + translate. Each window's old (left, top) is expressed
  // relative to the bbox origin, scaled per-axis, then offset to land at
  // the screen's work-area top-left. State is preserved verbatim
  // (state-override entries never reach here).
  const result = savedBoundsList.slice();
  for (const { index, bounds } of validEntries) {
    result[index] = {
      ...bounds,
      left: Math.round(screenLeft + (bounds.left - bboxLeft) * scaleX),
      top: Math.round(screenTop + (bounds.top - bboxTop) * scaleY),
      width: Math.round(bounds.width * scaleX),
      height: Math.round(bounds.height * scaleY)
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

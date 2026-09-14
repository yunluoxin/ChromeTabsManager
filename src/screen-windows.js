// Pure helpers for picking the Chrome display a window belongs to.
//
// Bounds are CSS pixels (a.k.a. DIPs). Comparing them across monitors with
// different devicePixelRatio is safe — `chrome.windows.Window` and
// `chrome.system.display.DisplayInfo.workArea` both report logical pixels.
//
// Contract:
//   centerOf(window)                              -> { x, y }            (NaN when geometry is missing)
//   isInside(rect, point)                         -> boolean             (half-open interval)
//   pickDisplayForPoint(point, displays)          -> DisplayInfo | null  (first match by workArea)
//   pickDisplayForWindow(window, displays)        -> DisplayInfo | null  (null when geometry is missing)
//   filterWindowsOnSameDisplay(windows, displays, display)
//                                                -> Window[]            ([] when display is null)
//   sameBoundsKey(window)                         -> string              (bounds signature; sentinels for missing)
//   filterWindowsOnSameDisplayVisible(windows, displays, display, activeWindowId)
//                                                -> Window[]            (drops duplicate-bounds groups that
//                                                                          the active window isn't part of)
//
// Edge cases:
//   - Windows without `left`/`top`/`width`/`height` (minimized to dock, special
//     window types): centerOf returns NaN, isInside returns false, the window
//     is correctly excluded.
//   - Windows whose center lies in no display (straddles two screens, off-screen
//     dock, geometry bug): excluded. There is no principled answer for
//     straddling windows; callers fall back to single-window saves.
//   - `displays` empty / non-array / null: pickDisplayForPoint returns null;
//     filterWindowsOnSameDisplay returns [].
//
// The "visible" variant (filterWindowsOnSameDisplayVisible) is a heuristic
// for macOS Spaces: Chrome's extension API doesn't expose which Space a
// window is on, but two windows on the same physical display reporting
// identical bounds MUST be on different Spaces — only one can be visible at
// a time. We treat any such duplicate-bounds group as "the user can't see
// all of these right now" and drop the ones that aren't the active window.

// Geometric center of a window. Returns NaN coordinates when the window has no
// usable geometry — callers should treat that as "unplaceable" and skip the
// window rather than guess.
//
// Reads from `window.bounds` first (the canonical Chrome fields), falling
// back to the older flat properties (`window.left` / `top` / `width` /
// `height`) so this works across Chrome versions where one or the other is
// populated. The fallback is also useful for stub objects we construct
// ourselves (e.g. `{ id }` after a window closed mid-save).
export function centerOf(window) {
  if (!window) return { x: NaN, y: NaN };
  const b = window.bounds;
  const left = readNum(b?.left, window.left);
  const top = readNum(b?.top, window.top);
  const width = readNum(b?.width, window.width);
  const height = readNum(b?.height, window.height);
  if (typeof left !== "number") return { x: NaN, y: NaN };
  if (typeof top !== "number") return { x: NaN, y: NaN };
  if (typeof width !== "number") return { x: NaN, y: NaN };
  if (typeof height !== "number") return { x: NaN, y: NaN };
  return {
    x: left + width / 2,
    y: top + height / 2
  };
}

function readNum(primary, fallback) {
  if (typeof primary === "number") return primary;
  if (typeof fallback === "number") return fallback;
  return undefined;
}

// Half-open containment: `left <= point.x < left + width`,
// `top <= point.y < top + height`. The right/bottom edge is excluded so two
// adjacent rects don't both claim the seam.
export function isInside(rect, point) {
  if (!rect || !point) return false;
  if (typeof rect.left !== "number" || typeof rect.top !== "number") return false;
  if (typeof rect.width !== "number" || typeof rect.height !== "number") return false;
  if (typeof point.x !== "number" || typeof point.y !== "number") return false;
  return (
    point.x >= rect.left &&
    point.x < rect.left + rect.width &&
    point.y >= rect.top &&
    point.y < rect.top + rect.height
  );
}

// First display whose workArea contains the point, or null. Iterates `displays`
// in order; on overlapping layouts (rare but possible with mirror/clone modes)
// the first match wins — Chrome's `getInfo` returns the primary display first,
// which is the right answer in practice.
export function pickDisplayForPoint(point, displays) {
  if (!Array.isArray(displays) || !point) return null;
  for (const display of displays) {
    if (isInside(display?.workArea, point)) return display;
  }
  return null;
}

// Convenience: which display does the window's center sit on? Null when the
// window has no geometry or its center is outside every known display.
export function pickDisplayForWindow(window, displays) {
  return pickDisplayForPoint(centerOf(window), displays);
}

// Windows whose centers also fall on `display`. Returns [] when `display` is
// null/undefined (degraded-mode signal for the caller to fall back).
export function filterWindowsOnSameDisplay(windows, displays, display) {
  if (!Array.isArray(windows)) return [];
  if (!display) return [];
  return windows.filter((win) => pickDisplayForWindow(win, displays)?.id === display.id);
}

// String signature of a window's screen geometry, used to detect
// "duplicate-bounds" groups on the same physical display. Two windows on
// the same display with identical bounds can't both be visible at the
// same time, so at least one must be hidden (typically on a different
// macOS Space).
//
// Reads bounds/flat fields the same way centerOf does. Returns sentinels
// for missing geometry rather than throwing — callers use these to bucket
// windows into "known duplicates" vs "unknown / can't tell".
export function sameBoundsKey(window) {
  if (!window) return "null";
  const b = window.bounds;
  const left = readNum(b?.left, window.left);
  const top = readNum(b?.top, window.top);
  const width = readNum(b?.width, window.width);
  const height = readNum(b?.height, window.height);
  if (
    typeof left !== "number" ||
    typeof top !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return "unknown";
  }
  return `${left}|${top}|${width}|${height}`;
}

// Like filterWindowsOnSameDisplay, but additionally drops windows that
// share their exact bounds with another window on the same display —
// because they can't all be visible simultaneously. Chrome doesn't
// expose which macOS Space a window is on, but identical bounds on the
// same display is the one signal we have that some of them must be
// hidden.
//
// Tiebreaker when the active window is part of a duplicate-bounds group:
// keep only the active one (we know the user can see it — they just
// clicked it). When the active window is NOT in the group, drop the
// whole group — they're almost certainly on a different Space from the
// user's current one.
//
// Limitation: this only catches the "duplicate bounds" case. If the user
// has unique-bound windows spread across multiple Spaces, they all get
// kept. There's no Chrome API signal for that case.
export function filterWindowsOnSameDisplayVisible(windows, displays, display, activeWindowId) {
  if (!Array.isArray(windows)) return [];
  if (!display) return [];
  const safeActiveId = Number(activeWindowId);
  const hasActive = Number.isFinite(safeActiveId);

  // Start with the same-display filter — anything off-screen is already
  // excluded by pickDisplayForWindow.
  const sameDisplay = filterWindowsOnSameDisplay(windows, displays, display);

  // Bucket by bounds signature.
  const byBounds = new Map();
  for (const win of sameDisplay) {
    const key = sameBoundsKey(win);
    if (!byBounds.has(key)) byBounds.set(key, []);
    byBounds.get(key).push(win);
  }

  const result = [];
  for (const [key, group] of byBounds) {
    // Sentinel keys (no geometry) and singletons: keep as-is. We can't tell
    // whether they're hidden, so we'd rather over-include than lose them.
    if (group.length === 1 || key === "unknown" || key === "null") {
      result.push(...group);
      continue;
    }
    // Duplicate bounds — pick the active one if it's in this group,
    // otherwise drop the whole group on the assumption they're on a
    // different Space.
    if (hasActive) {
      const activeInGroup = group.find((w) => w?.id === safeActiveId);
      if (activeInGroup) {
        result.push(activeInGroup);
        continue;
      }
    }
    // No active in this duplicate group → drop it.
  }
  return result;
}

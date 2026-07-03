// Floating circular drop zone that appears during a tab drag and, when
// released over, asks the host page to spin up a new browser window
// containing the dragged tabs.
//
// The zone docks at the bottom-right of the viewport by default. As the
// cursor approaches the dock it pulls toward the cursor (magnetic follow),
// capped at `magnetMaxOffset` so the user can still see the cursor
// separately. When the cursor comes within `activeThreshold` of the zone
// center, the zone enlarges to signal "ready to drop".
//
// The class is intentionally DOM-agnostic about the drop action: it just
// reads tabIds out of `dataTransfer` (the dashboard's existing payload) and
// hands them to the injected `onDrop` callback. Position math is exposed
// as pure helpers so it can be unit tested without a DOM.

const DEFAULT_OPTIONS = Object.freeze({
  dockRadius: 48,
  expandedRadius: 72,
  magnetRadius: 200,
  magnetMaxOffset: 120,
  activeThreshold: 36,
  viewportPadding: 24,
  dragType: "application/x-tab-ids"
});

export function computeZonePosition(dock, mouse, options = {}) {
  const { magnetRadius, magnetMaxOffset } = { ...DEFAULT_OPTIONS, ...options };
  const dx = mouse.x - dock.x;
  const dy = mouse.y - dock.y;
  const dist = Math.hypot(dx, dy);

  if (dist > magnetRadius) {
    return { x: dock.x, y: dock.y, isDocked: true };
  }

  // Sin curve peaks at half-magnet distance; both ends land at zero offset
  // so the zone snaps to the dock when the cursor is far away or right on
  // top of it, and reaches `magnetMaxOffset` when the cursor is mid-range.
  const norm = dist / magnetRadius;
  const factor = Math.sin(norm * Math.PI) * magnetMaxOffset;
  const angle = dist > 0 ? Math.atan2(dy, dx) : 0;
  return {
    x: dock.x + Math.cos(angle) * factor,
    y: dock.y + Math.sin(angle) * factor,
    isDocked: false
  };
}

export function isZoneActive(dock, mouse, options = {}) {
  const { activeThreshold } = { ...DEFAULT_OPTIONS, ...options };
  return Math.hypot(mouse.x - dock.x, mouse.y - dock.y) <= activeThreshold;
}

function readTabIdsFromDataTransfer(dataTransfer, dragType) {
  if (!dataTransfer) return [];
  const raw = dataTransfer.getData(dragType);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(Number).filter((id) => Number.isFinite(id));
      }
    } catch {
      /* fall through to text/plain fallback */
    }
  }
  const fallback = dataTransfer.getData("text/plain");
  if (!fallback) return [];
  return fallback.split(",").map(Number).filter((id) => Number.isFinite(id));
}

function hasDragType(dataTransfer, dragType) {
  if (!dataTransfer?.types) return false;
  // types is a DOMStringList in some engines and an array in others.
  if (typeof dataTransfer.types.contains === "function") {
    return dataTransfer.types.contains(dragType);
  }
  return Array.from(dataTransfer.types).includes(dragType);
}

export class NewWindowDropZone {
  constructor({ onDrop, getDraggedCount, options = {} } = {}) {
    if (typeof onDrop !== "function") {
      throw new TypeError("NewWindowDropZone requires an onDrop callback");
    }
    if (typeof getDraggedCount !== "function") {
      throw new TypeError("NewWindowDropZone requires a getDraggedCount callback");
    }
    this._onDrop = onDrop;
    this._getDraggedCount = getDraggedCount;
    this._options = { ...DEFAULT_OPTIONS, ...options };
    this._root = null;
    this._countEl = null;
    this._mouse = { x: 0, y: 0 };
    this._dock = { x: 0, y: 0 };
    this._handlers = null;
    this._mouseTracker = null;
    this._resizeTracker = null;
  }

  attach() {
    if (this._root) return;

    const root = document.createElement("div");
    root.className = "new-window-zone";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <div class="new-window-zone__halo"></div>
      <div class="new-window-zone__core">
        <span class="new-window-zone__count"></span>
      </div>
    `;
    document.body.appendChild(root);

    this._root = root;
    this._countEl = root.querySelector(".new-window-zone__count");

    this._recomputeDockPosition();
    this._applyPosition(this._dock.x, this._dock.y, { docked: true });

    const handlers = {
      dragstart: (event) => this._handleDragStart(event),
      dragend: (event) => this._handleDragEnd(event),
      drag: (event) => this._handleDrag(event)
    };
    for (const [name, handler] of Object.entries(handlers)) {
      document.addEventListener(name, handler);
    }

    root.addEventListener("dragover", (event) => this._handleDragOverZone(event));
    root.addEventListener("dragleave", (event) => this._handleDragLeaveZone(event));
    root.addEventListener("drop", (event) => this._handleDrop(event));

    // Track the cursor even when not over a registered drop target so the
    // zone can react as soon as the user starts dragging toward it.
    this._mouseTracker = (event) => {
      this._mouse.x = event.clientX;
      this._mouse.y = event.clientY;
    };
    document.addEventListener("dragover", this._mouseTracker, true);

    this._resizeTracker = () => {
      if (this._root && !this._root.hidden) {
        this._recomputeDockPosition();
        this._refreshPosition();
      }
    };
    window.addEventListener("resize", this._resizeTracker);

    this._handlers = handlers;
  }

  detach() {
    if (!this._root) return;
    for (const [name, handler] of Object.entries(this._handlers)) {
      document.removeEventListener(name, handler);
    }
    document.removeEventListener("dragover", this._mouseTracker, true);
    window.removeEventListener("resize", this._resizeTracker);
    this._root.remove();
    this._root = null;
    this._countEl = null;
    this._handlers = null;
    this._mouseTracker = null;
    this._resizeTracker = null;
  }

  isVisible() {
    return Boolean(this._root && !this._root.hidden);
  }

  _recomputeDockPosition() {
    const { viewportPadding, dockRadius } = this._options;
    this._dock.x = Math.max(0, window.innerWidth - viewportPadding - dockRadius);
    this._dock.y = Math.max(0, window.innerHeight - viewportPadding - dockRadius);
  }

  _handleDragStart(event) {
    if (!hasDragType(event.dataTransfer, this._options.dragType)) return;
    const count = Number(this._getDraggedCount()) || 0;
    if (count <= 0) return;

    this._recomputeDockPosition();
    this._countEl.textContent = String(count);
    this._root.hidden = false;
    this._root.classList.remove("active");
    this._root.classList.add("docked");
    this._applyPosition(this._dock.x, this._dock.y, { docked: true });
  }

  _handleDrag(event) {
    if (this._root?.hidden) return;
    // The browser synthesizes a final drag event at (0, 0) just before
    // dragend; ignore it to avoid snapping the zone to the corner.
    if (event.clientX === 0 && event.clientY === 0) return;
    this._mouse.x = event.clientX;
    this._mouse.y = event.clientY;
    this._refreshPosition();
  }

  _refreshPosition() {
    const next = computeZonePosition(this._dock, this._mouse, this._options);
    this._applyPosition(next.x, next.y, { docked: next.isDocked });
    if (isZoneActive(next, this._mouse, this._options)) {
      this._root.classList.add("active");
    } else {
      this._root.classList.remove("active");
    }
  }

  _handleDragEnd() {
    if (!this._root) return;
    this._root.hidden = true;
    this._root.classList.remove("active", "docked");
  }

  _handleDragOverZone(event) {
    if (!hasDragType(event.dataTransfer, this._options.dragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    this._root.classList.add("active");
  }

  _handleDragLeaveZone(event) {
    if (event.relatedTarget && this._root.contains(event.relatedTarget)) return;
    this._root.classList.remove("active");
  }

  _handleDrop(event) {
    if (!hasDragType(event.dataTransfer, this._options.dragType)) return;
    event.preventDefault();
    const tabIds = readTabIdsFromDataTransfer(event.dataTransfer, this._options.dragType);
    this._root.classList.remove("active", "docked");
    this._root.hidden = true;
    if (tabIds.length === 0) return;
    try {
      this._onDrop(tabIds);
    } catch (error) {
      // Swallow: the host page surfaces the error via its own status UI.
      // We intentionally do not rethrow because we are in a native event
      // handler where nothing useful can do with the error.
      console.error("NewWindowDropZone onDrop failed", error);
    }
  }

  _applyPosition(centerX, centerY, { docked = false } = {}) {
    if (!this._root) return;
    const { dockRadius } = this._options;
    this._root.style.transform = `translate(${centerX - dockRadius}px, ${centerY - dockRadius}px)`;
    this._root.classList.toggle("docked", docked);
  }
}

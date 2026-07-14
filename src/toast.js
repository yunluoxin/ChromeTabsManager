// Global transient feedback for popup and dashboard.
//
// showToast(message, { type, duration }) appends a toast to a single host
// under <body>, then removes it after the timer expires. The host is created
// lazily on the first call so callers don't have to remember to mount a
// container in the HTML — and the same module works for both popup and
// dashboard without changes.

const DEFAULT_DURATION_MS = 2400;
const ERROR_DURATION_MS = 4000;
const LEAVE_ANIMATION_MS = 220;

let host = null;

function ensureHost() {
  if (host && host.isConnected) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

export function showToast(message, { type = "info", duration } = {}) {
  if (message == null || message === "") return null;
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = String(message);

  // Click to dismiss early — useful when the auto-dismiss timer is long
  // (e.g. an error) and the user has already read it.
  toast.addEventListener("click", () => dismiss(toast));

  const root = ensureHost();
  root.appendChild(toast);

  const ttl = Number.isFinite(duration)
    ? duration
    : type === "error"
      ? ERROR_DURATION_MS
      : DEFAULT_DURATION_MS;
  const timer = setTimeout(() => dismiss(toast), ttl);
  toast.dataset.dismissTimer = String(timer);

  return toast;
}

function dismiss(toast) {
  if (!toast.isConnected) return;
  if (toast.dataset.dismissTimer) {
    clearTimeout(Number(toast.dataset.dismissTimer));
    delete toast.dataset.dismissTimer;
  }
  toast.classList.add("toast--leaving");
  setTimeout(() => toast.remove(), LEAVE_ANIMATION_MS);
}

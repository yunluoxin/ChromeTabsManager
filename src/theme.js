// Theme switcher for popup + dashboard.
//
// Storage key: `theme` in chrome.storage.local. Values are one of:
//   "light"  – force light mode
//   "dark"   – force dark mode
//   "system" – follow the OS prefers-color-scheme media query (default)
//
// We set two data attributes on <body>:
//   data-theme         – "light" | "dark"            (the resolved theme; CSS keys off this)
//   data-theme-source  – "light" | "dark" | "system" (the user's chosen intent)
// CSS uses [data-theme="dark"] to apply dark tokens; data-theme-source is
// for the segmented toggle to highlight which option is active.
//
// Cross-page sync: when popup flips the toggle, the dashboard's storage
// listener reapplies the theme without reloading.

import { getFromStorage, setInStorage } from "./chrome-api.js";

const STORAGE_KEY = "theme";

export const THEMES = Object.freeze({
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system"
});

const VALID = new Set(Object.values(THEMES));

function resolveTheme(value) {
  return value === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT;
}

const systemQuery = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

function readSystemTheme() {
  return systemQuery?.matches ? THEMES.DARK : THEMES.LIGHT;
}

export async function getStoredTheme() {
  const stored = await getFromStorage({ [STORAGE_KEY]: THEMES.SYSTEM });
  const value = stored[STORAGE_KEY];
  return VALID.has(value) ? value : THEMES.SYSTEM;
}

export async function setStoredTheme(value) {
  const safe = VALID.has(value) ? value : THEMES.SYSTEM;
  await setInStorage({ [STORAGE_KEY]: safe });
  return safe;
}

export function applyTheme(value) {
  const source = VALID.has(value) ? value : THEMES.SYSTEM;
  const resolved = source === THEMES.SYSTEM ? readSystemTheme() : resolveTheme(source);
  document.body.dataset.theme = resolved;
  document.body.dataset.themeSource = source;
  // The inline bootstrap script set this on <html>; once we've resolved the
  // stored theme and applied our own body attributes, the bootstrap is no
  // longer needed. Leaving it would keep the CSS dark-mode fallback active
  // even after the user picks light.
  delete document.documentElement.dataset.themeBootstrap;
}

export function subscribeSystemChange(handler) {
  if (!systemQuery) return () => {};
  const wrapped = (event) => handler(event.matches ? THEMES.DARK : THEMES.LIGHT);
  systemQuery.addEventListener("change", wrapped);
  return () => systemQuery.removeEventListener("change", wrapped);
}

export function subscribeThemeChange(handler) {
  const wrapped = (changes, area) => {
    if (area !== "local") return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    handler(VALID.has(change.newValue) ? change.newValue : THEMES.SYSTEM);
  };
  chrome.storage.onChanged.addListener(wrapped);
  return () => chrome.storage.onChanged.removeListener(wrapped);
}